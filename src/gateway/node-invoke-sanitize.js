import { sanitizeSystemRunParamsForForwarding } from "./node-invoke-system-run-approval.js";
export function sanitizeNodeInvokeParamsForForwarding(opts) {
  if (opts.command === "system.run") {
    return sanitizeSystemRunParamsForForwarding({
      rawParams: opts.rawParams,
      client: opts.client,
      execApprovalManager: opts.execApprovalManager,
    });
  }
  return { ok: true, params: opts.rawParams };
}
