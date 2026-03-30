import { execFileUtf8 } from "./exec-file.js";
export async function execSchtasks(args) {
  return await execFileUtf8("schtasks", args, { windowsHide: true });
}
