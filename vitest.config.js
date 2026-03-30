import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// node:sqlite is experimental prior to Node 23.4 — ensure workers get the flag.
if (!process.versions.bun) {
  const existing = process.env.NODE_OPTIONS ?? "";
  if (!existing.includes("--experimental-sqlite")) {
    process.env.NODE_OPTIONS = `${existing} --experimental-sqlite`.trim();
  }
}

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const isWindows = process.platform === "win32";
const localWorkers = Math.max(4, Math.min(16, os.cpus().length));
const ciWorkers = isWindows ? 2 : 3;

export default defineConfig({
  resolve: {
    // Keep this ordered: the base `genosos/plugin-sdk` alias is a prefix match.
    alias: [
      {
        find: "genosos/plugin-sdk/account-id",
        replacement: path.join(repoRoot, "src", "plugin-sdk", "account-id.js"),
      },
      {
        find: "genosos/plugin-sdk",
        replacement: path.join(repoRoot, "src", "plugin-sdk", "index.js"),
      },
    ],
  },
  test: {
    testTimeout: 120_000,
    hookTimeout: isWindows ? 180_000 : 120_000,
    // Many suites rely on `vi.stubEnv(...)` and expect it to be scoped to the test.
    // This is especially important under `pool=vmForks` where env leaks cross-file.
    unstubEnvs: true,
    // Same rationale as unstubEnvs: avoid cross-test pollution under vmForks.
    unstubGlobals: true,
    pool: "forks",
    maxWorkers: isCI ? ciWorkers : localWorkers,
    include: [
      "src/**/*.test.js",
      "extensions/**/*.test.js",
      "test/**/*.test.js",
      "ui/src/ui/views/usage-render-details.test.js",
    ],
    setupFiles: ["test/setup.js"],
    exclude: [
      "dist/**",
      "apps/macos/**",
      "apps/macos/.build/**",
      "**/node_modules/**",
      "**/vendor/**",
      "dist/GenosOS.app/**",
      "**/*.live.test.js",
      "**/*.e2e.test.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Keep coverage stable without an ever-growing exclude list:
      // only count files actually exercised by the test suite.
      all: false,
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 55,
        statements: 70,
      },
      // Anchor to repo-root `src/` only. Without this, coverage globs can
      // unintentionally match nested `*/src/**` folders (extensions, apps, etc).
      include: ["./src/**/*.js"],
      exclude: [
        // Never count workspace packages/apps toward core coverage thresholds.
        "extensions/**",
        "apps/**",
        "ui/**",
        "test/**",
        "src/**/*.test.js",
        // Entrypoints and wiring (covered by CI smoke + manual/e2e flows).
        "src/entry.js",
        "src/index.js",
        "src/runtime.js",
        "src/channel-web.js",
        "src/extensionAPI.js",
        "src/logging.js",
        "src/cli/**",
        "src/commands/**",
        "src/daemon/**",
        "src/hooks/**",
        "src/macos/**",

        // Large integration surfaces; validated via e2e/manual/contract tests.
        "src/acp/**",
        "src/agents/**",
        "src/channels/**",
        "src/gateway/**",
        "src/line/**",
        "src/media-understanding/**",
        "src/node-host/**",
        "src/plugins/**",
        "src/providers/**",

        // Some agent integrations are intentionally validated via manual/e2e runs.
        "src/agents/model-scan.js",
        "src/agents/pi-embedded-runner.js",
        "src/agents/sandbox-paths.js",
        "src/agents/sandbox.js",
        "src/agents/skills-install.js",
        "src/agents/pi-tool-definition-adapter.js",
        "src/agents/tools/discord-actions*.js",
        "src/agents/tools/slack-actions.js",

        // Hard-to-unit-test modules; exercised indirectly by integration tests.
        "src/infra/state-migrations.js",
        "src/infra/skills-remote.js",
        "src/infra/update-check.js",
        "src/infra/ports-inspect.js",
        "src/infra/outbound/outbound-session.js",
        "src/memory/batch-gemini.js",

        // Gateway server integration surfaces are intentionally validated via manual/e2e runs.
        "src/gateway/control-ui.js",
        "src/gateway/server-bridge.js",
        "src/gateway/server-channels.js",
        "src/gateway/server-methods/config.js",
        "src/gateway/server-methods/send.js",
        "src/gateway/server-methods/skills.js",
        "src/gateway/server-methods/talk.js",
        "src/gateway/server-methods/web.js",
        "src/gateway/server-methods/wizard.js",

        // Process bridges are hard to unit-test in isolation.
        "src/gateway/call.js",
        "src/process/tau-rpc.js",
        "src/process/exec.js",
        // Interactive UIs/flows are intentionally validated via manual/e2e runs.
        "src/tui/**",
        "src/wizard/**",
        // Channel surfaces are largely integration-tested (or manually validated).
        "src/discord/**",
        "src/imessage/**",
        "src/signal/**",
        "src/slack/**",
        "src/browser/**",
        "src/channels/web/**",
        "src/telegram/index.js",
        "src/telegram/proxy.js",
        "src/telegram/webhook-set.js",
        "src/telegram/**",
        "src/webchat/**",
        "src/gateway/server.js",
        "src/gateway/client.js",
        "src/gateway/protocol/**",
        "src/infra/tailscale.js",
      ],
    },
  },
});
