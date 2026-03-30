let splitGraphemes = function (value) {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
  } catch {
    return Array.from(value);
  }
};
import { resolveCommitHash } from "../infra/git-commit.js";
import { isRich, theme } from "../terminal/theme.js";
let bannerEmitted = false;
const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const hasJsonFlag = (argv) => argv.some((arg) => arg === "--json" || arg.startsWith("--json="));
const hasVersionFlag = (argv) =>
  argv.some((arg) => arg === "--version" || arg === "-V" || arg === "-v");
export function formatCliBannerLine(version, options = {}) {
  const commit = options.commit ?? resolveCommitHash({ env: options.env });
  const commitLabel = commit ?? "unknown";
  const rich = options.richTty ?? isRich();
  const line = `\uD83E\uDD9E GenosOS ${version} (${commitLabel})`;
  return rich ? theme.success(line) : line;
}
const LOBSTER_ASCII = [
  "\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584\u2584",
  "\u2588\u2588\u2591\u2584\u2584\u2584\u2591\u2588\u2588\u2591\u2584\u2584\u2591\u2588\u2588\u2591\u2584\u2584\u2584\u2588\u2588\u2591\u2580\u2588\u2588\u2591\u2588\u2588\u2591\u2584\u2584\u2580\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2591\u2584\u2584\u2580\u2588\u2588\u2591\u2588\u2588\u2588\u2591\u2588\u2588",
  "\u2588\u2588\u2591\u2588\u2588\u2588\u2591\u2588\u2588\u2591\u2580\u2580\u2591\u2588\u2588\u2591\u2584\u2584\u2584\u2588\u2588\u2591\u2588\u2591\u2588\u2591\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2591\u2580\u2580\u2591\u2588\u2588\u2591\u2588\u2591\u2588\u2591\u2588\u2588",
  "\u2588\u2588\u2591\u2580\u2580\u2580\u2591\u2588\u2588\u2591\u2588\u2588\u2588\u2588\u2588\u2591\u2580\u2580\u2580\u2588\u2588\u2591\u2588\u2588\u2584\u2591\u2588\u2588\u2591\u2580\u2580\u2584\u2588\u2588\u2591\u2580\u2580\u2591\u2588\u2591\u2588\u2588\u2591\u2588\u2588\u2584\u2580\u2584\u2580\u2584\u2588\u2588",
  "\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580",
  "                  \uD83E\uDD9E GENOSOS \uD83E\uDD9E                    ",
  " ",
];
export function formatCliBannerArt(options = {}) {
  const rich = options.richTty ?? isRich();
  if (!rich) {
    return LOBSTER_ASCII.join("\n");
  }
  const colorChar = (ch) => {
    if (ch === "\u2588") {
      return theme.accentBright(ch);
    }
    if (ch === "\u2591") {
      return theme.accentDim(ch);
    }
    if (ch === "\u2580") {
      return theme.accent(ch);
    }
    return theme.muted(ch);
  };
  const colored = LOBSTER_ASCII.map((line) => {
    if (line.includes("GENOSOS")) {
      return (
        theme.muted("              ") +
        theme.accent("\uD83E\uDD9E") +
        theme.info(" GENOSOS ") +
        theme.accent("\uD83E\uDD9E")
      );
    }
    return splitGraphemes(line).map(colorChar).join("");
  });
  return colored.join("\n");
}
export function emitCliBanner(version, options = {}) {
  if (bannerEmitted) {
    return;
  }
  const argv = options.argv ?? process.argv;
  if (!process.stdout.isTTY) {
    return;
  }
  if (hasJsonFlag(argv)) {
    return;
  }
  if (hasVersionFlag(argv)) {
    return;
  }
  const line = formatCliBannerLine(version, options);
  process.stdout.write(`\n${line}\n\n`);
  bannerEmitted = true;
}
export function hasEmittedCliBanner() {
  return bannerEmitted;
}
