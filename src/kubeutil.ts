'use strict';

import * as shell from 'shelljs';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import {kubectlFound} from './extension';

const WINDOWS = 'win32';
const outputChannel = vscode.window.createOutputChannel('vs-kubernetes');

export let waitForRunningPod = function (name, callback) {
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

export function kubectl(command) {
    kubectlInternal(command, kubectlDone);
}

export function kubectlDone(result, stdout, stderr) {
    if (result !== 0) {
        vscode.window.showErrorMessage("Kubectl command failed: " + stderr);
        return;
    }

    outputChannel.append(stdout);
    outputChannel.show(true);
}

export function kubectlInternal(command, handler) {
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

export function shellExec(cmd, handler) {
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

export function buildPushThenExec(fn) {
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

export function findKindName() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        return null; // No open text editor
    }

    const text = editor.document.getText();

    if (text.length === 0) {
        return null; // No text in open editor.
    }

    return findKindNameForText(text);
}

export function findKindNameForText(text) {
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

export function findKindNameOrPrompt() {
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

function findNameAndImage() {
    return {
        'then': _findNameAndImageInternal
    };
}

function findVersion() {
    return {
        then: findVersionInternal
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