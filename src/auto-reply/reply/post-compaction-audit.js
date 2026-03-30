import fs from "node:fs";
import path from "node:path";
import { secureReadFileSync } from "../../infra/secure-io.js";
const DEFAULT_REQUIRED_READS = [/memory\/\d{4}-\d{2}-\d{2}\.md/];
export function auditPostCompactionReads(
  readFilePaths,
  workspaceDir,
  requiredReads = DEFAULT_REQUIRED_READS,
) {
  const normalizedReads = readFilePaths.map((p) => path.resolve(workspaceDir, p));
  const missingPatterns = [];
  for (const required of requiredReads) {
    if (typeof required === "string") {
      const requiredResolved = path.resolve(workspaceDir, required);
      const found = normalizedReads.some((r) => r === requiredResolved);
      if (!found) {
        missingPatterns.push(required);
      }
    } else {
      const found = readFilePaths.some((p) => {
        const rel = path.relative(workspaceDir, path.resolve(workspaceDir, p));
        const normalizedRel = rel.split(path.sep).join("/");
        return required.test(normalizedRel);
      });
      if (!found) {
        missingPatterns.push(required.source);
      }
    }
  }
  return { passed: missingPatterns.length === 0, missingPatterns };
}
export function readSessionMessages(sessionFile, maxLines = 100) {
  if (!fs.existsSync(sessionFile)) {
    return [];
  }
  try {
    const content = secureReadFileSync(sessionFile);
    const lines = content.trim().split("\n");
    const recentLines = lines.slice(-maxLines);
    const messages = [];
    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          messages.push(entry.message);
        }
      } catch {}
    }
    return messages;
  } catch {
    return [];
  }
}
export function extractReadPaths(messages) {
  const paths = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      continue;
    }
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.name === "read") {
        const filePath = block.input?.file_path ?? block.input?.path;
        if (typeof filePath === "string") {
          paths.push(filePath);
        }
      }
    }
  }
  return paths;
}
export function formatAuditWarning(missingPatterns) {
  const fileList = missingPatterns.map((p) => `  - ${p}`).join("\n");
  return (
    `\u26A0\uFE0F Post-Compaction Audit: The following required startup files were not read after context reset:
` +
    fileList +
    "\n\nPlease read them now using the Read tool before continuing. This ensures your operating protocols are restored after memory compaction."
  );
}
