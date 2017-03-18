import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { kubectlInternal } from '../kubeutil';


let explainActive = false;
let statusBarItem = undefined;

function initStatusBar() {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = "kubernetes-api-explain";
    }

    return statusBarItem;
}

export function explainActiveWindow() {
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

// eslint-disable-next-line no-unused-vars
export async function provideHover(document:vscode.TextDocument, position, token): Promise<vscode.Hover> {
    return new Promise<vscode.Hover>(async resolve => {
        if (!explainActive) {
            return undefined;
        }
        var body = document.getText();
        var obj:any = {};

        // Switch over the supported markups.
        try {
            if (document.languageId === 'json') {
                obj = JSON.parse(body);
            } else if (document.languageId === 'yaml') {
                obj = yaml.safeLoad(body);
            } else {
                return undefined;
            }
        } catch (err) {
            return undefined;
        }

        // Not a k8s object.
        if (!obj.kind) {
            return undefined;
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

        let hoverText: string = await explain(obj, field);
        let hover = new vscode.Hover(hoverText);

        resolve(hover);
    });
};

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

async function explain(obj, field):Promise<string> {
    return new Promise<string>(resolve => {
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

            resolve(stdout);
        });
    });
}