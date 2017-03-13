'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// Standard node imports
const os = require('os');
const path = require('path');
const fs = require('fs');

// External dependencies
const yaml = require('js-yaml');
const dockerfileParse = require('dockerfile-parse');
const shell = require('shelljs');

const WINDOWS = 'win32';

let explainActive = false;
let kubectlFound = false;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
    var bin = vscode.workspace.getConfiguration('vs-kubernetes')['vs-kubernetes.kubectl-path'];
    if (!bin) {
        findBinary('kubectl', function (err, output) {
            if (err || output.length === 0) {
                vscode.window.showErrorMessage('Could not find "kubectl" binary, extension will not function correctly.');
            } else {
                kubectlFound = true;
            }
        });
    } else {
        kubectlFound = fs.existsSync(bin);
        if (!kubectlFound) {
            vscode.window.showErrorMessage(bin + ' does not exist! Extension will not function correctly.');
        }
    }

    const subscriptions = [
        vscode.commands.registerCommand('extension.vsKubernetesCreate',
            maybeRunKubernetesCommandForActiveWindow.bind(this, 'create -f')
        ),
        vscode.commands.registerCommand('extension.vsKubernetesDelete', deleteKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesApply', applyKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesExplain', explainActiveWindow),
        vscode.commands.registerCommand('extension.vsKubernetesLoad', loadKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesGet', getKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesRun', runKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesLogs', logsKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesExpose', exposeKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesDescribe', describeKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesSync', syncKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesExec', curry(execKubernetes, false)),
        vscode.commands.registerCommand('extension.vsKubernetesTerminal', curry(execKubernetes, true)),
        vscode.commands.registerCommand('extension.vsKubernetesDiff', diffKubernetes),
        vscode.commands.registerCommand('extension.vsKubernetesDebug', debugKubernetes),
        vscode.languages.registerHoverProvider(
            { language: 'json', scheme: 'file' },
            { provideHover }
        ),
        vscode.languages.registerHoverProvider(
            { language: 'yaml', scheme: 'file' },
            { provideHover }
        )
    ];

    subscriptions.forEach(function(element) {
        context.subscriptions.push(element);
    }, this);
}

// eslint-disable-next-line no-unused-vars
function provideHover(document, position, token) {
    if (!explainActive) {
        return null;
    }
    var body = document.getText();
    var obj = {};
    try {
        obj = JSON.parse(body);
    } catch (err) {
        // Bad JSON
        return null;
    }
    // Not a k8s object.
    if (!obj.kind) {
        return null;
    }
    var property = findProperty(document.lineAt(position.line));
    var field = JSON.parse(property);

    var parentLine = findParent(document, position.line - 1);
    while (parentLine !== -1) {
        var parentProperty = findProperty(document.lineAt(parentLine));
        field = JSON.parse(parentProperty) + '.' + field;
        parentLine = findParent(document, parentLine - 1);
    }

    if (field === 'kind') {
        field = '';
    }
    return {
        'then': function (fn) {
            explain(obj, field, function (msg) {
                fn(new vscode.Hover({
                    'language': 'json',
                    'value': msg
                }));
            });
        }
    };
}

function findProperty(line) {
    var ix = line.text.indexOf(":");
    return line.text.substring(line.firstNonWhitespaceCharacterIndex, ix);
}

function findParent(document, line) {
    var count = 1;
    while (line >= 0) {
        var txt = document.lineAt(line);
        if (txt.text.indexOf('}') !== -1) {
            count = count + 1;
        }
        if (txt.text.indexOf('{') !== -1) {
            count = count - 1;
            if (count === 0) {
                break;
            }
        }
        line = line - 1;
    }
    while (line >= 0) {
        txt = document.lineAt(line);
        if (txt.text.indexOf(':') !== -1) {
            return line;
        }
        line = line - 1;
    }
    return line;
}

