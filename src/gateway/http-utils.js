import { randomUUID } from "node:crypto";
import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";
export function getHeader(req, name) {
  const raw = req.headers[name.toLowerCase()];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return;
}
export function getBearerToken(req) {
  const raw = getHeader(req, "authorization")?.trim() ?? "";
  if (!raw.toLowerCase().startsWith("bearer ")) {
    return;
  }
  const token = raw.slice(7).trim();
  return token || undefined;
}
export function resolveAgentIdFromHeader(req) {
  const raw =
    getHeader(req, "x-genosos-agent-id")?.trim() || getHeader(req, "x-genosos-agent")?.trim() || "";
  if (!raw) {
    return;
  }
  return normalizeAgentId(raw);
}
export function resolveAgentIdFromModel(model) {
  const raw = model?.trim();
  if (!raw) {
    return;
  }
  const m =
    raw.match(/^genosos[:/](?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i) ??
    raw.match(/^agent:(?<agentId>[a-z0-9][a-z0-9_-]{0,63})$/i);
  const agentId = m?.groups?.agentId;
  if (!agentId) {
    return;
  }
  return normalizeAgentId(agentId);
}
export function resolveAgentIdForRequest(params) {
  const fromHeader = resolveAgentIdFromHeader(params.req);
  if (fromHeader) {
    return fromHeader;
  }
  const fromModel = resolveAgentIdFromModel(params.model);
  return fromModel ?? "main";
}
export function resolveSessionKey(params) {
  const explicit = getHeader(params.req, "x-genosos-session-key")?.trim();
  if (explicit) {
    return explicit;
  }
  const user = params.user?.trim();
  const mainKey = user ? `${params.prefix}-user:${user}` : `${params.prefix}:${randomUUID()}`;
  return buildAgentMainSessionKey({ agentId: params.agentId, mainKey });
}
