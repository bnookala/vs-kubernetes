import {
    findKindNameOrPrompt,
    kubectl
} from '../kubeutil';

export default deleteKubernetes => {
    findKindNameOrPrompt().then((kindName) => {
        kubectl(`delete ${kindName}`);
    });
}