let resolveGatewayRunOptions = function (opts, command) {
  const resolved = { ...opts };
  for (const key of GATEWAY_RUN_VALUE_KEYS) {
    const inherited = inheritOptionFromParent(command, key);
    if (key === "wsLog") {
      resolved[key] = inherited ?? resolved[key];
      continue;
    }
    resolved[key] = resolved[key] ?? inherited;
  }
  for (const key of GATEWAY_RUN_BOOLEAN_KEYS) {
    const inherited = inheritOptionFromParent(command, key);
    resolved[key] = Boolean(resolved[key] || inherited);
  }
  return resolved;
};
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_PATH,
  loadConfig,
  writeConfigFile,
  readConfigFileSnapshot,
  resolveStateDir,
  resolveGatewayPort,
} from "../../config/config.js";
import { resolveGatewayAuth } from "../../gateway/auth.js";
import { startGatewayServer } from "../../gateway/server.js";
import { setGatewayWsLogStyle } from "../../gateway/ws-logging.js";
import { setVerbose } from "../../globals.js";
import { GatewayLockError } from "../../infra/gateway-lock.js";
import { formatPortDiagnostics, inspectPortUsage } from "../../infra/ports.js";
import { setConsoleSubsystemFilter, setConsoleTimestampPrefix } from "../../logging/console.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { defaultRuntime } from "../../runtime.js";
import { formatCliCommand } from "../command-format.js";
import { inheritOptionFromParent } from "../command-options.js";
import { forceFreePortAndWait } from "../ports.js";
import { ensureDevGatewayConfig } from "./dev.js";
import { runGatewayLoop } from "./run-loop.js";
import {
  describeUnknownError,
  extractGatewayMiskeys,
  maybeExplainGatewayServiceStop,
  parsePort,
  toOptionString,
} from "./shared.js";
const gatewayLog = createSubsystemLogger("gateway");
const GATEWAY_RUN_VALUE_KEYS = [
  "port",
  "bind",
  "token",
  "auth",
  "password",
  "tailscale",
  "wsLog",
  "rawStreamPath",
];
const GATEWAY_RUN_BOOLEAN_KEYS = [
  "tailscaleResetOnExit",
  "allowUnconfigured",
  "dev",
  "reset",
  "force",
  "verbose",
  "claudeCliLogs",
  "compact",
  "rawStream",
];
async function runFirstRunSetup() {
  const { intro, text, select, outro, isCancel } = await import("@clack/prompts");
  const { ensureAuthProfileStore } = await import("../../agents/auth-profiles.js");
  const { promptAuthChoiceGrouped } = await import("../../commands/auth-choice-prompt.js");
  const { applyAuthChoice } = await import("../../commands/auth-choice.js");
  intro("Welcome to GenosOS — your private AI assistant");
  const autoText = async (opts) => {
    if (opts?.message?.includes("Token name") || opts?.message?.includes("blank")) {
      return "";
    }
    return text(opts);
  };
  const prompter = { select, text: autoText, note: async () => {}, outro };
  const authStore = ensureAuthProfileStore(undefined, { allowKeychainPrompt: false });
  const authChoice = await promptAuthChoiceGrouped({
    prompter,
    store: authStore,
    includeSkip: false,
  });
  if (isCancel(authChoice)) {
    return null;
  }
  let nextConfig = {};
  const authResult = await applyAuthChoice({
    authChoice,
    config: nextConfig,
    prompter,
    runtime: { error: console.error, exit: () => {} },
    setDefaultModel: true,
    opts: {},
  });
  nextConfig = authResult.config;
  const embeddingProvider = await select({
    message: "Embeddings provider (for memory search)",
    options: [
      { value: "openai", label: "OpenAI — best quality ($0.02/1M tokens)" },
      { value: "gemini", label: "Google Gemini — free tier" },
    ],
    initialValue: "openai",
  });
  if (isCancel(embeddingProvider)) {
    return null;
  }
  let embeddingKey;
  if (embeddingProvider === "openai") {
    const existing = nextConfig.env?.OPENAI_API_KEY;
    if (!existing) {
      const key = await text({
        message: "OpenAI API key (for embeddings)",
        placeholder: "sk-...",
        validate: (v) => (!v?.trim() ? "API key is required" : undefined),
      });
      if (isCancel(key)) {
        return null;
      }
      embeddingKey = key.trim();
    }
  } else {
    const key = await text({
      message: "Google API key (for Gemini embeddings)",
      placeholder: "AIza...",
      validate: (v) => (!v?.trim() ? "API key is required" : undefined),
    });
    if (isCancel(key)) {
      return null;
    }
    embeddingKey = key.trim();
  }
  const token = crypto.randomUUID();
  const config = {
    ...nextConfig,
    gateway: { mode: "local", auth: { mode: "token", token } },
    agents: {
      ...nextConfig.agents,
      defaults: {
        ...nextConfig.agents?.defaults,
        memorySearch: { provider: embeddingProvider },
      },
    },
    env: { ...nextConfig.env },
  };
  if (embeddingKey) {
    if (embeddingProvider === "openai") {
      config.env.OPENAI_API_KEY = embeddingKey;
    } else {
      config.env.GOOGLE_API_KEY = embeddingKey;
    }
  }
  await writeConfigFile(config);
  outro("Config saved. Starting gateway...");
  return { token };
}
async function runGatewayCommand(opts) {
  const isDevProfile = process.env.GENOS_PROFILE?.trim().toLowerCase() === "dev";
  const devMode = Boolean(opts.dev) || isDevProfile;
  if (opts.reset && !devMode) {
    defaultRuntime.error("Use --reset with --dev.");
    defaultRuntime.exit(1);
    return;
  }
  setConsoleTimestampPrefix(true);
  setVerbose(Boolean(opts.verbose));
  if (opts.claudeCliLogs) {
    setConsoleSubsystemFilter(["agent/claude-cli"]);
    process.env.GENOS_CLAUDE_CLI_LOG_OUTPUT = "1";
  }
  const wsLogRaw = opts.compact ? "compact" : opts.wsLog;
  const wsLogStyle = wsLogRaw === "compact" ? "compact" : wsLogRaw === "full" ? "full" : "auto";
  if (
    wsLogRaw !== undefined &&
    wsLogRaw !== "auto" &&
    wsLogRaw !== "compact" &&
    wsLogRaw !== "full"
  ) {
    defaultRuntime.error('Invalid --ws-log (use "auto", "full", "compact")');
    defaultRuntime.exit(1);
  }
  setGatewayWsLogStyle(wsLogStyle);
  if (opts.rawStream) {
    process.env.GENOS_RAW_STREAM = "1";
  }
  const rawStreamPath = toOptionString(opts.rawStreamPath);
  if (rawStreamPath) {
    process.env.GENOS_RAW_STREAM_PATH = rawStreamPath;
  }
  if (devMode) {
    await ensureDevGatewayConfig({ reset: Boolean(opts.reset) });
  }
  const cfg = loadConfig();
  const portOverride = parsePort(opts.port);
  if (opts.port !== undefined && portOverride === null) {
    defaultRuntime.error("Invalid port");
    defaultRuntime.exit(1);
  }
  const port = portOverride ?? resolveGatewayPort(cfg);
  if (!Number.isFinite(port) || port <= 0) {
    defaultRuntime.error("Invalid port");
    defaultRuntime.exit(1);
  }
  if (opts.force) {
    try {
      const { killed, waitedMs, escalatedToSigkill } = await forceFreePortAndWait(port, {
        timeoutMs: 2000,
        intervalMs: 100,
        sigtermTimeoutMs: 700,
      });
      if (killed.length === 0) {
        gatewayLog.info(`force: no listeners on port ${port}`);
      } else {
        for (const proc of killed) {
          gatewayLog.info(
            `force: killed pid ${proc.pid}${proc.command ? ` (${proc.command})` : ""} on port ${port}`,
          );
        }
        if (escalatedToSigkill) {
          gatewayLog.info(`force: escalated to SIGKILL while freeing port ${port}`);
        }
        if (waitedMs > 0) {
          gatewayLog.info(`force: waited ${waitedMs}ms for port ${port} to free`);
        }
      }
    } catch (err) {
      defaultRuntime.error(`Force: ${String(err)}`);
      defaultRuntime.exit(1);
      return;
    }
  }
  if (opts.token) {
    const token = toOptionString(opts.token);
    if (token) {
      process.env.GENOS_GATEWAY_TOKEN = token;
    }
  }
  const authModeRaw = toOptionString(opts.auth);
  const authMode = authModeRaw === "token" || authModeRaw === "password" ? authModeRaw : null;
  if (authModeRaw && !authMode) {
    defaultRuntime.error('Invalid --auth (use "token" or "password")');
    defaultRuntime.exit(1);
    return;
  }
  const tailscaleRaw = toOptionString(opts.tailscale);
  const tailscaleMode =
    tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
      ? tailscaleRaw
      : null;
  if (tailscaleRaw && !tailscaleMode) {
    defaultRuntime.error('Invalid --tailscale (use "off", "serve", or "funnel")');
    defaultRuntime.exit(1);
    return;
  }
  const passwordRaw = toOptionString(opts.password);
  const tokenRaw = toOptionString(opts.token);
  const snapshot = await readConfigFileSnapshot().catch(() => null);
  const configExists = snapshot?.exists ?? fs.existsSync(CONFIG_PATH);
  const configAuditPath = path.join(resolveStateDir(process.env), "logs", "config-audit.jsonl");
  let mode = cfg.gateway?.mode;
  let isFirstRun = false;
  if (!opts.allowUnconfigured && mode !== "local") {
    if (!configExists || !mode) {
      isFirstRun = true;
      const firstRunConfig = await runFirstRunSetup();
      if (!firstRunConfig) {
        defaultRuntime.exit(1);
        return;
      }
      Object.assign(cfg, loadConfig());
      mode = cfg.gateway?.mode;
    } else {
      defaultRuntime.error(
        `Gateway start blocked: set gateway.mode=local (current: ${mode ?? "unset"}) or pass --allow-unconfigured.`,
      );
      defaultRuntime.error(`Config write audit: ${configAuditPath}`);
      defaultRuntime.exit(1);
      return;
    }
  }
  const bindRaw = toOptionString(opts.bind) ?? cfg.gateway?.bind ?? "loopback";
  const bind =
    bindRaw === "loopback" ||
    bindRaw === "lan" ||
    bindRaw === "auto" ||
    bindRaw === "custom" ||
    bindRaw === "tailnet"
      ? bindRaw
      : null;
  if (!bind) {
    defaultRuntime.error('Invalid --bind (use "loopback", "lan", "tailnet", "auto", or "custom")');
    defaultRuntime.exit(1);
    return;
  }
  const miskeys = extractGatewayMiskeys(snapshot?.parsed);
  const authOverride =
    authMode || passwordRaw || tokenRaw || authModeRaw
      ? {
          ...(authMode ? { mode: authMode } : {}),
          ...(tokenRaw ? { token: tokenRaw } : {}),
          ...(passwordRaw ? { password: passwordRaw } : {}),
        }
      : undefined;
  const resolvedAuth = resolveGatewayAuth({
    authConfig: cfg.gateway?.auth,
    authOverride,
    env: process.env,
    tailscaleMode: tailscaleMode ?? cfg.gateway?.tailscale?.mode ?? "off",
  });
  const resolvedAuthMode = resolvedAuth.mode;
  const tokenValue = resolvedAuth.token;
  const passwordValue = resolvedAuth.password;
  const hasToken = typeof tokenValue === "string" && tokenValue.trim().length > 0;
  const hasPassword = typeof passwordValue === "string" && passwordValue.trim().length > 0;
  const hasSharedSecret =
    (resolvedAuthMode === "token" && hasToken) || (resolvedAuthMode === "password" && hasPassword);
  const canBootstrapToken = resolvedAuthMode === "token" && !hasToken;
  const authHints = [];
  if (miskeys.hasGatewayToken) {
    authHints.push('Found "gateway.token" in config. Use "gateway.auth.token" instead.');
  }
  if (miskeys.hasRemoteToken) {
    authHints.push(
      '"gateway.remote.token" is for remote CLI calls; it does not enable local gateway auth.',
    );
  }
  if (resolvedAuthMode === "password" && !hasPassword) {
    defaultRuntime.error(
      [
        "Gateway auth is set to password, but no password is configured.",
        "Set gateway.auth.password (or GENOS_GATEWAY_PASSWORD), or pass --password.",
        ...authHints,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    defaultRuntime.exit(1);
    return;
  }
  if (
    bind !== "loopback" &&
    !hasSharedSecret &&
    !canBootstrapToken &&
    resolvedAuthMode !== "trusted-proxy"
  ) {
    defaultRuntime.error(
      [
        `Refusing to bind gateway to ${bind} without auth.`,
        "Set gateway.auth.token/password (or GENOS_GATEWAY_TOKEN/GENOS_GATEWAY_PASSWORD) or pass --token/--password.",
        ...authHints,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    defaultRuntime.exit(1);
    return;
  }
  const tailscaleOverride =
    tailscaleMode || opts.tailscaleResetOnExit
      ? {
          ...(tailscaleMode ? { mode: tailscaleMode } : {}),
          ...(opts.tailscaleResetOnExit ? { resetOnExit: true } : {}),
        }
      : undefined;
  if (isFirstRun) {
    setTimeout(async () => {
      try {
        const controlUiUrl = `http://127.0.0.1:${port}/__genosos__/ui/?token=${encodeURIComponent(tokenValue ?? cfg.gateway?.auth?.token ?? "")}`;
        const { exec } = await import("node:child_process");
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${cmd} "${controlUiUrl}"`);
        gatewayLog.info(`Control UI: ${controlUiUrl}`);
      } catch {}
    }, 2000);
  }
  try {
    await runGatewayLoop({
      runtime: defaultRuntime,
      start: async () =>
        await startGatewayServer(port, {
          bind,
          auth: authOverride,
          tailscale: tailscaleOverride,
        }),
    });
  } catch (err) {
    if (
      err instanceof GatewayLockError ||
      (err && typeof err === "object" && err.name === "GatewayLockError")
    ) {
      const errMessage = describeUnknownError(err);
      defaultRuntime.error(
        `Gateway failed to start: ${errMessage}\nIf the gateway is supervised, stop it with: ${formatCliCommand("genosos gateway stop")}`,
      );
      try {
        const diagnostics = await inspectPortUsage(port);
        if (diagnostics.status === "busy") {
          for (const line of formatPortDiagnostics(diagnostics)) {
            defaultRuntime.error(line);
          }
        }
      } catch {}
      await maybeExplainGatewayServiceStop();
      defaultRuntime.exit(1);
      return;
    }
    defaultRuntime.error(`Gateway failed to start: ${String(err)}`);
    defaultRuntime.exit(1);
  }
}
export function addGatewayRunCommand(cmd) {
  return cmd
    .option("--port <port>", "Port for the gateway WebSocket")
    .option(
      "--bind <mode>",
      'Bind mode ("loopback"|"lan"|"tailnet"|"auto"|"custom"). Defaults to config gateway.bind (or loopback).',
    )
    .option(
      "--token <token>",
      "Shared token required in connect.params.auth.token (default: GENOS_GATEWAY_TOKEN env if set)",
    )
    .option("--auth <mode>", 'Gateway auth mode ("token"|"password")')
    .option("--password <password>", "Password for auth mode=password")
    .option("--tailscale <mode>", 'Tailscale exposure mode ("off"|"serve"|"funnel")')
    .option(
      "--tailscale-reset-on-exit",
      "Reset Tailscale serve/funnel configuration on shutdown",
      false,
    )
    .option(
      "--allow-unconfigured",
      "Allow gateway start without gateway.mode=local in config",
      false,
    )
    .option("--dev", "Create a dev config + workspace if missing (no BOOTSTRAP.md)", false)
    .option(
      "--reset",
      "Reset dev config + credentials + sessions + workspace (requires --dev)",
      false,
    )
    .option("--force", "Kill any existing listener on the target port before starting", false)
    .option("--verbose", "Verbose logging to stdout/stderr", false)
    .option(
      "--claude-cli-logs",
      "Only show claude-cli logs in the console (includes stdout/stderr)",
      false,
    )
    .option("--ws-log <style>", 'WebSocket log style ("auto"|"full"|"compact")', "auto")
    .option("--compact", 'Alias for "--ws-log compact"', false)
    .option("--raw-stream", "Log raw model stream events to jsonl", false)
    .option("--raw-stream-path <path>", "Raw stream jsonl path")
    .action(async (opts, command) => {
      await runGatewayCommand(resolveGatewayRunOptions(opts, command));
    });
}
