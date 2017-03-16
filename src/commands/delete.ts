import {findKindNameOrPrompt, kubectl} from '../kubeutil';

export let deleteKubernetes = function () {
    findKindNameOrPrompt().then(function (kindName) {
        kubectl(`delete ${kindName}`);
    });
}