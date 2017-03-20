import * as fs from 'fs';
import * as vscode from 'vscode';

import * as dockerFileParse from 'dockerfile-parse';

import {
    findKindName,
    kubectl
} from '../kubeutil';

export default exposeKubernetes => {
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

function getPorts() {
    var file = vscode.workspace.rootPath + '/Dockerfile';
    if (!fs.existsSync(file)) {
        return null;
    }
    try {
        var data = fs.readFileSync(file, 'utf-8');
        var obj = dockerFileParse(data);
        return obj.expose;
    } catch (ex) {
        console.log(ex);
        return null;
    }
}