import { parseDiscordTarget } from "../../../discord/targets.js";
export function normalizeDiscordMessagingTarget(raw) {
  const target = parseDiscordTarget(raw, { defaultKind: "channel" });
  return target?.normalized;
}
export function normalizeDiscordOutboundTarget(to) {
  const trimmed = to?.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: new Error(
        'Discord recipient is required. Use "channel:<id>" for channels or "user:<id>" for DMs.',
      ),
    };
  }
  if (/^\d+$/.test(trimmed)) {
    return { ok: true, to: `channel:${trimmed}` };
  }
  return { ok: true, to: trimmed };
}
export function looksLikeDiscordTargetId(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  if (/^<@!?\d+>$/.test(trimmed)) {
    return true;
  }
  if (/^(user|channel|discord):/i.test(trimmed)) {
    return true;
  }
  if (/^\d{6,}$/.test(trimmed)) {
    return true;
  }
  return false;
}
