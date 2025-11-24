import { parseStandardSetUnsetSlashCommand } from "./commands-setunset-standard.js";
import { isValidSectionNum } from "./config-sections.js";

export function parseConfigCommand(raw) {
  const trimmed = raw.trim();

  // "/config" alone → menu
  if (/^\/config\s*$/i.test(trimmed)) {
    return { action: "menu" };
  }

  // "/config <N>" → section view
  const numMatch = trimmed.match(/^\/config\s+(\d+)\s*$/i);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return isValidSectionNum(num)
      ? { action: "section", sectionNum: num }
      : { action: "error", message: "Invalid section number. Use /config to see the menu." };
  }

  // Everything else → standard set/unset/show parser
  return parseStandardSetUnsetSlashCommand({
    raw,
    slash: "/config",
    invalidMessage: "Invalid /config syntax.",
    usageMessage: "Usage: /config [N] | show | set | unset",
    onKnownAction: (action, args) => {
      if (action === "show" || action === "get") {
        return { action: "show", path: args || undefined };
      }
      return;
    },
  });
}
