import fs from "node:fs/promises";
export async function prepareSessionManagerForRun(params) {
  const sm = params.sessionManager;
  const header = sm.fileEntries.find((e) => e.type === "session");
  const hasAssistant = sm.fileEntries.some(
    (e) => e.type === "message" && e.message?.role === "assistant",
  );
  if (!params.hadSessionFile && header) {
    header.id = params.sessionId;
    header.cwd = params.cwd;
    sm.sessionId = params.sessionId;
    return;
  }
  if (params.hadSessionFile && header && !hasAssistant) {
    await fs.writeFile(params.sessionFile, "", "utf-8");
    sm.fileEntries = [header];
    sm.byId?.clear?.();
    sm.labelsById?.clear?.();
    sm.leafId = null;
    sm.flushed = false;
  }
}
