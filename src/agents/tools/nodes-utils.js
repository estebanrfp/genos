let pickDefaultNode = function (nodes) {
  const withCanvas = nodes.filter((n) =>
    Array.isArray(n.caps) ? n.caps.includes("canvas") : true,
  );
  if (withCanvas.length === 0) {
    return null;
  }
  const connected = withCanvas.filter((n) => n.connected);
  const candidates = connected.length > 0 ? connected : withCanvas;
  if (candidates.length === 1) {
    return candidates[0];
  }
  const local = candidates.filter(
    (n) =>
      n.platform?.toLowerCase().startsWith("mac") &&
      typeof n.nodeId === "string" &&
      n.nodeId.startsWith("mac-"),
  );
  if (local.length === 1) {
    return local[0];
  }
  return null;
};
import { parseNodeList, parsePairingList } from "../../shared/node-list-parse.js";
import { resolveNodeIdFromCandidates } from "../../shared/node-match.js";
import { callGatewayTool } from "./gateway.js";
async function loadNodes(opts) {
  try {
    const res = await callGatewayTool("node.list", opts, {});
    return parseNodeList(res);
  } catch {
    const res = await callGatewayTool("node.pair.list", opts, {});
    const { paired } = parsePairingList(res);
    return paired.map((n) => ({
      nodeId: n.nodeId,
      displayName: n.displayName,
      platform: n.platform,
      remoteIp: n.remoteIp,
    }));
  }
}
export async function listNodes(opts) {
  return loadNodes(opts);
}
export function resolveNodeIdFromList(nodes, query, allowDefault = false) {
  const q = String(query ?? "").trim();
  if (!q) {
    if (allowDefault) {
      const picked = pickDefaultNode(nodes);
      if (picked) {
        return picked.nodeId;
      }
    }
    throw new Error("node required");
  }
  return resolveNodeIdFromCandidates(nodes, q);
}
export async function resolveNodeId(opts, query, allowDefault = false) {
  const nodes = await loadNodes(opts);
  return resolveNodeIdFromList(nodes, query, allowDefault);
}
