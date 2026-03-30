/**
 * GenosOS Doctor — Autonomous system health engine.
 *
 * Runs all checks, auto-fixes what it can, returns structured results.
 * No interactive prompts — aligned with GenosOS product philosophy.
 *
 * @module doctor/engine
 */

import { existsSync, statSync, readdirSync, unlinkSync, chmodSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** @param {string} id @param {"critical"|"warn"|"info"|"ok"} severity */
const finding = (id, severity, title, detail, opts = {}) => ({
  id,
  severity,
  title,
  detail,
  fixed: false,
  ...opts,
});

const isProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ─── Check: State directory integrity ────────────────────────────────

async function checkState({ stateDir }) {
  const findings = [];

  // State dir exists
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    findings.push(
      finding("state_dir_created", "info", "State directory created", stateDir, { fixed: true }),
    );
  }

  // Permissions
  try {
    const mode = statSync(stateDir).mode & 0o777;
    if (mode > 0o700) {
      chmodSync(stateDir, 0o700);
      findings.push(
        finding(
          "state_dir_perms",
          "warn",
          "State directory permissions tightened",
          `${mode.toString(8)} → 700`,
          { fixed: true },
        ),
      );
    }
  } catch {}

  // Config file permissions
  const configPath = join(stateDir, "genosos.json");
  if (existsSync(configPath)) {
    try {
      const mode = statSync(configPath).mode & 0o777;
      if (mode > 0o600) {
        chmodSync(configPath, 0o600);
        findings.push(
          finding(
            "config_perms",
            "warn",
            "Config file permissions tightened",
            `${mode.toString(8)} → 600`,
            { fixed: true },
          ),
        );
      }
    } catch {}
  }

  // Required subdirs
  for (const sub of ["sessions", "store", "oauth"]) {
    const dir = join(stateDir, sub);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      findings.push(
        finding(`${sub}_dir_created`, "info", `${sub}/ directory created`, dir, { fixed: true }),
      );
    }
  }

  // Stale session locks
  const sessionsDir = join(stateDir, "sessions");
  if (existsSync(sessionsDir)) {
    try {
      const entries = readdirSync(sessionsDir, { recursive: true }).map(String);
      const locks = entries.filter((e) => e.endsWith(".lock"));
      let cleaned = 0;
      for (const lock of locks) {
        const lockPath = join(sessionsDir, lock);
        try {
          const content = await readFile(lockPath, "utf8");
          const pid = parseInt(content.trim(), 10);
          if (pid && !isProcessAlive(pid)) {
            unlinkSync(lockPath);
            cleaned++;
          }
        } catch {
          // Unreadable lock — remove it
          try {
            unlinkSync(lockPath);
            cleaned++;
          } catch {}
        }
      }
      if (cleaned > 0) {
        findings.push(
          finding(
            "stale_locks",
            "info",
            "Stale session locks cleaned",
            `${cleaned} lock(s) removed`,
            { fixed: true },
          ),
        );
      }
    } catch {}
  }

  if (findings.length === 0) {
    findings.push(
      finding(
        "state_ok",
        "ok",
        "State directory healthy",
        "Directories, permissions, and locks OK",
      ),
    );
  }

  return { name: "state", label: "State Integrity", findings };
}

// ─── Check: Config validation ────────────────────────────────────────

async function checkConfig({ config }) {
  const findings = [];

  if (!config) {
    findings.push(
      finding(
        "config_missing",
        "critical",
        "No configuration loaded",
        "genosos.json could not be read",
        {
          remediation: "Run genosos setup or genosos configure to create initial config",
        },
      ),
    );
    return { name: "config", label: "Configuration", findings };
  }

  // Gateway mode
  if (!config.gateway?.mode) {
    findings.push(
      finding(
        "gateway_mode_missing",
        "critical",
        "Gateway mode not set",
        "gateway.mode is required (local or remote)",
        {
          remediation: "config_manage set gateway.mode local",
        },
      ),
    );
  }

  // Auth
  const authMode = config.gateway?.auth?.mode ?? "token";
  const hasToken =
    typeof config.gateway?.auth?.token === "string" && config.gateway.auth.token.trim().length > 0;
  if (authMode === "token" && !hasToken) {
    findings.push(
      finding(
        "gateway_auth_missing",
        "warn",
        "Gateway auth not configured",
        "No token or password set — anyone on the network can access the gateway",
        {
          remediation:
            "config_manage set gateway.auth.mode token (the doctor can generate one automatically)",
          autoFixable: true,
        },
      ),
    );
  }

  // Provider API key
  const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY || config.providers?.anthropic?.apiKey);
  const hasAnthropicOAuth = !!config.providers?.anthropic?.oauthClientId;
  if (!hasAnthropicKey && !hasAnthropicOAuth) {
    findings.push(
      finding(
        "provider_anthropic_missing",
        "critical",
        "No Anthropic API key configured",
        "The agent needs an API key to function. Set ANTHROPIC_API_KEY env var or configure via onboarding.",
        { remediation: "export ANTHROPIC_API_KEY=sk-ant-api-... or run genosos onboard" },
      ),
    );
  }

  if (findings.length === 0) {
    findings.push(
      finding(
        "config_ok",
        "ok",
        "Configuration valid",
        "Gateway mode, auth, provider, and binding OK",
      ),
    );
  }

  return { name: "config", label: "Configuration", findings };
}

