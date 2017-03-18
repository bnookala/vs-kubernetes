import * as vscode from 'vscode';
import { diffKubernetes } from './diff';
import { maybeRunKubernetesCommandForActiveWindow } from '../kubeutil'

export let applyKubernetes = function () {
    diffKubernetes(function () {
        vscode.window.showInformationMessage(
            'Do you wish to apply this change?',
            'Apply'
        ).then(
            function (result) {
                if (result === 'Apply') {
                    maybeRunKubernetesCommandForActiveWindow('apply -f');
                }
            }
            );
    });
}