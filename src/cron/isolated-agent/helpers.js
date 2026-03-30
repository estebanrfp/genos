import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  stripHeartbeatToken,
} from "../../auto-reply/heartbeat.js";
import { truncateUtf16Safe } from "../../utils.js";
export function pickSummaryFromOutput(text) {
  const clean = (text ?? "").trim();
  if (!clean) {
    return;
  }
  const limit = 2000;
  return clean.length > limit ? `${truncateUtf16Safe(clean, limit)}\u2026` : clean;
}
export function pickSummaryFromPayloads(payloads) {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const summary = pickSummaryFromOutput(payloads[i]?.text);
    if (summary) {
      return summary;
    }
  }
  return;
}
export function pickLastNonEmptyTextFromPayloads(payloads) {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const clean = (payloads[i]?.text ?? "").trim();
    if (clean) {
      return clean;
    }
  }
  return;
}
export function pickLastDeliverablePayload(payloads) {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const payload = payloads[i];
    const text = (payload?.text ?? "").trim();
    const hasMedia = Boolean(payload?.mediaUrl) || (payload?.mediaUrls?.length ?? 0) > 0;
    const hasChannelData = Object.keys(payload?.channelData ?? {}).length > 0;
    if (text || hasMedia || hasChannelData) {
      return payload;
    }
  }
  return;
}
export function isHeartbeatOnlyResponse(payloads, ackMaxChars) {
  if (payloads.length === 0) {
    return true;
  }
  return payloads.every((payload) => {
    const hasMedia = (payload.mediaUrls?.length ?? 0) > 0 || Boolean(payload.mediaUrl);
    if (hasMedia) {
      return false;
    }
    const result = stripHeartbeatToken(payload.text, {
      mode: "heartbeat",
      maxAckChars: ackMaxChars,
    });
    return result.shouldSkip;
  });
}
export function resolveHeartbeatAckMaxChars(agentCfg) {
  const raw = agentCfg?.heartbeat?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS;
  return Math.max(0, raw);
}
