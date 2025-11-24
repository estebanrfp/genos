let asRecord = function (value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  },
  normalizeString = function (value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  },
  normalizeApprovalDecision = function (value) {
    const s = normalizeString(value);
    return s === "allow-once" || s === "allow-always" ? s : null;
  },
  clientHasApprovals = function (client) {
    const scopes = Array.isArray(client?.connect?.scopes) ? client?.connect?.scopes : [];
    return scopes.includes("operator.admin") || scopes.includes("operator.approvals");
  },
  getCmdText = function (params) {
    const raw = normalizeString(params.rawCommand);
    if (raw) {
      return raw;
    }
    if (Array.isArray(params.command)) {
      const parts = params.command.map((v) => String(v));
      if (parts.length > 0) {
        return formatExecCommand(parts);
      }
    }
    return "";
  },
  approvalMatchesRequest = function (params, record) {
    if (record.request.host !== "node") {
      return false;
    }
    const cmdText = getCmdText(params);
    if (!cmdText || record.request.command !== cmdText) {
      return false;
    }
    const reqCwd = record.request.cwd ?? null;
    const runCwd = normalizeString(params.cwd) ?? null;
    if (reqCwd !== runCwd) {
      return false;
    }
    const reqAgentId = record.request.agentId ?? null;
    const runAgentId = normalizeString(params.agentId) ?? null;
    if (reqAgentId !== runAgentId) {
      return false;
    }
    const reqSessionKey = record.request.sessionKey ?? null;
    const runSessionKey = normalizeString(params.sessionKey) ?? null;
    if (reqSessionKey !== runSessionKey) {
      return false;
    }
    if (record.request.argvHash) {
      const actualArgvHash = createHash("sha256")
        .update(JSON.stringify(Array.isArray(params.command) ? params.command.map(String) : []))
        .digest("hex");
      if (actualArgvHash !== record.request.argvHash) {
        return false;
      }
    }
    return true;
  },
  pickSystemRunParams = function (raw) {
    const next = {};
    for (const key of [
      "command",
      "rawCommand",
      "cwd",
      "env",
      "timeoutMs",
      "needsScreenRecording",
      "agentId",
      "sessionKey",
      "runId",
    ]) {
      if (key in raw) {
        next[key] = raw[key];
      }
    }
    return next;
  };
import { createHash } from "node:crypto";
import {
  formatExecCommand,
  validateSystemRunCommandConsistency,
} from "../infra/system-run-command.js";
export function sanitizeSystemRunParamsForForwarding(opts) {
  const obj = asRecord(opts.rawParams);
  if (!obj) {
    return { ok: true, params: opts.rawParams };
  }
  const p = obj;
  const argv = Array.isArray(p.command) ? p.command.map((v) => String(v)) : [];
  const raw = normalizeString(p.rawCommand);
  if (raw) {
    if (!Array.isArray(p.command) || argv.length === 0) {
      return {
        ok: false,
        message: "rawCommand requires params.command",
        details: { code: "MISSING_COMMAND" },
      };
    }
    const validation = validateSystemRunCommandConsistency({ argv, rawCommand: raw });
    if (!validation.ok) {
      return {
        ok: false,
        message: validation.message,
        details: validation.details ?? { code: "RAW_COMMAND_MISMATCH" },
      };
    }
  }
  const approved = p.approved === true;
  const requestedDecision = normalizeApprovalDecision(p.approvalDecision);
  const wantsApprovalOverride = approved || requestedDecision !== null;
  const next = pickSystemRunParams(obj);
  if (!wantsApprovalOverride) {
    return { ok: true, params: next };
  }
  const runId = normalizeString(p.runId);
  if (!runId) {
    return {
      ok: false,
      message: "approval override requires params.runId",
      details: { code: "MISSING_RUN_ID" },
    };
  }
  const manager = opts.execApprovalManager;
  if (!manager) {
    return {
      ok: false,
      message: "exec approvals unavailable",
      details: { code: "APPROVALS_UNAVAILABLE" },
    };
  }
  const snapshot = manager.getSnapshot(runId);
  if (!snapshot) {
    return {
      ok: false,
      message: "unknown or expired approval id",
      details: { code: "UNKNOWN_APPROVAL_ID", runId },
    };
  }
  const nowMs = typeof opts.nowMs === "number" ? opts.nowMs : Date.now();
  if (nowMs > snapshot.expiresAtMs) {
    return {
      ok: false,
      message: "approval expired",
      details: { code: "APPROVAL_EXPIRED", runId },
    };
  }
  const snapshotDeviceId = snapshot.requestedByDeviceId ?? null;
  const clientDeviceId = opts.client?.connect?.device?.id ?? null;
  if (snapshotDeviceId) {
    if (snapshotDeviceId !== clientDeviceId) {
      return {
        ok: false,
        message: "approval id not valid for this device",
        details: { code: "APPROVAL_DEVICE_MISMATCH", runId },
      };
    }
  } else if (
    snapshot.requestedByConnId &&
    snapshot.requestedByConnId !== (opts.client?.connId ?? null)
  ) {
    return {
      ok: false,
      message: "approval id not valid for this client",
      details: { code: "APPROVAL_CLIENT_MISMATCH", runId },
    };
  }
  if (!approvalMatchesRequest(p, snapshot)) {
    return {
      ok: false,
      message: "approval id does not match request",
      details: { code: "APPROVAL_REQUEST_MISMATCH", runId },
    };
  }
  if (snapshot.decision === "allow-once" || snapshot.decision === "allow-always") {
    next.approved = true;
    next.approvalDecision = snapshot.decision;
    return { ok: true, params: next };
  }
  const timedOut =
    snapshot.resolvedAtMs !== undefined &&
    snapshot.decision === undefined &&
    snapshot.resolvedBy === null;
  if (
    timedOut &&
    approved &&
    requestedDecision === "allow-once" &&
    clientHasApprovals(opts.client)
  ) {
    next.approved = true;
    next.approvalDecision = "allow-once";
    return { ok: true, params: next };
  }
  return {
    ok: false,
    message: "approval required",
    details: { code: "APPROVAL_REQUIRED", runId },
  };
}
