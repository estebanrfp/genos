import { captureEnv } from "../test-utils/env.js";
export function snapshotStateDirEnv() {
  return captureEnv(["GENOS_STATE_DIR", "GENOS_STATE_DIR"]);
}
export function restoreStateDirEnv(snapshot) {
  snapshot.restore();
}
export function setStateDirEnv(stateDir) {
  process.env.GENOS_STATE_DIR = stateDir;
  delete process.env.GENOS_STATE_DIR;
}
