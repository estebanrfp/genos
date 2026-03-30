let summarizeInstallOutput = function (text) {
  const raw = text.trim();
  if (!raw) {
    return;
  }
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return;
  }
  const preferred =
    lines.find((line) => /^error\b/i.test(line)) ??
    lines.find((line) => /\b(err!|error:|failed)\b/i.test(line)) ??
    lines.at(-1);
  if (!preferred) {
    return;
  }
  const normalized = preferred.replace(/\s+/g, " ").trim();
  const maxLen = 200;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}\u2026` : normalized;
};
export function formatInstallFailureMessage(result) {
  const code = typeof result.code === "number" ? `exit ${result.code}` : "unknown exit";
  const summary = summarizeInstallOutput(result.stderr) ?? summarizeInstallOutput(result.stdout);
  if (!summary) {
    return `Install failed (${code})`;
  }
  return `Install failed (${code}): ${summary}`;
}
