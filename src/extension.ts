'use strict';

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// Standard node imports
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// External Dependencies
import * as dockerfileParse from 'dockerfile-parse';
import * as shell from 'shelljs';
import * as yaml from 'js-yaml';

export const WINDOWS = 'win32';
export let kubectlFound = false;

import {
    shellExec,
    kubectlInternal,
    kubectl,
    kubectlDone,
    buildPushThenExec,
    findKindName,
    findKindNameOrPrompt,
    findKindNameForText,
    maybeRunKubernetesCommandForActiveWindow

} from './kubeutil';

import { debugKubernetes } from './commands/debug';
import { deleteKubernetes } from './commands/delete';
import { diffKubernetes } from './commands/diff';
import { applyKubernetes } from './commands/apply';
import { provideHover, explainActiveWindow } from './hover/hoverProvider';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context) {
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
        vscode.commands.registerCommand('extension.vsKubernetesWatch', watchKubernetes),
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

    subscriptions.forEach((sub) => context.subscriptions.push(sub), this);
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

export function findPods(labelQuery, callback) {
    let findPodsCmd = ' get pods -o json'

    if (labelQuery) {
        findPodsCmd = ` get pods -o json -l ${labelQuery}`
    }

    kubectlInternal(findPodsCmd, function (result, stdout, stderr) {
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
    if (!vscode.workspace.rootPath) {
        findPods('', callback);
        return;
    }

    var appName = path.basename(vscode.workspace.rootPath);
    findPods(`run=${appName}`, callback);
}

function runKubernetes() {
    buildPushThenExec(function(name, image) {
        kubectlInternal(`run ${name} --image=${image}`, kubectlDone);
    });
}

function curry(fn, arg) {
    return function () {
        var args = Array.prototype.slice.call(arguments, 1);
        args.push(arg);
        return fn.apply(this, args);
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


var watchTerminal;

function watchKubernetes () {
    vscode.window.showInputBox().then(function (value) {
        // let's try to keep only one `watch` terminal opened at a time, since
        // they don't dispose automatically (unless the lil garbage can is clicked)
        if (watchTerminal) {
            watchTerminal.hide();
            watchTerminal.dispose();
        }

        // TODO: validate the value option.
        let watchCommand = ['get', value, '--all-namespaces', '--watch']
        watchTerminal = vscode.window.createTerminal('Kubernetes Watch', 'kubectl', watchCommand)
        watchTerminal.show();
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
    var opts:any = { 'prompt': 'Please provide a command to execute' };

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
                // TODO: this is a vote of no-confidence. The pre-filled value in showInputBox is
                // not a guarantee that the value is actually 'bash'
                let termCmd = ['exec', '-it', pod.metadata.name, cmd];
                var term = vscode.window.createTerminal('exec', 'kubectl', termCmd);
                term.show();
                return;
            }

            let execCmd = ' exec ' + pod.metadata.name + ' ' + cmd;
            var fn = curry(kubectlOutput, pod.metadata.name + "-exec")
            kubectlInternal(execCmd, fn);
        });
    });
}

function syncKubernetes() {
    selectPodForApp(function (pod) {
        selectContainerForPod(pod, function (container) {
            var pieces = container.image.split(':');
            if (pieces.length !== 2) {
                vscode.window.showErrorMessage(`unexpected image name: ${container.image}`);
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

// this method is called when your extension is deactivated
export function deactivate() { }