function explain(obj, field, fn) {
    if (!obj.kind) {
        vscode.window.showErrorMessage("Not a Kubernetes API Object!");
        return;
    }
    var ref = obj.kind;
    if (field && field.length > 0) {
        ref = ref + "." + field;
    }
    kubectlInternal(` explain ${ref}`, function (result, stdout, stderr) {
        if (result !== 0) {
            vscode.window.showErrorMessage("Failed to run explain: " + stderr);
            return;
        }
        fn(stdout);
    });
}

function explainActiveWindow() {
    var editor = vscode.window.activeTextEditor;
    var bar = initStatusBar();
    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        bar.hide();
        return; // No open text editor
    }
    explainActive = !explainActive;
    if (explainActive) {
        vscode.window.showInformationMessage("Kubernetes API explain activated.");
        bar.show();
    } else {
        vscode.window.showInformationMessage("Kubernetes API explain deactivated.");
        bar.hide();
    }
}

var statusBarItem;

function initStatusBar() {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = "kubernetes-api-explain";
    }

    return statusBarItem;
}

// Runs a command for the text in the active window.
// Expects that it can append a filename to 'command' to create a complete kubectl command.
//
// @parameter command string The command to run
function maybeRunKubernetesCommandForActiveWindow(command) {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        return false; // No open text editor
    }
    var namespace = vscode.workspace.getConfiguration('vs-kubernetes')['vs-kubernetes.namespace'];
    if (namespace) {
        command = `${command} --namespace ${namespace}`;
    }
    if (editor.selection) {
        var text = editor.document.getText(editor.selection);
        if (text.length > 0) {
            var proc = kubectl(command + "-");
            proc.stdin.write(text);
            proc.stdin.end();
            return true;
        }
    }
    if (editor.document.isUntitled) {
        text = editor.document.getText();
        if (text.length > 0) {
            proc = kubectl(command + "-");
            proc.stdin.write(text);
            proc.stdin.end();
            return true;
        }
        return false;
    }
    if (editor.document.isDirty) {
        // TODO: I18n this?
        var confirm = "Save";
        var promise = vscode.window.showWarningMessage("You have unsaved changes!", confirm);
        promise.then(function (value) {
            if (value && value === confirm) {
                editor.document.save().then(function (ok) {
                    if (!ok) {
                        vscode.window.showErrorMessage("Save failed.");
                        return;
                    }
                    kubectl(command + editor.document.fileName);
                });
            }
        });
    } else {
        console.log(command + editor.document.fileName);
        kubectl(command + editor.document.fileName);
    }
    return true;
}

/**
 * Gets the text content (in the case of unsaved or selections), or the filename
 *
 * @param callback function(text, filename)
 */
function getTextForActiveWindow(callback) {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        callback(null, null);
        return;
    }
    var namespace = vscode.workspace.getConfiguration('vs-kubernetes')['vs-kubernetes.namespace'];
    if (namespace) {
        var command = `${command} --namespace ${namespace}`;
    }
    if (editor.selection) {
        var text = editor.document.getText(editor.selection);
        if (text.length > 0) {
            callback(text, null);
            return;
        }
    }
    if (editor.document.isUntitled) {
        text = editor.document.getText();
        if (text.length > 0) {
            callback(text, null);
            return;
        }
    }
    if (editor.document.isDirty) {
        // TODO: I18n this?
        var confirm = "Save";
        var promise = vscode.window.showWarningMessage("You have unsaved changes!", confirm);
        promise.then(function (value) {
            if (value && value === confirm) {
                editor.document.save().then(function (ok) {
                    if (!ok) {
                        vscode.window.showErrorMessage("Save failed.");
                        callback(null, null);
                        return;
                    }
                    callback(null, editor.document.fileName);
                });
            }
            callback(null, null);
        });
    } else {
        callback(null, editor.document.fileName);
    }
}

