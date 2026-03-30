let setGroupPolicyAllowlist = function (params) {
    if (!params.cfg.channels) {
      return;
    }
    const section = params.cfg.channels[params.channel];
    if (!section || typeof section !== "object") {
      return;
    }
    const topPolicy = section.groupPolicy;
    if (topPolicy === "open") {
      section.groupPolicy = "allowlist";
      params.changes.push(`channels.${params.channel}.groupPolicy=open -> allowlist`);
      params.policyFlips.add(`channels.${params.channel}.`);
    }
    const accounts = section.accounts;
    if (!accounts || typeof accounts !== "object") {
      return;
    }
    for (const [accountId, accountValue] of Object.entries(accounts)) {
      if (!accountId) {
        continue;
      }
      if (!accountValue || typeof accountValue !== "object") {
        continue;
      }
      const account = accountValue;
      if (account.groupPolicy === "open") {
        account.groupPolicy = "allowlist";
        params.changes.push(
          `channels.${params.channel}.accounts.${accountId}.groupPolicy=open -> allowlist`,
        );
        params.policyFlips.add(`channels.${params.channel}.accounts.${accountId}.`);
      }
    }
  },
  setWhatsAppGroupAllowFromFromStore = function (params) {
    const section = params.cfg.channels?.whatsapp;
    if (!section || typeof section !== "object") {
      return;
    }
    if (params.storeAllowFrom.length === 0) {
      return;
    }
    const maybeApply = (prefix, obj) => {
      if (!params.policyFlips.has(prefix)) {
        return;
      }
      const allowFrom = Array.isArray(obj.allowFrom) ? obj.allowFrom : [];
      const groupAllowFrom = Array.isArray(obj.groupAllowFrom) ? obj.groupAllowFrom : [];
      if (allowFrom.length > 0) {
        return;
      }
      if (groupAllowFrom.length > 0) {
        return;
      }
      obj.groupAllowFrom = params.storeAllowFrom;
      params.changes.push(`${prefix}groupAllowFrom=pairing-store`);
    };
    maybeApply("channels.whatsapp.", section);
    const accounts = section.accounts;
    if (!accounts || typeof accounts !== "object") {
      return;
    }
    for (const [accountId, accountValue] of Object.entries(accounts)) {
      if (!accountValue || typeof accountValue !== "object") {
        continue;
      }
      const account = accountValue;
      maybeApply(`channels.whatsapp.accounts.${accountId}.`, account);
    }
  },
  applyConfigFixes = function (params) {
    const next = structuredClone(params.cfg ?? {});
    const changes = [];
    const policyFlips = new Set();
    if (next.logging?.redactSensitive === "off") {
      next.logging = { ...next.logging, redactSensitive: "tools" };
      changes.push('logging.redactSensitive=off -> "tools"');
    }
    for (const channel of [
      "telegram",
      "whatsapp",
      "discord",
      "signal",
      "imessage",
      "slack",
      "msteams",
    ]) {
      setGroupPolicyAllowlist({ cfg: next, channel, changes, policyFlips });
    }
    return { cfg: next, changes, policyFlips };
  };
