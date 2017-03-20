import * as vscode from 'vscode';

let watchTerminal;

export default watchKubernetes => {
    vscode.window.showInputBox().then((value) => {
        // let's try to keep only one `watch` terminal opened at a time, since
        // they don't dispose automatically (unless the lil garbage can is clicked)
        if (watchTerminal) {
            watchTerminal.hide();
            watchTerminal.dispose();
        }

        // TODO: validate the value option from
        let watchCommand = ['get', value, '--all-namespaces', '--watch']

        // TODO: ensure that kubectl exists before running this.
        watchTerminal = vscode.window.createTerminal('Kubernetes Watch', 'kubectl', watchCommand)
        watchTerminal.show();
    });
}