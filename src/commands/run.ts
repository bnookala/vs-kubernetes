import {
    buildPushThenExec,
    kubectlInternal,
    kubectlDone
} from '../kubeutil';

export default runKubernetes => {
    buildPushThenExec((name, image) => {
        kubectlInternal(`run ${name} --image=${image}`, kubectlDone);
    });
}