let stripResetSuffix = function (fileName) {
  const resetIndex = fileName.indexOf(".reset.");
  return resetIndex === -1 ? fileName : fileName.slice(0, resetIndex);
};
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../../../agents/agent-scope.js";
import { resolveStateDir } from "../../../config/paths.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { resolveAgentIdFromSessionKey } from "../../../routing/session-key.js";
import { hasInterSessionUserProvenance } from "../../../sessions/input-provenance.js";
import { resolveHookConfig } from "../../config.js";
import { generateSlugViaLLM } from "../../llm-slug-generator.js";
const log = createSubsystemLogger("hooks/session-memory");
async function getRecentSessionContent(sessionFilePath, messageCount = 15) {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");
    const allMessages = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          const role = msg.role;
          if ((role === "user" || role === "assistant") && msg.content) {
            if (role === "user" && hasInterSessionUserProvenance(msg)) {
              continue;
            }
            const text = Array.isArray(msg.content)
              ? msg.content.find((c) => c.type === "text")?.text
              : msg.content;
            if (text && !text.startsWith("/")) {
              allMessages.push(`${role}: ${text}`);
            }
          }
        }
      } catch {}
    }
    const recentMessages = allMessages.slice(-messageCount);
    return recentMessages.join("\n");
  } catch {
    return null;
  }
}
async function getRecentSessionContentWithResetFallback(sessionFilePath, messageCount = 15) {
  const primary = await getRecentSessionContent(sessionFilePath, messageCount);
  if (primary) {
    return primary;
  }
  try {
    const dir = path.dirname(sessionFilePath);
    const base = path.basename(sessionFilePath);
    const resetPrefix = `${base}.reset.`;
    const files = await fs.readdir(dir);
    const resetCandidates = files.filter((name) => name.startsWith(resetPrefix)).toSorted();
    if (resetCandidates.length === 0) {
      return primary;
    }
    const latestResetPath = path.join(dir, resetCandidates[resetCandidates.length - 1]);
    const fallback = await getRecentSessionContent(latestResetPath, messageCount);
    if (fallback) {
      log.debug("Loaded session content from reset fallback", {
        sessionFilePath,
        latestResetPath,
      });
    }
    return fallback || primary;
  } catch {
    return primary;
  }
}
async function findPreviousSessionFile(params) {
  try {
    const files = await fs.readdir(params.sessionsDir);
    const fileSet = new Set(files);
    const baseFromReset = params.currentSessionFile
      ? stripResetSuffix(path.basename(params.currentSessionFile))
      : undefined;
    if (baseFromReset && fileSet.has(baseFromReset)) {
      return path.join(params.sessionsDir, baseFromReset);
    }
    const trimmedSessionId = params.sessionId?.trim();
    if (trimmedSessionId) {
      const canonicalFile = `${trimmedSessionId}.jsonl`;
      if (fileSet.has(canonicalFile)) {
        return path.join(params.sessionsDir, canonicalFile);
      }
      const topicVariants = files
        .filter(
          (name) =>
            name.startsWith(`${trimmedSessionId}-topic-`) &&
            name.endsWith(".jsonl") &&
            !name.includes(".reset."),
        )
        .toSorted()
        .toReversed();
      if (topicVariants.length > 0) {
        return path.join(params.sessionsDir, topicVariants[0]);
      }
    }
    if (!params.currentSessionFile) {
      return;
    }
    const nonResetJsonl = files
      .filter((name) => name.endsWith(".jsonl") && !name.includes(".reset."))
      .toSorted()
      .toReversed();
    if (nonResetJsonl.length > 0) {
      return path.join(params.sessionsDir, nonResetJsonl[0]);
    }
  } catch {}
  return;
}
const saveSessionToMemory = async (event) => {
  if (event.type !== "command" || event.action !== "new") {
    return;
  }
  try {
    log.debug("Hook triggered for /new command");
    const context = event.context || {};
    const cfg = context.cfg;
    const agentId = resolveAgentIdFromSessionKey(event.sessionKey);
    const workspaceDir = cfg
      ? resolveAgentWorkspaceDir(cfg, agentId)
      : path.join(resolveStateDir(process.env, os.homedir), "workspace");
    const memoryDir = path.join(workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    const now = new Date(event.timestamp);
    const dateStr = now.toISOString().split("T")[0];
    const sessionEntry = context.previousSessionEntry || context.sessionEntry || {};
    const currentSessionId = sessionEntry.sessionId;
    let currentSessionFile = sessionEntry.sessionFile || undefined;
    if (!currentSessionFile || currentSessionFile.includes(".reset.")) {
      const sessionsDirs = new Set();
      if (currentSessionFile) {
        sessionsDirs.add(path.dirname(currentSessionFile));
      }
      sessionsDirs.add(path.join(workspaceDir, "sessions"));
      for (const sessionsDir of sessionsDirs) {
        const recoveredSessionFile = await findPreviousSessionFile({
          sessionsDir,
          currentSessionFile,
          sessionId: currentSessionId,
        });
        if (!recoveredSessionFile) {
          continue;
        }
        currentSessionFile = recoveredSessionFile;
        log.debug("Found previous session file", { file: currentSessionFile });
        break;
      }
    }
    log.debug("Session context resolved", {
      sessionId: currentSessionId,
      sessionFile: currentSessionFile,
      hasCfg: Boolean(cfg),
    });
    const sessionFile = currentSessionFile || undefined;
    const hookConfig = resolveHookConfig(cfg, "session-memory");
    const messageCount =
      typeof hookConfig?.messages === "number" && hookConfig.messages > 0
        ? hookConfig.messages
        : 15;
    let slug = null;
    let sessionContent = null;
    if (sessionFile) {
      sessionContent = await getRecentSessionContentWithResetFallback(sessionFile, messageCount);
      log.debug("Session content loaded", {
        length: sessionContent?.length ?? 0,
        messageCount,
      });
      const isTestEnv =
        process.env.GENOS_TEST_FAST === "1" ||
        process.env.VITEST === "true" ||
        process.env.VITEST === "1" ||
        false;
      const allowLlmSlug = !isTestEnv && hookConfig?.llmSlug !== false;
      if (sessionContent && cfg && allowLlmSlug) {
        log.debug("Calling generateSlugViaLLM...");
        slug = await generateSlugViaLLM({ sessionContent, cfg });
        log.debug("Generated slug", { slug });
      }
    }
    if (!slug) {
      const timeSlug = now.toISOString().split("T")[1].split(".")[0].replace(/:/g, "");
      slug = timeSlug.slice(0, 4);
      log.debug("Using fallback timestamp slug", { slug });
    }
    const filename = `${dateStr}-${slug}.md`;
    const memoryFilePath = path.join(memoryDir, filename);
    log.debug("Memory file path resolved", {
      filename,
      path: memoryFilePath.replace(os.homedir(), "~"),
    });
    const timeStr = now.toISOString().split("T")[1].split(".")[0];
    const sessionId = sessionEntry.sessionId || "unknown";
    const source = context.commandSource || "unknown";
    const entryParts = [
      `# Session: ${dateStr} ${timeStr} UTC`,
      "",
      `- **Session Key**: ${event.sessionKey}`,
      `- **Session ID**: ${sessionId}`,
      `- **Source**: ${source}`,
      "",
    ];
    if (sessionContent) {
      entryParts.push("## Conversation Summary", "", sessionContent, "");
    }
    const entry = entryParts.join("\n");
    await fs.writeFile(memoryFilePath, entry, "utf-8");
    log.debug("Memory file written successfully");
    const relPath = memoryFilePath.replace(os.homedir(), "~");
    log.info(`Session context saved to ${relPath}`);
  } catch (err) {
    if (err instanceof Error) {
      log.error("Failed to save session memory", {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
      });
    } else {
      log.error("Failed to save session memory", { error: String(err) });
    }
  }
};
export default saveSessionToMemory;