import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { createConfigIO } from "../config/config.js";
import { collectIncludePathsRecursive } from "../config/includes-scan.js";
import { resolveConfigPath, resolveOAuthDir, resolveStateDir } from "../config/paths.js";
import { readChannelAllowFromStore } from "../pairing/pairing-store.js";
import { runExec } from "../process/exec.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { createIcaclsResetCommand, formatIcaclsResetCommand } from "./windows-acl.js";
async function safeChmod(params) {
  try {
    const st = await fs.lstat(params.path);
    if (st.isSymbolicLink()) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "symlink",
      };
    }
    if (params.require === "dir" && !st.isDirectory()) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "not-a-directory",
      };
    }
    if (params.require === "file" && !st.isFile()) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "not-a-file",
      };
    }
    const current = st.mode & 511;
    if (current === params.mode) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "already",
      };
    }
    await fs.chmod(params.path, params.mode);
    return { kind: "chmod", path: params.path, mode: params.mode, ok: true };
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "missing",
      };
    }
    return {
      kind: "chmod",
      path: params.path,
      mode: params.mode,
      ok: false,
      error: String(err),
    };
  }
}
async function safeAclReset(params) {
  const display = formatIcaclsResetCommand(params.path, {
    isDir: params.require === "dir",
    env: params.env,
  });
  try {
    const st = await fs.lstat(params.path);
    if (st.isSymbolicLink()) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "symlink",
      };
    }
    if (params.require === "dir" && !st.isDirectory()) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "not-a-directory",
      };
    }
    if (params.require === "file" && !st.isFile()) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "not-a-file",
      };
    }
    const cmd = createIcaclsResetCommand(params.path, {
      isDir: st.isDirectory(),
      env: params.env,
    });
    if (!cmd) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "missing-user",
      };
    }
    const exec = params.exec ?? runExec;
    await exec(cmd.command, cmd.args);
    return { kind: "icacls", path: params.path, command: cmd.display, ok: true };
  } catch (err) {
    const code = err.code;
    if (code === "ENOENT") {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "missing",
      };
    }
    return {
      kind: "icacls",
      path: params.path,
      command: display,
      ok: false,
      error: String(err),
    };
  }
}
async function chmodCredentialsAndAgentState(params) {
  const credsDir = resolveOAuthDir(params.env, params.stateDir);
  params.actions.push(await safeChmod({ path: credsDir, mode: 448, require: "dir" }));
  const credsEntries = await fs.readdir(credsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of credsEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".json")) {
      continue;
    }
    const p = path.join(credsDir, entry.name);
    params.actions.push(await safeChmod({ path: p, mode: 384, require: "file" }));
  }
  const ids = new Set();
  ids.add(resolveDefaultAgentId(params.cfg));
  const list = Array.isArray(params.cfg.agents?.list) ? params.cfg.agents?.list : [];
  for (const agent of list ?? []) {
    if (!agent || typeof agent !== "object") {
      continue;
    }
    const id = typeof agent.id === "string" ? agent.id.trim() : "";
    if (id) {
      ids.add(id);
    }
  }
  for (const agentId of ids) {
    const normalizedAgentId = normalizeAgentId(agentId);
    const agentRoot = path.join(params.stateDir, "agents", normalizedAgentId);
    const agentDir = path.join(agentRoot, "agent");
    const sessionsDir = path.join(agentRoot, "sessions");
    params.actions.push(await safeChmod({ path: agentRoot, mode: 448, require: "dir" }));
    params.actions.push(await params.applyPerms({ path: agentDir, mode: 448, require: "dir" }));
    const authPath = path.join(agentDir, "auth-profiles.json");
    params.actions.push(await params.applyPerms({ path: authPath, mode: 384, require: "file" }));
    params.actions.push(await params.applyPerms({ path: sessionsDir, mode: 448, require: "dir" }));
    const storePath = path.join(sessionsDir, "sessions.json");
    params.actions.push(await params.applyPerms({ path: storePath, mode: 384, require: "file" }));
    const sessionEntries = await fs.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionEntries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) {
        continue;
      }
      const p = path.join(sessionsDir, entry.name);
      params.actions.push(await params.applyPerms({ path: p, mode: 384, require: "file" }));
    }
  }
}
export async function fixSecurityFootguns(opts) {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;
  const exec = opts?.exec ?? runExec;
  const isWindows = platform === "win32";
  const stateDir = opts?.stateDir ?? resolveStateDir(env);
  const configPath = opts?.configPath ?? resolveConfigPath(env, stateDir);
  const actions = [];
  const errors = [];
  const io = createConfigIO({ env, configPath });
  const snap = await io.readConfigFileSnapshot();
  if (!snap.valid) {
    errors.push(...snap.issues.map((i) => `${i.path}: ${i.message}`));
  }
  let configWritten = false;
  let changes = [];
  if (snap.valid) {
    const fixed = applyConfigFixes({ cfg: snap.config, env });
    changes = fixed.changes;
    const whatsappStoreAllowFrom = await readChannelAllowFromStore("whatsapp", env).catch(() => []);
    if (whatsappStoreAllowFrom.length > 0) {
      setWhatsAppGroupAllowFromFromStore({
        cfg: fixed.cfg,
        storeAllowFrom: whatsappStoreAllowFrom,
        changes,
        policyFlips: fixed.policyFlips,
      });
    }
    if (changes.length > 0) {
      try {
        await io.writeConfigFile(fixed.cfg);
        configWritten = true;
      } catch (err) {
        errors.push(`writeConfigFile failed: ${String(err)}`);
      }
    }
  }
  const applyPerms = (params) =>
    isWindows
      ? safeAclReset({ path: params.path, require: params.require, env, exec })
      : safeChmod({ path: params.path, mode: params.mode, require: params.require });
  actions.push(await applyPerms({ path: stateDir, mode: 448, require: "dir" }));
  actions.push(await applyPerms({ path: configPath, mode: 384, require: "file" }));
  if (snap.exists) {
    const includePaths = await collectIncludePathsRecursive({
      configPath: snap.path,
      parsed: snap.parsed,
    }).catch(() => []);
    for (const p of includePaths) {
      actions.push(await applyPerms({ path: p, mode: 384, require: "file" }));
    }
  }
  await chmodCredentialsAndAgentState({
    env,
    stateDir,
    cfg: snap.config ?? {},
    actions,
    applyPerms,
  }).catch((err) => {
    errors.push(`chmodCredentialsAndAgentState failed: ${String(err)}`);
  });
  return {
    ok: errors.length === 0,
    stateDir,
    configPath,
    configWritten,
    changes,
    actions,
    errors,
  };
}
