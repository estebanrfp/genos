import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { resolveConfigDir } from "../utils.js";
export function loadDotEnv(opts) {
  const quiet = opts?.quiet ?? true;
  dotenv.config({ quiet });
  const globalEnvPath = path.join(resolveConfigDir(process.env), ".env");
  if (!fs.existsSync(globalEnvPath)) {
    return;
  }
  dotenv.config({ quiet, path: globalEnvPath, override: false });
}
