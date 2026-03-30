let normalizeNodeInvokeResultParams = function (params) {
  if (!params || typeof params !== "object") {
    return params;
  }
  const raw = params;
  const normalized = { ...raw };
  if (normalized.payloadJSON === null) {
    delete normalized.payloadJSON;
  } else if (normalized.payloadJSON !== undefined && typeof normalized.payloadJSON !== "string") {
    if (normalized.payload === undefined) {
      normalized.payload = normalized.payloadJSON;
    }
    delete normalized.payloadJSON;
  }
  if (normalized.error === null) {
    delete normalized.error;
  }
  return normalized;
};
import { ErrorCodes, errorShape, validateNodeInvokeResultParams } from "../protocol/index.js";
import { respondInvalidParams } from "./nodes.helpers.js";
export const handleNodeInvokeResult = async ({ params, respond, context, client }) => {
  const normalizedParams = normalizeNodeInvokeResultParams(params);
  if (!validateNodeInvokeResultParams(normalizedParams)) {
    respondInvalidParams({
      respond,
      method: "node.invoke.result",
      validator: validateNodeInvokeResultParams,
    });
    return;
  }
  const p = normalizedParams;
  const callerNodeId = client?.connect?.device?.id ?? client?.connect?.client?.id;
  if (callerNodeId && callerNodeId !== p.nodeId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "nodeId mismatch"));
    return;
  }
  const ok = context.nodeRegistry.handleInvokeResult({
    id: p.id,
    nodeId: p.nodeId,
    ok: p.ok,
    payload: p.payload,
    payloadJSON: p.payloadJSON ?? null,
    error: p.error ?? null,
  });
  if (!ok) {
    context.logGateway.debug(`late invoke result ignored: id=${p.id} node=${p.nodeId}`);
    respond(true, { ok: true, ignored: true }, undefined);
    return;
  }
  respond(true, { ok: true }, undefined);
};
