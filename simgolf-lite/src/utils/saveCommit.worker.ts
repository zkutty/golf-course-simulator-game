import { installSaveCommitWorker, type SaveCommitPort } from "./saveCommitWorkerHandler";

// DOM and Worker MessageEvent shapes agree; keep worker-only types out of the app's global libs.
const scope = globalThis as unknown as SaveCommitPort & { indexedDB: IDBFactory };
installSaveCommitWorker(scope, scope.indexedDB);
