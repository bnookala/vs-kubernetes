import * as vscode from 'vscode';
import {setExplainStatus, getExplainStatus} from '../hover/explainProvider'

let statusBarItem = undefined;

export default toggleExplainActiveWindow => {
    var editor = vscode.window.activeTextEditor;
    var bar = initStatusBar();

    if (!editor) {
        vscode.window.showErrorMessage("No active editor!");
        bar.hide();
        return; // No open text editor
    }

    let explainActive = getExplainStatus();
    setExplainStatus(!explainActive);

    if (explainActive) {
        vscode.window.showInformationMessage("Kubernetes API explain activated.");
        bar.show();
    } else {
        vscode.window.showInformationMessage("Kubernetes API explain deactivated.");
        bar.hide();
    }
}

const initStatusBar = () => {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusBarItem.text = "kubernetes-api-explain";
    }

    return statusBarItem;
}