// ─── Check: Provider API keys (real validation) ─────────────────────

async function checkProviders({ config }) {
  const findings = [];
  const apiKey = process.env.ANTHROPIC_API_KEY || config?.providers?.anthropic?.apiKey;
  if (!apiKey) {
    findings.push(
      finding("provider_no_key", "info", "Skipping provider test", "No API key to test"),
    );
    return { name: "providers", label: "Providers", findings };
  }

  // Test Anthropic key with minimal request
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok || res.status === 200) {
      findings.push(
        finding(
          "provider_anthropic_ok",
          "ok",
          "Anthropic API key valid",
          "Successfully authenticated",
        ),
      );
    } else if (res.status === 401) {
      findings.push(
        finding(
          "provider_anthropic_invalid",
          "critical",
          "Anthropic API key invalid",
          "Authentication failed (401). Check your key.",
          { remediation: "Verify ANTHROPIC_API_KEY is correct" },
        ),
      );
    } else if (res.status === 429) {
      findings.push(
        finding(
          "provider_anthropic_rate",
          "warn",
          "Anthropic API rate limited",
          "Key is valid but rate limited. Try again later.",
        ),
      );
    } else {
      findings.push(
        finding(
          "provider_anthropic_error",
          "warn",
          "Anthropic API returned unexpected status",
          `HTTP ${res.status}`,
        ),
      );
    }
  } catch (err) {
    findings.push(
      finding(
        "provider_anthropic_unreachable",
        "warn",
        "Could not reach Anthropic API",
        err.message,
      ),
    );
  }

  return { name: "providers", label: "Providers", findings };
}

// ─── Check: Gateway health ───────────────────────────────────────────