function loadKubernetes() {
    vscode.window.showInputBox({
        prompt: "What resource do you want to load?"
    }).then(function (value) {
        kubectlInternal(" -o json get " + value, function (result, stdout, stderr) {
            if (result !== 0) {
                vscode.window.showErrorMessage("Get command failed: " + stderr);
                return;
            }
            var filename = value.replace('/', '-');
            var filepath = path.join(vscode.workspace.rootPath, filename + '.json');
            vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:' + filepath)).then(doc => {
                var start = new vscode.Position(0, 0);
                var end = new vscode.Position(0, 0);
                var range = new vscode.Range(start, end);
                var edit = new vscode.TextEdit(range, stdout);

                var wsEdit = new vscode.WorkspaceEdit();
                wsEdit.set(doc.uri, [edit]);
                vscode.workspace.applyEdit(wsEdit);
                vscode.window.showTextDocument(doc);
            });
        })
    });
}

function kubectlDone(result, stdout, stderr) {
    if (result !== 0) {
        vscode.window.showErrorMessage("Kubectl command failed: " + stderr);
        return;
    }
    vscode.window.showInformationMessage(stdout);
}

function exposeKubernetes() {
    var kindName = findKindName();
    if (!kindName) {
        vscode.window.showErrorMessage("couldn't find a relevant type to expose.");
        return;
    }
    var cmd = "expose " + kindName;
    var ports = getPorts();
    if (ports && ports.length > 0) {
        cmd += " --port=" + ports[0]
    }

    kubectl(cmd);
}

function kubectl(command) {
    kubectlInternal(command, kubectlDone);
}

function kubectlInternal(command, handler) {
    if (!kubectlFound) {
        vscode.window.showErrorMessage('Can not find "kubectl" command line tool.');
    }
    var bin = vscode.workspace.getConfiguration('vs-kubernetes')['vs-kubernetes.kubectl-path'];
    if (!bin) {
        bin = 'kubectl'
    }
    var cmd = bin + ' ' + command
    shellExec(cmd, handler);
}

function shellExec(cmd, handler) {
    try {
        var home = process.env[(process.platform === WINDOWS) ? 'USERPROFILE' : 'HOME']
        var opts = {
            'cwd': vscode.workspace.rootPath,
            'env': {
                'HOME': home
            },
            'async': true
        };
        shell.exec(cmd, opts, handler);
    } catch (ex) {
        vscode.window.showErrorMessage(ex);
    }
}

function getKubernetes() {
    var kindName = findKindName();
    if (kindName) {
        maybeRunKubernetesCommandForActiveWindow('get --no-headers -o wide -f ');
        return;
    }
    vscode.window.showInputBox({
        prompt: "What resource do you want to get?"
    }).then(function (value) {
        kubectl(` get ${value} -o wide --no-headers`);
    });
}

function findVersion() {
    return {
        then: findVersionInternal
    };
}

function findVersionInternal(fn) {
    // No .git dir, use 'latest'
    // TODO: use 'git rev-parse' to detect upstream directories
    if (!fs.existsSync(path.join(vscode.workspace.rootPath, ".git"))) {
        fn('latest');
        return;
    }

    var home = process.env[(process.platform === WINDOWS) ? 'USERPROFILE' : 'HOME']
    var opts = {
        'cwd': vscode.workspace.rootPath,
        'env': {
            'HOME': home
        },
        'async': true
    };
    shell.exec('git describe --always --dirty', opts, function (code, stdout, stderr) {
        if (code !== 0) {
            vscode.window.showErrorMessage('git log returned: ' + code);
            console.log(stderr);
            fn('error');
            return;
        }
        fn(stdout);
    });
}

function findPods(labelQuery, callback) {
    kubectlInternal(' get pods -o json -l ' + labelQuery, function (result, stdout, stderr) {
        if (result !== 0) {
            vscode.window.showErrorMessage("Kubectl command failed: " + stderr);
            return;
        }
        try {
            var podList = JSON.parse(stdout);
            callback(podList);
        } catch (ex) {
            console.log(ex);
            vscode.window.showErrorMessage('unexpected error: ' + ex);
        }
    });
}

function findPodsForApp(callback) {
    var appName = path.basename(vscode.workspace.rootPath);
    findPods(`run=${appName}`, callback);
}

