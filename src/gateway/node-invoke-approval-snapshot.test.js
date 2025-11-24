import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { ExecApprovalManager } from "./exec-approval-manager.js";
import { sanitizeSystemRunParamsForForwarding } from "./node-invoke-system-run-approval.js";

describe("approval snapshot binding", () => {
  function setupApproval(manager, { command, argv, argvHash, scriptContentHash } = {}) {
    const cmd = command ?? "python script.py";
    const av = argv ?? ["python", "script.py"];
    const hash = argvHash ?? createHash("sha256").update(JSON.stringify(av)).digest("hex");
    const record = manager.create(
      {
        command: cmd,
        cwd: "/tmp",
        host: "node",
        agentId: "test-agent",
        sessionKey: "main",
        argvHash: hash,
        scriptContentHash: scriptContentHash ?? undefined,
      },
      30000,
      "test-approval-id",
    );
    record.decision = "allow-once";
    record.resolvedAtMs = Date.now();
    record.resolvedBy = "operator";
    record.requestedByConnId = "conn-1";
    record.requestedByDeviceId = null;
    record.requestedByClientId = null;
    manager.pending = manager.pending ?? new Map();
    manager.pending.set(record.id, {
      record,
      resolve: () => {},
      reject: () => {},
      timer: null,
      promise: Promise.resolve(),
    });
    return record;
  }

  it("accepts matching argv hash", () => {
    const manager = new ExecApprovalManager();
    setupApproval(manager);

    const result = sanitizeSystemRunParamsForForwarding({
      rawParams: {
        command: ["python", "script.py"],
        rawCommand: "python script.py",
        cwd: "/tmp",
        agentId: "test-agent",
        sessionKey: "main",
        approved: true,
        approvalDecision: "allow-once",
        runId: "test-approval-id",
      },
      execApprovalManager: manager,
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects mismatched argv hash", () => {
    const manager = new ExecApprovalManager();
    setupApproval(manager);

    const result = sanitizeSystemRunParamsForForwarding({
      rawParams: {
        command: ["python", "malicious.py"],
        rawCommand: "python malicious.py",
        cwd: "/tmp",
        agentId: "test-agent",
        sessionKey: "main",
        approved: true,
        approvalDecision: "allow-once",
        runId: "test-approval-id",
      },
      execApprovalManager: manager,
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } },
    });

    expect(result.ok).toBe(false);
    expect(result.details.code).toBe("APPROVAL_REQUEST_MISMATCH");
  });

  it("accepts when no argv hash in record (backward compat)", () => {
    const manager = new ExecApprovalManager();
    const record = manager.create(
      {
        command: "ls -la",
        cwd: "/tmp",
        host: "node",
        agentId: "test-agent",
        sessionKey: "main",
      },
      30000,
      "no-hash-id",
    );
    record.decision = "allow-once";
    record.resolvedAtMs = Date.now();
    record.resolvedBy = "operator";
    record.requestedByConnId = "conn-1";
    record.requestedByDeviceId = null;
    manager.pending.set(record.id, {
      record,
      resolve: () => {},
      reject: () => {},
      timer: null,
      promise: Promise.resolve(),
    });

    const result = sanitizeSystemRunParamsForForwarding({
      rawParams: {
        command: ["ls", "-la"],
        rawCommand: "ls -la",
        cwd: "/tmp",
        agentId: "test-agent",
        sessionKey: "main",
        approved: true,
        approvalDecision: "allow-once",
        runId: "no-hash-id",
      },
      execApprovalManager: manager,
      client: { connId: "conn-1", connect: { scopes: ["operator.admin"] } },
    });

    expect(result.ok).toBe(true);
  });
});
