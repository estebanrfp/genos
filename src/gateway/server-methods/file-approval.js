import { DEFAULT_FILE_APPROVAL_TIMEOUT_MS } from "../file-approval-manager.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

/**
 * Creates the `files.approval.request` RPC handler.
 * Called by the Write/Edit tool wrappers (via callGatewayTool) when the agent
 * attempts to write to a protected workspace file (AGENTS.md, SECURITY.md).
 * Blocks until the workspace owner approves or denies via biometric (Touch ID / Face ID).
 *
 * @param {import("../file-approval-manager.js").FileApprovalManager} manager
 * @returns {Record<string, Function>}
 */
export function createFileApprovalRequestHandler(manager) {
  return {
    "files.approval.request": async ({ params, respond, context }) => {
      const p = params;
      if (!p || typeof p.name !== "string" || !p.name.trim()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "name is required"));
        return;
      }
      const timeoutMs =
        typeof p.timeoutMs === "number" ? p.timeoutMs : DEFAULT_FILE_APPROVAL_TIMEOUT_MS;
      const request = {
        agentId: typeof p.agentId === "string" ? p.agentId : null,
        name: p.name.trim(),
        operation: typeof p.operation === "string" ? p.operation.trim() : "write",
        preview: typeof p.preview === "string" ? p.preview.slice(0, 500) : null,
      };
      const record = manager.create(request, timeoutMs);
      let decisionPromise;
      try {
        decisionPromise = manager.register(record, timeoutMs);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `registration failed: ${String(err)}`),
        );
        return;
      }
      context.broadcast(
        "files.approval.required",
        {
          id: record.id,
          agentId: request.agentId,
          name: request.name,
          operation: request.operation,
          preview: request.preview,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const decision = await decisionPromise;
      respond(
        true,
        {
          id: record.id,
          decision,
          createdAtMs: record.createdAtMs,
          expiresAtMs: record.expiresAtMs,
        },
        undefined,
      );
    },
  };
}