async function checkGateway({ config, gatewayUrl }) {
  const findings = [];
  const url = gatewayUrl ?? `http://127.0.0.1:${config?.gateway?.port ?? 18789}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      findings.push(
        finding("gateway_healthy", "ok", "Gateway responding", `${url} — HTTP ${res.status}`),
      );
    } else {
      findings.push(
        finding("gateway_unhealthy", "warn", "Gateway returned error", `HTTP ${res.status}`, {
          remediation: "Check gateway logs with config_manage logs",
        }),
      );
    }
  } catch (err) {
    findings.push(
      finding(
        "gateway_unreachable",
        "critical",
        "Gateway not responding",
        err.cause?.code ?? err.message,
        {
          remediation: "Start the gateway with: bun genosos.mjs gateway",
        },
      ),
    );
  }

  return { name: "gateway", label: "Gateway Health", findings };
}

// ─── Check: Security posture ─────────────────────────────────────────

async function checkSecurity({ config, stateDir }) {
  const findings = [];

  // Vault status
  try {
    const { getVaultStatus } = await import("../infra/vault-state.js");
    const vault = getVaultStatus();
    if (vault.locked) {
      findings.push(
        finding("vault_locked", "warn", "Vault is locked", "Workspace files cannot be decrypted", {
          remediation: "Unlock with vault.unlock or restart the gateway with passphrase configured",
        }),
      );
    } else {
      findings.push(
        finding(
          "vault_active",
          "ok",
          "Vault active",
          `Auto-lock in ${Math.round(vault.autoLockMs / 60_000)} min`,
        ),
      );
    }
  } catch {
    findings.push(
      finding("vault_unknown", "info", "Vault status unavailable", "Could not query vault state"),
    );
  }

  // Fortress mode
  const fortress = config?.security?.fortress;
  if (fortress?.enabled) {
    findings.push(
      finding(
        "fortress_active",
        "ok",
        "Fortress Mode active",
        "Audit log, rate limiting, OS hardening enabled",
      ),
    );
  } else {
    findings.push(
      finding(
        "fortress_inactive",
        "info",
        "Fortress Mode not enabled",
        "Optional hardening layer",
        {
          remediation: "Enable with config_manage security harden",
        },
      ),
    );
  }

  // WebAuthn
  const webauthn = config?.security?.webauthn;
  if (webauthn?.enabled) {
    findings.push(
      finding(
        "webauthn_active",
        "ok",
        "WebAuthn/Touch ID active",
        "Biometric gate on workspace writes",
      ),
    );
  } else {
    findings.push(
      finding(
        "webauthn_inactive",
        "info",
        "WebAuthn not configured",
        "Optional biometric authentication",
        {
          remediation: "Enable with config_manage webauthn enable",
        },
      ),
    );
  }

  // DM policies
  const channels = config?.channels ?? {};
  for (const [ch, chCfg] of Object.entries(channels)) {
    if (!chCfg || typeof chCfg !== "object") {
      continue;
    }
    const policy = chCfg.dmPolicy ?? chCfg.routing?.dmPolicy;
    if (policy === "open") {
      const allowFrom = chCfg.allowFrom ?? chCfg.routing?.allowFrom ?? [];
      if (!Array.isArray(allowFrom) || allowFrom.includes("*")) {
        findings.push(
          finding(
            `dm_open_${ch}`,
            "warn",
            `${ch}: open DM with wildcard`,
            "Anyone can message this channel",
            {
              remediation: `Restrict with config_manage set channels.${ch}.allowFrom to specific contacts, or change dmPolicy to pairing`,
            },
          ),
        );
      }
    }
  }

  // Security audit integration (run the existing audit)
  try {
    const { runSecurityAudit } = await import("../security/audit.js");
    const { resolveStateDir } = await import("../config/paths.js");
    const report = await runSecurityAudit({
      config,
      stateDir: stateDir ?? resolveStateDir(),
      deep: false,
      includeFilesystem: false,
      includeChannelSecurity: true,
    });
    const criticals = report.findings.filter((f) => f.severity === "critical");
    const warns = report.findings.filter((f) => f.severity === "warn");
    if (criticals.length > 0) {
      findings.push(
        finding(
          "audit_criticals",
          "critical",
          `Security audit: ${criticals.length} critical`,
          criticals.map((f) => f.title).join("; "),
          {
            remediation: "Run config_manage security audit for full details",
          },
        ),
      );
    }
    if (warns.length > 0) {
      findings.push(
        finding(
          "audit_warnings",
          "warn",
          `Security audit: ${warns.length} warnings`,
          warns.map((f) => f.title).join("; "),
          {
            remediation: "Run config_manage security audit for full details",
          },
        ),
      );
    }
    if (criticals.length === 0 && warns.length === 0) {
      findings.push(
        finding(
          "audit_clean",
          "ok",
          "Security audit clean",
          `${report.findings.length} checks passed`,
        ),
      );
    }
  } catch {
    findings.push(
      finding(
        "audit_unavailable",
        "info",
        "Security audit unavailable",
        "Could not run security audit",
      ),
    );
  }

  return { name: "security", label: "Security Posture", findings };
}

// ─── Check: Memory search ────────────────────────────────────────────

async function checkMemory({ config }) {
  const findings = [];
  const memSearch = config?.memorySearch ?? config?.agents?.defaults?.memorySearch;

  if (memSearch?.enabled === false) {
    findings.push(
      finding("memory_disabled", "info", "Memory search disabled", "Semantic search is off", {
        remediation: "Enable with config_manage set memorySearch.enabled true",
      }),
    );
  } else {
    const provider = memSearch?.provider ?? "auto";
    if (provider === "local") {
      findings.push(
        finding(
          "memory_local",
          "ok",
          "Memory search: local embedder",
          "Using on-device embeddings",
        ),
      );
    } else if (provider === "auto") {
      findings.push(
        finding(
          "memory_auto",
          "ok",
          "Memory search: auto provider",
          "Will use best available embedder",
        ),
      );
    } else {
      findings.push(
        finding(
          "memory_provider",
          "ok",
          `Memory search: ${provider}`,
          "External embedder configured",
        ),
      );
    }
  }

  return { name: "memory", label: "Memory System", findings };
}

// ─── Check: Workspace files ──────────────────────────────────────────

async function checkWorkspace({ config }) {
  const findings = [];

  try {
    const { resolveAgentWorkspaceDir, resolveDefaultAgentId } =
      await import("../agents/agent-scope.js");
    const agentId = resolveDefaultAgentId(config);
    const wsDir = resolveAgentWorkspaceDir(config, agentId);

    if (!existsSync(wsDir)) {
      findings.push(
        finding("workspace_missing", "warn", "Workspace directory missing", wsDir, {
          remediation: "Start the gateway — workspace is created automatically on first run",
        }),
      );
      return { name: "workspace", label: "Workspace", findings };
    }

    const coreFiles = ["AGENTS.md", "SOUL.md", "SECURITY.md", "IDENTITY.md"];
    const missing = coreFiles.filter((f) => !existsSync(join(wsDir, f)));
    if (missing.length > 0) {
      findings.push(
        finding(
          "workspace_files_missing",
          "warn",
          "Core workspace files missing",
          missing.join(", "),
          {
            remediation: "Missing files will be created from templates on next gateway startup",
          },
        ),
      );
    } else {
      findings.push(finding("workspace_ok", "ok", "Workspace complete", "All core files present"));
    }

    // Skills count
    try {
      const skillsDir = join(wsDir, "skills");
      if (existsSync(skillsDir)) {
        const skills = readdirSync(skillsDir).filter((d) =>
          existsSync(join(skillsDir, d, "SKILL.md")),
        );
        findings.push(
          finding(
            "skills_count",
            "ok",
            `${skills.length} skill(s) installed`,
            skills.join(", ") || "none",
          ),
        );
      }
    } catch {}
  } catch {
    findings.push(
      finding(
        "workspace_error",
        "info",
        "Could not check workspace",
        "Agent scope resolution failed",
      ),
    );
  }

  return { name: "workspace", label: "Workspace", findings };
}

// ─── Check: Channel connectivity ─────────────────────────────────────

async function checkChannels({ config }) {
  const findings = [];
  const channels = config?.channels ?? {};
  const enabled = Object.entries(channels).filter(
    ([, v]) => v?.enabled !== false && typeof v === "object",
  );

  if (enabled.length === 0) {
    findings.push(
      finding(
        "no_channels",
        "info",
        "No channels configured",
        "Configure channels with config_manage channels",
        {
          remediation: "config_manage channels enable {channel_name}",
        },
      ),
    );
  } else {
    findings.push(
      finding(
        "channels_count",
        "ok",
        `${enabled.length} channel(s) configured`,
        enabled.map(([k]) => k).join(", "),
      ),
    );
  }

  return { name: "channels", label: "Channels", findings };
}

// ─── Engine orchestrator ─────────────────────────────────────────────

/**
 * Run the autonomous doctor — diagnose and auto-fix system health.
 * @param {object} opts
 * @param {object} opts.config - Loaded GenosOS config
 * @param {string} [opts.stateDir] - State directory path
 * @param {string} [opts.gatewayUrl] - Gateway URL for health check
 * @returns {Promise<DoctorReport>}
 */
export async function runDoctor({ config, stateDir, gatewayUrl } = {}) {
  // Resolve state dir if not provided
  if (!stateDir) {
    try {
      const { resolveStateDir } = await import("../config/paths.js");
      stateDir = resolveStateDir();
    } catch {
      stateDir = join(process.env.HOME, ".genosv1");
    }
  }

  // Auto-load config if not explicitly provided (null = intentionally no config)
  if (config === undefined) {
    try {
      const { loadConfig } = await import("../config/config.js");
      config = loadConfig();
    } catch {}
  }

  const ctx = { config, stateDir, gatewayUrl };

  const checks = await Promise.allSettled([
    checkState(ctx),
    checkConfig(ctx),
    checkProviders(ctx),
    checkGateway(ctx),
    checkSecurity(ctx),
    checkMemory(ctx),
    checkWorkspace(ctx),
    checkChannels(ctx),
  ]);

  const results = checks.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : {
          name: "error",
          label: "Check Failed",
          findings: [
            finding("check_error", "warn", "Check failed", r.reason?.message ?? "Unknown error"),
          ],
        },
  );

  const allFindings = results.flatMap((r) => r.findings);
  const summary = {
    critical: allFindings.filter((f) => f.severity === "critical").length,
    warnings: allFindings.filter((f) => f.severity === "warn").length,
    info: allFindings.filter((f) => f.severity === "info").length,
    ok: allFindings.filter((f) => f.severity === "ok").length,
    fixed: allFindings.filter((f) => f.fixed).length,
  };

  return {
    ts: Date.now(),
    summary,
    checks: results,
  };
}
