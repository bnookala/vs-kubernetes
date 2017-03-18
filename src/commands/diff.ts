import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';

import {
    findKindNameForText,
    findKindName,
    kubectlInternal,
} from '../kubeutil'

export let diffKubernetes = function (callback) {
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

let handleError = function (err) {
    if (err) {
        vscode.window.showErrorMessage(err);
    }
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