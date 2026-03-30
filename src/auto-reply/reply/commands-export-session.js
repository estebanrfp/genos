let loadTemplate = function (fileName) {
    return fs.readFileSync(path.join(EXPORT_HTML_DIR, fileName), "utf-8");
  },
  generateHtml = function (sessionData) {
    const template = loadTemplate("template.html");
    const templateCss = loadTemplate("template.css");
    const templateJs = loadTemplate("template.js");
    const markedJs = loadTemplate(path.join("vendor", "marked.min.js"));
    const hljsJs = loadTemplate(path.join("vendor", "highlight.min.js"));
    const themeVars = `
    --cyan: #00d7ff;
    --blue: #5f87ff;
    --green: #b5bd68;
    --red: #cc6666;
    --yellow: #ffff00;
    --gray: #808080;
    --dimGray: #666666;
    --darkGray: #505050;
    --accent: #8abeb7;
    --selectedBg: #3a3a4a;
    --userMsgBg: #343541;
    --toolPendingBg: #282832;
    --toolSuccessBg: #283228;
    --toolErrorBg: #3c2828;
    --customMsgBg: #2d2838;
    --text: #e0e0e0;
    --dim: #666666;
    --muted: #808080;
    --border: #5f87ff;
    --borderAccent: #00d7ff;
    --borderMuted: #505050;
    --success: #b5bd68;
    --error: #cc6666;
    --warning: #ffff00;
    --thinkingText: #808080;
    --userMessageBg: #343541;
    --userMessageText: #e0e0e0;
    --customMessageBg: #2d2838;
    --customMessageText: #e0e0e0;
    --customMessageLabel: #9575cd;
    --toolTitle: #e0e0e0;
    --toolOutput: #808080;
    --mdHeading: #f0c674;
    --mdLink: #81a2be;
    --mdLinkUrl: #666666;
    --mdCode: #8abeb7;
    --mdCodeBlock: #b5bd68;
  `;
    const bodyBg = "#1e1e28";
    const containerBg = "#282832";
    const infoBg = "#343541";
    const sessionDataBase64 = Buffer.from(JSON.stringify(sessionData)).toString("base64");
    const css = templateCss
      .replace("/* {{THEME_VARS}} */", themeVars.trim())
      .replace("/* {{BODY_BG_DECL}} */", `--body-bg: ${bodyBg};`)
      .replace("/* {{CONTAINER_BG_DECL}} */", `--container-bg: ${containerBg};`)
      .replace("/* {{INFO_BG_DECL}} */", `--info-bg: ${infoBg};`);
    return template
      .replace("{{CSS}}", css)
      .replace("{{JS}}", templateJs)
      .replace("{{SESSION_DATA}}", sessionDataBase64)
      .replace("{{MARKED_JS}}", markedJs)
      .replace("{{HIGHLIGHT_JS}}", hljsJs);
  },
  parseExportArgs = function (commandBodyNormalized) {
    const normalized = commandBodyNormalized.trim();
    if (normalized === "/export-session" || normalized === "/export") {
      return {};
    }
    const args = normalized.replace(/^\/(export-session|export)\s*/, "").trim();
    const outputPath = args.split(/\s+/).find((part) => !part.startsWith("-"));
    return { outputPath };
  };
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ensureSessionFileDecrypted } from "../../agents/pi-embedded-runner/session-manager-cache.js";
import {
  resolveDefaultSessionStorePath,
  resolveSessionFilePath,
} from "../../config/sessions/paths.js";
import { loadSessionStore } from "../../config/sessions/store.js";
import { resolveCommandsSystemPromptBundle } from "./commands-system-prompt.js";
const EXPORT_HTML_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "export-html");
export async function buildExportSessionReply(params) {
  const args = parseExportArgs(params.command.commandBodyNormalized);
  const sessionEntry = params.sessionEntry;
  if (!sessionEntry?.sessionId) {
    return { text: "\u274C No active session found." };
  }
  const storePath = resolveDefaultSessionStorePath(params.agentId);
  const store = loadSessionStore(storePath, { skipCache: true });
  const entry = store[params.sessionKey];
  if (!entry?.sessionId) {
    return { text: `\u274C Session not found: ${params.sessionKey}` };
  }
  let sessionFile;
  try {
    sessionFile = resolveSessionFilePath(entry.sessionId, entry, {
      agentId: params.agentId,
      sessionsDir: path.dirname(storePath),
    });
  } catch (err) {
    return {
      text: `\u274C Failed to resolve session file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!fs.existsSync(sessionFile)) {
    return { text: `\u274C Session file not found: ${sessionFile}` };
  }
  ensureSessionFileDecrypted(sessionFile);
  const sessionManager = SessionManager.open(sessionFile);
  const entries = sessionManager.getEntries();
  const header = sessionManager.getHeader();
  const leafId = sessionManager.getLeafId();
  const { systemPrompt, tools } = await resolveCommandsSystemPromptBundle(params);
  const sessionData = {
    header,
    entries,
    leafId,
    systemPrompt,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  };
  const html = generateHtml(sessionData);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultFileName = `genosos-session-${entry.sessionId.slice(0, 8)}-${timestamp}.html`;
  const outputPath = args.outputPath
    ? path.resolve(
        args.outputPath.startsWith("~")
          ? args.outputPath.replace("~", process.env.HOME ?? "")
          : args.outputPath,
      )
    : path.join(params.workspaceDir, defaultFileName);
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, html, "utf-8");
  const relativePath = path.relative(params.workspaceDir, outputPath);
  const displayPath = relativePath.startsWith("..") ? outputPath : relativePath;
  return {
    text: [
      "\u2705 Session exported!",
      "",
      `\uD83D\uDCC4 File: ${displayPath}`,
      `\uD83D\uDCCA Entries: ${entries.length}`,
      `\uD83E\uDDE0 System prompt: ${systemPrompt.length.toLocaleString()} chars`,
      `\uD83D\uDD27 Tools: ${tools.length}`,
    ].join("\n"),
  };
}
