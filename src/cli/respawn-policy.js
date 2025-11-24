import { hasHelpOrVersion } from "./argv.js";
export function shouldSkipRespawnForArgv(argv) {
  return hasHelpOrVersion(argv);
}
