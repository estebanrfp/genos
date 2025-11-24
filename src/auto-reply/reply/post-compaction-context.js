import fs from "node:fs";
import path from "node:path";
const MAX_CONTEXT_CHARS = 4000;
export async function readPostCompactionContext(workspaceDir) {
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  const securityPath = path.join(workspaceDir, "SECURITY.md");
  try {
    if (!fs.existsSync(agentsPath)) {
      return null;
    }
    const content = await fs.promises.readFile(agentsPath, "utf-8");
    const sections = extractSections(content, ["Session Startup", "Red Lines"]);
    let securityContent = null;
    try {
      if (fs.existsSync(securityPath)) {
        securityContent = (await fs.promises.readFile(securityPath, "utf-8")).trim();
      }
    } catch {}
    if (sections.length === 0 && !securityContent) {
      return null;
    }
    const parts = [...sections];
    if (securityContent) {
      parts.push(securityContent);
    }
    const combined = parts.join("\n\n");
    const safeContent =
      combined.length > MAX_CONTEXT_CHARS
        ? combined.slice(0, MAX_CONTEXT_CHARS) + "\n...[truncated]..."
        : combined;
    return (
      `[Post-compaction context refresh]\n\nSession was just compacted. The conversation summary above is a hint, NOT a substitute for your startup sequence. Execute your Session Startup sequence now \u2014 read the required files before responding to the user.

Critical rules from AGENTS.md:\n\n` + safeContent
    );
  } catch {
    return null;
  }
}
export function extractSections(content, sectionNames) {
  const results = [];
  const lines = content.split("\n");
  for (const name of sectionNames) {
    let sectionLines = [];
    let inSection = false;
    let sectionLevel = 0;
    let inCodeBlock = false;
    for (const line of lines) {
      if (line.trimStart().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        if (inSection) {
          sectionLines.push(line);
        }
        continue;
      }
      if (inCodeBlock) {
        if (inSection) {
          sectionLines.push(line);
        }
        continue;
      }
      const headingMatch = line.match(/^(#{2,3})\s+(.+?)\s*$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const headingText = headingMatch[2];
        if (!inSection) {
          if (headingText.toLowerCase() === name.toLowerCase()) {
            inSection = true;
            sectionLevel = level;
            sectionLines = [line];
            continue;
          }
        } else {
          if (level <= sectionLevel) {
            break;
          }
          sectionLines.push(line);
          continue;
        }
      }
      if (inSection) {
        sectionLines.push(line);
      }
    }
    if (sectionLines.length > 0) {
      results.push(sectionLines.join("\n").trim());
    }
  }
  return results;
}
