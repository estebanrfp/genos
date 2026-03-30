import { runExec } from "../process/exec.js";
import { defaultRuntime } from "../runtime.js";
export async function ensureBinary(name, exec = runExec, runtime = defaultRuntime) {
  await exec("which", [name]).catch(() => {
    runtime.error(`Missing required binary: ${name}. Please install it.`);
    runtime.exit(1);
  });
}
