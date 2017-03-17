'use strict';

import * as path from 'path';
import * as vscode from 'vscode';

import {findPods} from '../extension';
import {kubectl, kubectlInternal, waitForRunningPod, buildPushThenExec } from '../kubeutil';

export let debugKubernetes = function () {
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

function findDebugPodsForApp(callback) {
    var appName = path.basename(vscode.workspace.rootPath);
    findPods(`run=${appName}-debug`, callback);
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