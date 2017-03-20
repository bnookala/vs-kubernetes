import * as vscode from 'vscode';

import diffKubernetes from './diff';
import { maybeRunKubernetesCommandForActiveWindow } from '../kubeutil'

export default applyKubernetes => {
    diffKubernetes(() => {
        vscode.window.showInformationMessage(
            'Do you wish to apply this change?',
            'Apply'
        ).then(
            (result) => {
                if (result !== 'Apply') {
                    return;
                }

                maybeRunKubernetesCommandForActiveWindow('apply -f');
            }
        );
    });
}