function findDebugPodsForApp(callback) {
    var appName = path.basename(vscode.workspace.rootPath);
    findPods(`run=${appName}-debug`, callback);
}

function findNameAndImage() {
    return {
        'then': _findNameAndImageInternal
    };
}

function _findNameAndImageInternal(fn) {
    var name = path.basename(vscode.workspace.rootPath);
    findVersion().then(function (version) {
        var image = name + ":" + version;
        var user = vscode.workspace.getConfiguration().get("vsdocker.imageUser", null);
        if (user) {
            image = user + '/' + image;
        }
        image = image.trim();
        name = name.trim();
        fn(name, image);
    });
}

function runKubernetes() {
    buildPushThenExec(function(name, image) {
        kubectlInternal(`run ${name} --image=${image}`, kubectlDone);
    });
}

function buildPushThenExec(fn) {
    findNameAndImage().then(function (name, image) {
        shellExec(`docker build -t ${image} .`, function(result, stdout, stderr) {
            if (result === 0) {
                vscode.window.showInformationMessage(image + ' built.');
                shellExec('docker push ' + image, function(result, stdout, stderr) {
                    if (result === 0) {
                        vscode.window.showInformationMessage(image + ' pushed.');
                        fn(name, image);
                    } else {
                        vscode.window.showErrorMessage('Image push failed.');
                        console.log(stderr);
                    }
                });
            } else {
                vscode.window.showErrorMessage('Image build failed.');
                console.log(stderr);
            }
        });
    });
}

function findKindName() {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        return null; // No open text editor
    }
    var text = editor.document.getText();
    return findKindNameForText(text);
}

function findKindNameForText(text) {
    try {
        var obj = yaml.safeLoad(text);
        if (!obj.kind) {
            return null;
        }
        if (!obj.metadata || !obj.metadata.name) {
            return null;
        }
        return obj.kind.toLowerCase() + '/' + obj.metadata.name;
    } catch (ex) {
        console.log(ex);
        return null;
    }
}

function findKindNameOrPrompt() {
    var kindName = findKindName();
    if (kindName !== null) {
        return {
            'then': function (fn) {
                fn(kindName)
            }
        }
    }
    return vscode.window.showInputBox({ prompt: "What resource do you want to load?" });
}

function curry(fn, arg) {
    return function () {
        var args = Array.prototype.slice.call(arguments, 0);
        args.push(arg);
        return fn.apply(null, args);
    }
}

function findPod(callback) {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        return null; // No open text editor
    }
    var text = editor.document.getText();
    try {
        var obj = yaml.safeLoad(text);
        if (obj.kind === 'Pod') {
            callback({
                'name': obj.metadata.name,
                'namespace': obj.metadata.namespace
            });
            return;
        }
    } catch (ex) {
        // pass
    }
    selectPodForApp(function (pod) {
        callback(pod.metadata);
    });
}

function selectPodForApp(callback) {
    findPodsForApp(function (podList) {
        if (podList.items.length === 0) {
            vscode.window.showErrorMessage("Couldn't find any relevant pods.");
            callback(null);
            return;
        }
        if (podList.items.length === 1) {
            callback(podList.items[0]);
            return;
        }
        var names = [];
        for (var i = 0; i < podList.items.length; i++) {
            // TODO: handle namespaces here...
            names.push(podList.items[i].metadata.namespace + '/' + podList.items[i].metadata.name);
        }
        vscode.window.showQuickPick(names).then(function (value) {
            if (!value) {
                callback(null);
                return;
            }
            var ix = value.indexOf('/');
            var name = value.substring(ix + 1);
            for (var i = 0; i < podList.items.length; i++) {
                if (podList.items[i].metadata.name === name) {
                    callback(podList.items[i]);
                }
            }
            callback(null);
        });
    });
}

function logsKubernetes() {
    findPod(getLogs);
}

