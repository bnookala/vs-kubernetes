import * as vscode from 'vscode';
import * as path from 'path';

import { kubectlInternal } from '../kubeutil';

export default loadKubernetes => {
    vscode.window.showInputBox({
        prompt: "What resource do you want to load?"
    }).then((value) => {
        kubectlInternal(` -o json get ${value}`, (result, stdout, stderr) => {
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