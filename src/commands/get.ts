import * as vscode from 'vscode';

import {
    maybeRunKubernetesCommandForActiveWindow,
    findKindName,
    kubectl
} from '../kubeutil';

export default getKubernetes => {
    var kindName = findKindName();
    if (kindName) {
        maybeRunKubernetesCommandForActiveWindow('get --no-headers -o wide -f ');
        return;
    }
    vscode.window.showInputBox({
        prompt: "What resource do you want to get?"
    }).then((value) => {
        kubectl(` get ${value} -o wide --no-headers`);
    });
}