function getLogs(pod) {
    if (!pod) {
        vscode.window.showErrorMessage("Can't find a pod!");
        return;
    }
    // TODO: Support multiple containers here!

    var cmd = ' logs ' + pod.name;
    if (pod.namespace && pod.namespace.length > 0) {
        cmd += ' --namespace=' + pod.namespace;
    }
    var fn = curry(kubectlOutput, pod.name + "-output");
    kubectlInternal(cmd, fn);
}

function kubectlOutput(result, stdout, stderr, name) {
    if (result !== 0) {
        vscode.window.showErrorMessage("Command failed: " + stderr);
        return;
    }
    var channel = vscode.window.createOutputChannel(name)
    channel.append(stdout);
    channel.show();
}

function getPorts() {
    var file = vscode.workspace.rootPath + '/Dockerfile';
    if (!fs.existsSync(file)) {
        return null;
    }
    try {
        var data = fs.readFileSync(file, 'utf-8');
        var obj = dockerfileParse(data);
        return obj.expose;
    } catch (ex) {
        console.log(ex);
        return null;
    }
}

function describeKubernetes() {
    findKindNameOrPrompt().then(function (value) {
        var fn = curry(kubectlOutput, value + "-describe");
        kubectlInternal(' describe ' + value, fn);
    });
}

function selectContainerForPod(pod, callback) {
    if (!pod) {
        callback(null);
    }
    if (pod.spec.containers.length === 1) {
        callback(pod.spec.containers[0]);
        return;
    }
    var names = [];
    for (var i = 0; i < pod.spec.containers.length; i++) {
        names.push(pod.spec.containers[i].name);
    }
    vscode.window.showQuickPick(names).then(function (value) {
        for (var i = 0; i < pod.spec.containers.length; i++) {
            if (pod.spec.containers[i].name === value) {
                callback(pod.spec.containers[i]);
            }
        }
        callback(null);
    });
}

function execKubernetes(isTerminal) {
    var opts = { 'prompt': 'Please provide a command to execute' };
    if (isTerminal) {
        opts.value = 'bash';
    }

    vscode.window.showInputBox(
        opts
    ).then(function (cmd) {
        if (!cmd || cmd.length === 0) {
            return;
        }
        selectPodForApp(function (pod) {
            if (!pod || !pod.metadata) {
                return;
            }
            if (isTerminal) {
                var execCmd = ['exec', '-it', pod.metadata.name, cmd];
                var term = vscode.window.createTerminal('exec', 'kubectl', execCmd);
                term.show();
            } else {
                execCmd = ' exec ' + pod.metadata.name + ' ' + cmd;
                var fn = curry(kubectlOutput, pod.metadata.name + "-exec")
                kubectlInternal(execCmd, fn);
            }
        });
    });
}

function syncKubernetes() {
    selectPodForApp(function (pod) {
        selectContainerForPod(pod, function (container) {
            var pieces = container.image.split(':');
            if (pieces.length !== 2) {
                vscode.windows.showErrorMessage(`unexpected image name: ${container.image}`);
                return;
            }
            var home = process.env[(process.platform === WINDOWS) ? 'USERPROFILE' : 'HOME']
            var opts = {
                'cwd': vscode.workspace.rootPath,
                'env': {
                    'HOME': home
                },
                'async': true
            };
            var cmd = `git checkout ${pieces[1]}`;

            //eslint-disable-next-line no-unused-vars
            shell.exec(cmd, opts, function (code, stdout, stderr) {
                if (code !== 0) {
                    vscode.window.showErrorMessage(`git checkout returned: ${code}`);
                    return 'error';
                }
            });
        });
    });
}

function findBinary(binName, callback) {
    let cmd = `which ${binName}`

    if (process.platform === WINDOWS) {
        cmd = `where.exe ${binName}.exe`;
    }

    let opts = {
        'async': true,
        'env': {
            'HOME': process.env.HOME,
            'PATH': process.env.PATH
        }
    }

    shell.exec(cmd, opts, function (code, stdout, stderr) {
        if (code) {
            callback(code, stderr);
        } else {
            callback(null, stdout);
        }
    });
}

