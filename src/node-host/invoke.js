let resolveExecSecurity = function (value) {
    return value === "deny" || value === "allowlist" || value === "full" ? value : "allowlist";
  },
  isCmdExeInvocation = function (argv) {
    const token = argv[0]?.trim();
    if (!token) {
      return false;
    }
    const base = path.win32.basename(token).toLowerCase();
    return base === "cmd.exe" || base === "cmd";
  },
  resolveExecAsk = function (value) {
    return value === "off" || value === "on-miss" || value === "always" ? value : "on-miss";
  },
  truncateOutput = function (raw, maxChars) {
    if (raw.length <= maxChars) {
      return { text: raw, truncated: false };
    }
    return { text: `... (truncated) ${raw.slice(raw.length - maxChars)}`, truncated: true };
  },
  redactExecApprovals = function (file) {
    const socketPath = file.socket?.path?.trim();
    return {
      ...file,
      socket: socketPath ? { path: socketPath } : undefined,
    };
  },
  requireExecApprovalsBaseHash = function (params, snapshot) {
    if (!snapshot.exists) {
      return;
    }
    if (!snapshot.hash) {
      throw new Error("INVALID_REQUEST: exec approvals base hash unavailable; reload and retry");
    }
    const baseHash = typeof params.baseHash === "string" ? params.baseHash.trim() : "";
    if (!baseHash) {
      throw new Error("INVALID_REQUEST: exec approvals base hash required; reload and retry");
    }
    if (baseHash !== snapshot.hash) {
      throw new Error("INVALID_REQUEST: exec approvals changed; reload and retry");
    }
  },
  resolveEnvPath = function (env) {
    const raw = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? DEFAULT_NODE_PATH;
    return raw.split(path.delimiter).filter(Boolean);
  },
  resolveExecutable = function (bin, env) {
    if (bin.includes("/") || bin.includes("\\")) {
      return null;
    }
    const extensions =
      process.platform === "win32"
        ? (process.env.PATHEXT ?? process.env.PathExt ?? ".EXE;.CMD;.BAT;.COM")
            .split(";")
            .map((ext) => ext.toLowerCase())
        : [""];
    for (const dir of resolveEnvPath(env)) {
      for (const ext of extensions) {
        const candidate = path.join(dir, bin + ext);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  },
  buildExecEventPayload = function (payload) {
    if (!payload.output) {
      return payload;
    }
    const trimmed = payload.output.trim();
    if (!trimmed) {
      return payload;
    }
    const { text } = truncateOutput(trimmed, OUTPUT_EVENT_TAIL);
    return { ...payload, output: text };
  },
  decodeParams = function (raw) {
    if (!raw) {
      throw new Error("INVALID_REQUEST: paramsJSON required");
    }
    return JSON.parse(raw);
  };
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAgentConfig } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import {
  addAllowlistEntry,
  analyzeArgvCommand,
  checkDenyBins,
  evaluateExecAllowlist,
  evaluateShellAllowlist,
  requiresExecApproval,
  normalizeExecApprovals,
  mergeExecApprovalsSocketDefaults,
  recordAllowlistUse,
  resolveDenyBins,
  resolveExecApprovals,
  resolveSafeBins,
  ensureExecApprovals,
  readExecApprovalsSnapshot,
  saveExecApprovals,
} from "../infra/exec-approvals.js";
import { requestExecHostViaSocket } from "../infra/exec-host.js";
import { validateSystemRunCommandConsistency } from "../infra/system-run-command.js";
import { runBrowserProxyCommand } from "./invoke-browser.js";
const OUTPUT_CAP = 200000;
const OUTPUT_EVENT_TAIL = 20000;
const DEFAULT_NODE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const execHostEnforced = process.env.GENOS_NODE_EXEC_HOST?.trim().toLowerCase() === "app";
const execHostFallbackAllowed = process.env.GENOS_NODE_EXEC_FALLBACK?.trim().toLowerCase() !== "0";
const blockedEnvKeys = new Set([
  "NODE_OPTIONS",
  "PYTHONHOME",
  "PYTHONPATH",
  "PERL5LIB",
  "PERL5OPT",
  "RUBYOPT",
]);
const blockedEnvPrefixes = ["DYLD_", "LD_"];
export function sanitizeEnv(overrides) {
  if (!overrides) {
    return;
  }
  const merged = { ...process.env };
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    const upper = key.toUpperCase();
    if (upper === "PATH") {
      continue;
    }
    if (blockedEnvKeys.has(upper)) {
      continue;
    }
    if (blockedEnvPrefixes.some((prefix) => upper.startsWith(prefix))) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}
async function runCommand(argv, cwd, env, timeoutMs) {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputLen = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const onChunk = (chunk, target) => {
      if (outputLen >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      const remaining = OUTPUT_CAP - outputLen;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      const str = slice.toString("utf8");
      outputLen += slice.length;
      if (target === "stdout") {
        stdout += str;
      } else {
        stderr += str;
      }
      if (chunk.length > remaining) {
        truncated = true;
      }
    };
    child.stdout?.on("data", (chunk) => onChunk(chunk, "stdout"));
    child.stderr?.on("data", (chunk) => onChunk(chunk, "stderr"));
    let timer;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {}
      }, timeoutMs);
    }
    const finalize = (exitCode, error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        exitCode,
        timedOut,
        success: exitCode === 0 && !timedOut && !error,
        stdout,
        stderr,
        error: error ?? null,
        truncated,
      });
    };
    child.on("error", (err) => {
      finalize(undefined, err.message);
    });
    child.on("exit", (code) => {
      finalize(code === null ? undefined : code, null);
    });
  });
}
async function handleSystemWhich(params, env) {
  const bins = params.bins.map((bin) => bin.trim()).filter(Boolean);
  const found = {};
  for (const bin of bins) {
    const path = resolveExecutable(bin, env);
    if (path) {
      found[bin] = path;
    }
  }
  return { bins: found };
}
async function sendExecFinishedEvent(params) {
  const combined = [params.result.stdout, params.result.stderr, params.result.error]
    .filter(Boolean)
    .join("\n");
  await sendNodeEvent(
    params.client,
    "exec.finished",
    buildExecEventPayload({
      sessionKey: params.sessionKey,
      runId: params.runId,
      host: "node",
      command: params.cmdText,
      exitCode: params.result.exitCode ?? undefined,
      timedOut: params.result.timedOut,
      success: params.result.success,
      output: combined,
    }),
  );
}
async function runViaMacAppExecHost(params) {
  const { approvals, request } = params;
  return await requestExecHostViaSocket({
    socketPath: approvals.socketPath,
    token: approvals.token,
    request,
  });
}
async function sendJsonPayloadResult(client, frame, payload) {
  await sendInvokeResult(client, frame, {
    ok: true,
    payloadJSON: JSON.stringify(payload),
  });
}
async function sendRawPayloadResult(client, frame, payloadJSON) {
  await sendInvokeResult(client, frame, {
    ok: true,
    payloadJSON,
  });
}
async function sendErrorResult(client, frame, code, message) {
  await sendInvokeResult(client, frame, {
    ok: false,
    error: { code, message },
  });
}
async function sendInvalidRequestResult(client, frame, err) {
  await sendErrorResult(client, frame, "INVALID_REQUEST", String(err));
}
export async function handleInvoke(frame, client, skillBins) {
  const command = String(frame.command ?? "");
  if (command === "system.execApprovals.get") {
    try {
      ensureExecApprovals();
      const snapshot = readExecApprovalsSnapshot();
      const payload = {
        path: snapshot.path,
        exists: snapshot.exists,
        hash: snapshot.hash,
        file: redactExecApprovals(snapshot.file),
      };
      await sendJsonPayloadResult(client, frame, payload);
    } catch (err) {
      const message = String(err);
      const code = message.toLowerCase().includes("timed out") ? "TIMEOUT" : "INVALID_REQUEST";
      await sendErrorResult(client, frame, code, message);
    }
    return;
  }
  if (command === "system.execApprovals.set") {
    try {
      const params = decodeParams(frame.paramsJSON);
      if (!params.file || typeof params.file !== "object") {
        throw new Error("INVALID_REQUEST: exec approvals file required");
      }
      ensureExecApprovals();
      const snapshot = readExecApprovalsSnapshot();
      requireExecApprovalsBaseHash(params, snapshot);
      const normalized = normalizeExecApprovals(params.file);
      const next = mergeExecApprovalsSocketDefaults({ normalized, current: snapshot.file });
      saveExecApprovals(next);
      const nextSnapshot = readExecApprovalsSnapshot();
      const payload = {
        path: nextSnapshot.path,
        exists: nextSnapshot.exists,
        hash: nextSnapshot.hash,
        file: redactExecApprovals(nextSnapshot.file),
      };
      await sendJsonPayloadResult(client, frame, payload);
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }
  if (command === "system.which") {
    try {
      const params = decodeParams(frame.paramsJSON);
      if (!Array.isArray(params.bins)) {
        throw new Error("INVALID_REQUEST: bins required");
      }
      const env = sanitizeEnv(undefined);
      const payload = await handleSystemWhich(params, env);
      await sendJsonPayloadResult(client, frame, payload);
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }
  if (command === "browser.proxy") {
    try {
      const payload = await runBrowserProxyCommand(frame.paramsJSON);
      await sendRawPayloadResult(client, frame, payload);
    } catch (err) {
      await sendInvalidRequestResult(client, frame, err);
    }
    return;
  }
  if (command !== "system.run") {
    await sendErrorResult(client, frame, "UNAVAILABLE", "command not supported");
    return;
  }
  let params;
  try {
    params = decodeParams(frame.paramsJSON);
  } catch (err) {
    await sendInvalidRequestResult(client, frame, err);
    return;
  }
  if (!Array.isArray(params.command) || params.command.length === 0) {
    await sendErrorResult(client, frame, "INVALID_REQUEST", "command required");
    return;
  }
  const argv = params.command.map((item) => String(item));
  const rawCommand = typeof params.rawCommand === "string" ? params.rawCommand.trim() : "";
  const consistency = validateSystemRunCommandConsistency({
    argv,
    rawCommand: rawCommand || null,
  });
  if (!consistency.ok) {
    await sendErrorResult(client, frame, "INVALID_REQUEST", consistency.message);
    return;
  }
  const shellCommand = consistency.shellCommand;
  const cmdText = consistency.cmdText;

  const agentId = params.agentId?.trim() || undefined;
  const cfg = loadConfig();
  const agentExec = agentId ? resolveAgentConfig(cfg, agentId)?.tools?.exec : undefined;
  const denyBinsSet = resolveDenyBins(agentExec?.denyBins ?? cfg.tools?.exec?.denyBins);

  // Deny bins — blocked binaries cannot execute regardless of security mode
  if (shellCommand) {
    const denyCheck = checkDenyBins(shellCommand, denyBinsSet);
    if (denyCheck.denied) {
      await sendErrorResult(
        client,
        frame,
        "DENIED",
        `exec denied: "${denyCheck.bin}" is in the deny list and cannot be executed in any security mode`,
      );
      return;
    }
  }
  if (argv.length > 0) {
    const bin = path.basename(argv[0]).toLowerCase();
    if (denyBinsSet.has(bin)) {
      await sendErrorResult(
        client,
        frame,
        "DENIED",
        `exec denied: "${bin}" is in the deny list and cannot be executed in any security mode`,
      );
      return;
    }
  }
  const configuredSecurity = resolveExecSecurity(agentExec?.security ?? cfg.tools?.exec?.security);
  const configuredAsk = resolveExecAsk(agentExec?.ask ?? cfg.tools?.exec?.ask);
  const approvals = resolveExecApprovals(agentId, {
    security: configuredSecurity,
    ask: configuredAsk,
  });
  const security = approvals.agent.security;
  const ask = approvals.agent.ask;
  const autoAllowSkills = approvals.agent.autoAllowSkills;
  const sessionKey = params.sessionKey?.trim() || "node";
  const runId = params.runId?.trim() || crypto.randomUUID();
  const env = sanitizeEnv(params.env ?? undefined);
  const safeBins = resolveSafeBins(agentExec?.safeBins ?? cfg.tools?.exec?.safeBins);
  const bins = autoAllowSkills ? await skillBins.current() : new Set();
  let analysisOk = false;
  let allowlistMatches = [];
  let allowlistSatisfied = false;
  let segments = [];
  if (shellCommand) {
    const allowlistEval = evaluateShellAllowlist({
      command: shellCommand,
      allowlist: approvals.allowlist,
      safeBins,
      cwd: params.cwd ?? undefined,
      env,
      skillBins: bins,
      autoAllowSkills,
      platform: process.platform,
    });
    analysisOk = allowlistEval.analysisOk;
    allowlistMatches = allowlistEval.allowlistMatches;
    allowlistSatisfied =
      security === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
    segments = allowlistEval.segments;
  } else {
    const analysis = analyzeArgvCommand({ argv, cwd: params.cwd ?? undefined, env });
    const allowlistEval = evaluateExecAllowlist({
      analysis,
      allowlist: approvals.allowlist,
      safeBins,
      cwd: params.cwd ?? undefined,
      skillBins: bins,
      autoAllowSkills,
    });
    analysisOk = analysis.ok;
    allowlistMatches = allowlistEval.allowlistMatches;
    allowlistSatisfied =
      security === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
    segments = analysis.segments;
  }
  const isWindows = process.platform === "win32";
  const cmdInvocation = shellCommand
    ? isCmdExeInvocation(segments[0]?.argv ?? [])
    : isCmdExeInvocation(argv);
  if (security === "allowlist" && isWindows && cmdInvocation) {
    analysisOk = false;
    allowlistSatisfied = false;
  }
  const useMacAppExec = process.platform === "darwin";
  if (useMacAppExec) {
    const approvalDecision =
      params.approvalDecision === "allow-once" || params.approvalDecision === "allow-always"
        ? params.approvalDecision
        : null;
    const execRequest = {
      command: argv,
      rawCommand: rawCommand || shellCommand || null,
      cwd: params.cwd ?? null,
      env: params.env ?? null,
      timeoutMs: params.timeoutMs ?? null,
      needsScreenRecording: params.needsScreenRecording ?? null,
      agentId: agentId ?? null,
      sessionKey: sessionKey ?? null,
      approvalDecision,
    };
    const response = await runViaMacAppExecHost({ approvals, request: execRequest });
    if (!response) {
      if (execHostEnforced || !execHostFallbackAllowed) {
        await sendNodeEvent(
          client,
          "exec.denied",
          buildExecEventPayload({
            sessionKey,
            runId,
            host: "node",
            command: cmdText,
            reason: "companion-unavailable",
          }),
        );
        await sendInvokeResult(client, frame, {
          ok: false,
          error: {
            code: "UNAVAILABLE",
            message: "COMPANION_APP_UNAVAILABLE: macOS app exec host unreachable",
          },
        });
        return;
      }
    } else if (!response.ok) {
      const reason = response.error.reason ?? "approval-required";
      await sendNodeEvent(
        client,
        "exec.denied",
        buildExecEventPayload({
          sessionKey,
          runId,
          host: "node",
          command: cmdText,
          reason,
        }),
      );
      await sendInvokeResult(client, frame, {
        ok: false,
        error: { code: "UNAVAILABLE", message: response.error.message },
      });
      return;
    } else {
      const result = response.payload;
      await sendExecFinishedEvent({ client, sessionKey, runId, cmdText, result });
      await sendInvokeResult(client, frame, {
        ok: true,
        payloadJSON: JSON.stringify(result),
      });
      return;
    }
  }
  if (security === "deny") {
    await sendNodeEvent(
      client,
      "exec.denied",
      buildExecEventPayload({
        sessionKey,
        runId,
        host: "node",
        command: cmdText,
        reason: "security=deny",
      }),
    );
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "UNAVAILABLE", message: "SYSTEM_RUN_DISABLED: security=deny" },
    });
    return;
  }
  const requiresAsk = requiresExecApproval({
    ask,
    security,
    analysisOk,
    allowlistSatisfied,
  });
  const approvalDecision =
    params.approvalDecision === "allow-once" || params.approvalDecision === "allow-always"
      ? params.approvalDecision
      : null;
  const approvedByAsk = approvalDecision !== null || params.approved === true;
  if (requiresAsk && !approvedByAsk) {
    await sendNodeEvent(
      client,
      "exec.denied",
      buildExecEventPayload({
        sessionKey,
        runId,
        host: "node",
        command: cmdText,
        reason: "approval-required",
      }),
    );
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "UNAVAILABLE", message: "SYSTEM_RUN_DENIED: approval required" },
    });
    return;
  }
  if (approvalDecision === "allow-always" && security === "allowlist") {
    if (analysisOk) {
      for (const segment of segments) {
        const pattern = segment.resolution?.resolvedPath ?? "";
        if (pattern) {
          addAllowlistEntry(approvals.file, agentId, pattern);
        }
      }
    }
  }
  if (security === "allowlist" && (!analysisOk || !allowlistSatisfied) && !approvedByAsk) {
    await sendNodeEvent(
      client,
      "exec.denied",
      buildExecEventPayload({
        sessionKey,
        runId,
        host: "node",
        command: cmdText,
        reason: "allowlist-miss",
      }),
    );
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "UNAVAILABLE", message: "SYSTEM_RUN_DENIED: allowlist miss" },
    });
    return;
  }
  if (allowlistMatches.length > 0) {
    const seen = new Set();
    for (const match of allowlistMatches) {
      if (!match?.pattern || seen.has(match.pattern)) {
        continue;
      }
      seen.add(match.pattern);
      recordAllowlistUse(
        approvals.file,
        agentId,
        match,
        cmdText,
        segments[0]?.resolution?.resolvedPath,
      );
    }
  }
  if (params.needsScreenRecording === true) {
    await sendNodeEvent(
      client,
      "exec.denied",
      buildExecEventPayload({
        sessionKey,
        runId,
        host: "node",
        command: cmdText,
        reason: "permission:screenRecording",
      }),
    );
    await sendInvokeResult(client, frame, {
      ok: false,
      error: { code: "UNAVAILABLE", message: "PERMISSION_MISSING: screenRecording" },
    });
    return;
  }
  let execArgv = argv;
  if (
    security === "allowlist" &&
    isWindows &&
    !approvedByAsk &&
    shellCommand &&
    analysisOk &&
    allowlistSatisfied &&
    segments.length === 1 &&
    segments[0]?.argv.length > 0
  ) {
    execArgv = segments[0].argv;
  }
  const result = await runCommand(
    execArgv,
    params.cwd?.trim() || undefined,
    env,
    params.timeoutMs ?? undefined,
  );
  if (result.truncated) {
    const suffix = "... (truncated)";
    if (result.stderr.trim().length > 0) {
      result.stderr = `${result.stderr}\n${suffix}`;
    } else {
      result.stdout = `${result.stdout}\n${suffix}`;
    }
  }
  await sendExecFinishedEvent({ client, sessionKey, runId, cmdText, result });
  await sendInvokeResult(client, frame, {
    ok: true,
    payloadJSON: JSON.stringify({
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error ?? null,
    }),
  });
}
export function coerceNodeInvokePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const nodeId = typeof obj.nodeId === "string" ? obj.nodeId.trim() : "";
  const command = typeof obj.command === "string" ? obj.command.trim() : "";
  if (!id || !nodeId || !command) {
    return null;
  }
  const paramsJSON =
    typeof obj.paramsJSON === "string"
      ? obj.paramsJSON
      : obj.params !== undefined
        ? JSON.stringify(obj.params)
        : null;
  const timeoutMs = typeof obj.timeoutMs === "number" ? obj.timeoutMs : null;
  const idempotencyKey = typeof obj.idempotencyKey === "string" ? obj.idempotencyKey : null;
  return {
    id,
    nodeId,
    command,
    paramsJSON,
    timeoutMs,
    idempotencyKey,
  };
}
async function sendInvokeResult(client, frame, result) {
  try {
    await client.request("node.invoke.result", buildNodeInvokeResultParams(frame, result));
  } catch {}
}
export function buildNodeInvokeResultParams(frame, result) {
  const params = {
    id: frame.id,
    nodeId: frame.nodeId,
    ok: result.ok,
  };
  if (result.payload !== undefined) {
    params.payload = result.payload;
  }
  if (typeof result.payloadJSON === "string") {
    params.payloadJSON = result.payloadJSON;
  }
  if (result.error) {
    params.error = result.error;
  }
  return params;
}
async function sendNodeEvent(client, event, payload) {
  try {
    await client.request("node.event", {
      event,
      payloadJSON: payload ? JSON.stringify(payload) : null,
    });
  } catch {}
}
