import { callGateway, randomIdempotencyKey } from "../../gateway/call.js";
import { resolveNodeIdFromCandidates } from "../../shared/node-match.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { withProgress } from "../progress.js";
import { parseNodeList, parsePairingList } from "./format.js";
export const nodesCallOpts = (cmd, defaults) =>
  cmd
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--timeout <ms>", "Timeout in ms", String(defaults?.timeoutMs ?? 1e4))
    .option("--json", "Output JSON", false);
export const callGatewayCli = async (method, opts, params, callOpts) =>
  withProgress(
    {
      label: `Nodes ${method}`,
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await callGateway({
        url: opts.url,
        token: opts.token,
        method,
        params,
        timeoutMs: callOpts?.transportTimeoutMs ?? Number(opts.timeout ?? 1e4),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );
export function buildNodeInvokeParams(params) {
  const invokeParams = {
    nodeId: params.nodeId,
    command: params.command,
    params: params.params,
    idempotencyKey: params.idempotencyKey ?? randomIdempotencyKey(),
  };
  if (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)) {
    invokeParams.timeoutMs = params.timeoutMs;
  }
  return invokeParams;
}
export function unauthorizedHintForMessage(message) {
  const haystack = message.toLowerCase();
  if (
    haystack.includes("unauthorizedclient") ||
    haystack.includes("bridge client is not authorized") ||
    haystack.includes("unsigned bridge clients are not allowed")
  ) {
    return [
      "peekaboo bridge rejected the client.",
      "sign the peekaboo CLI (TeamID Y5PE65HELJ) or launch the host with",
      "PEEKABOO_ALLOW_UNSIGNED_SOCKET_CLIENTS=1 for local dev.",
    ].join(" ");
  }
  return null;
}
export async function resolveNodeId(opts, query) {
  const q = String(query ?? "").trim();
  if (!q) {
    throw new Error("node required");
  }
  let nodes = [];
  try {
    const res = await callGatewayCli("node.list", opts, {});
    nodes = parseNodeList(res);
  } catch {
    const res = await callGatewayCli("node.pair.list", opts, {});
    const { paired } = parsePairingList(res);
    nodes = paired.map((n) => ({
      nodeId: n.nodeId,
      displayName: n.displayName,
      platform: n.platform,
      version: n.version,
      remoteIp: n.remoteIp,
    }));
  }
  return resolveNodeIdFromCandidates(nodes, q);
}
