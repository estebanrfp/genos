import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../../../config/paths.js";
const logCommand = async (event) => {
  if (event.type !== "command") {
    return;
  }
  try {
    const stateDir = resolveStateDir(process.env, os.homedir);
    const logDir = path.join(stateDir, "logs");
    await fs.mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, "commands.log");
    const logLine =
      JSON.stringify({
        timestamp: event.timestamp.toISOString(),
        action: event.action,
        sessionKey: event.sessionKey,
        senderId: event.context.senderId ?? "unknown",
        source: event.context.commandSource ?? "unknown",
      }) + "\n";
    await fs.appendFile(logFile, logLine, "utf-8");
  } catch (err) {
    console.error(
      "[command-logger] Failed to log command:",
      err instanceof Error ? err.message : String(err),
    );
  }
};
export default logCommand;
