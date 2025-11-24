let extractLabelNames = function (contents) {
    const labels = [];
    for (const line of contents.split("\n")) {
      if (!line.trim() || line.trimStart().startsWith("#")) {
        continue;
      }
      if (/^\s/.test(line)) {
        continue;
      }
      const match = line.match(/^(["'])(.+)\1\s*:/) ?? line.match(/^([^:]+):/);
      if (match) {
        const name = (match[2] ?? match[1] ?? "").trim();
        if (name) {
          labels.push(name);
        }
      }
    }
    return labels;
  },
  pickColor = function (label) {
    const prefix = label.includes(":") ? label.split(":", 1)[0].trim() : label.trim();
    return COLOR_BY_PREFIX.get(prefix) ?? "ededed";
  },
  resolveRepo = function () {
    const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      encoding: "utf8",
    }).trim();
    if (!remote) {
      throw new Error("Unable to determine repository from git remote.");
    }
    if (remote.startsWith("git@github.com:")) {
      return remote.replace("git@github.com:", "").replace(/\.git$/, "");
    }
    if (remote.startsWith("https://github.com/")) {
      return remote.replace("https://github.com/", "").replace(/\.git$/, "");
    }
    throw new Error(`Unsupported GitHub remote: ${remote}`);
  },
  fetchExistingLabels = function (repo) {
    const raw = execFileSync("gh", ["api", `repos/${repo}/labels?per_page=100`, "--paginate"], {
      encoding: "utf8",
    });
    const labels = JSON.parse(raw);
    return new Map(labels.map((label) => [label.name, label]));
  };
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const COLOR_BY_PREFIX = new Map([
  ["channel", "1d76db"],
  ["app", "6f42c1"],
  ["extensions", "0e8a16"],
  ["docs", "0075ca"],
  ["cli", "f9d0c4"],
  ["gateway", "d4c5f9"],
  ["size", "fbca04"],
]);
const configPath = resolve(".github/labeler.yml");
const EXTRA_LABELS = ["size: XS", "size: S", "size: M", "size: L", "size: XL"];
const labelNames = [
  ...new Set([...extractLabelNames(readFileSync(configPath, "utf8")), ...EXTRA_LABELS]),
];
if (!labelNames.length) {
  throw new Error("labeler.yml must declare at least one label.");
}
const repo = resolveRepo();
const existing = fetchExistingLabels(repo);
const missing = labelNames.filter((label) => !existing.has(label));
if (!missing.length) {
  console.log("All labeler labels already exist.");
  process.exit(0);
}
for (const label of missing) {
  const color = pickColor(label);
  execFileSync(
    "gh",
    ["api", "-X", "POST", `repos/${repo}/labels`, "-f", `name=${label}`, "-f", `color=${color}`],
    { stdio: "inherit" },
  );
  console.log(`Created label: ${label}`);
}