let deleteKubernetes = function () {
    findKindNameOrPrompt().then(function (kindName) {
        kubectl(`delete ${kindName}`);
    });
}

let applyKubernetes = function () {
    diffKubernetes(function () {
        vscode.window.showInformationMessage(
            'Do you wish to apply this change?',
            'Apply'
        ).then(
            function (result) {
                if (result === 'Apply') {
                    maybeRunKubernetesCommandForActiveWindow('apply -f');
                }
            }
            );
    });
}

let handleError = function (err) {
    if (err) {
        vscode.window.showErrorMessage(err);
    }
}

let diffKubernetes = function (callback) {
    getTextForActiveWindow(function (data, file) {
        console.log(data, file);
        var kindName = null;
        var fileName = null;
        if (data) {
            kindName = findKindNameForText(data);
            fileName = path.join(os.tmpdir(), 'local.json');
            fs.writeFile(fileName, data, handleError);
        } else if (file) {
            kindName = findKindName();
            fileName = file;
        } else {
            vscode.window.showInformationMessage('Nothing to diff.');
            return;
        }
        if (!kindName) {
            vscode.window.showWarningMessage('Could not find a valid API object');
            return;
        }
        kubectlInternal(` get -o json ${kindName}`, function (result, stdout, stderr) {
            if (result !== 0) {
                vscode.window.showErrorMessage('Error running command: ' + stderr);
                return;
            }
            var otherFile = path.join(os.tmpdir(), 'server.json');
            fs.writeFile(otherFile, stdout, handleError);
            vscode.commands.executeCommand(
                'vscode.diff',
                vscode.Uri.parse('file://' + otherFile),
                vscode.Uri.parse('file://' + fileName)).then(function (result) {
                    console.log(result);
                    if (callback) {
                        callback();
                    }
                });
        });
    });
}

let debugKubernetes = function () {
    buildPushThenExec(_debugInternal);
}

let _debugInternal = function (name, image) {
    // TODO: optionalize/customize the '-debug'
    // TODO: make this smarter.
    vscode.window.showInputBox('Debug command for your container:').then(function (cmd) {
        if (cmd) {
            _doDebug(name, image, cmd);
        }
    });
}

let _doDebug = function (name, image, cmd) {
    console.log(` run  ${name} -debug --image= ${image} -i --attach=false -- ${cmd}`);
    kubectlInternal(` run  ${name} -debug --image= ${image} -i --attach=false -- ${cmd}`, function (result, stdout, stderr) {
        if (result !== 0) {
            vscode.window.showErrorMessage('Failed to start debug container: ' + stderr);
            return;
        }
        findDebugPodsForApp(function (podList) {
            if (podList.items.length === 0) {
                vscode.window.showErrorMessage('Failed to find debug pod.');
                return;
            }
            var name = podList.items[0].metadata.name;
            vscode.window.showInformationMessage('Debug pod running as: ' + name);

            waitForRunningPod(name, function () {
                kubectl(` port-forward  ${name} 5858:5858 8000:8000`);
                vscode.commands.executeCommand(
                    'vscode.startDebug',
                    {
                        "type": "node",
                        "request": "attach",
                        "name": "Attach to Process",
                        "port": 5858,
                        "localRoot": vscode.workspace.rootPath,
                        "remoteRoot": "/"
                    }
                ).then(() => { }, err => {
                    vscode.window.showInformationMessage('Error: ' + err.message);
                });
            });
        });
    });
}

let waitForRunningPod = function (name, callback) {
    kubectlInternal(` get pods ${name} -o jsonpath --template="{.status.phase}"`,
        function (result, stdout, stderr) {
            if (result !== 0) {
                vscode.window.showErrorMessage(`Failed to run command (${result}) ${stderr}`);
                return;
            }
            if (stdout === 'Running') {
                callback();
                return;
            }
            setTimeout(function () { waitForRunningPod(name, callback) }, 1000);
        });
}

exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() { }

exports.deactivate = deactivate;