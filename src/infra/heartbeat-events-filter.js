let isHeartbeatAckEvent = function (evt) {
    const trimmed = evt.trim();
    if (!trimmed) {
      return false;
    }
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith(HEARTBEAT_OK_PREFIX)) {
      return false;
    }
    const suffix = lower.slice(HEARTBEAT_OK_PREFIX.length);
    if (suffix.length === 0) {
      return true;
    }
    return !/[a-z0-9_]/.test(suffix[0]);
  },
  isHeartbeatNoiseEvent = function (evt) {
    const lower = evt.trim().toLowerCase();
    if (!lower) {
      return false;
    }
    return (
      isHeartbeatAckEvent(lower) ||
      lower.includes("heartbeat poll") ||
      lower.includes("heartbeat wake")
    );
  };
import { HEARTBEAT_TOKEN } from "../auto-reply/tokens.js";
export function buildCronEventPrompt(pendingEvents) {
  const eventText = pendingEvents.join("\n").trim();
  if (!eventText) {
    return "A scheduled cron event was triggered, but no event content was found. Reply HEARTBEAT_OK.";
  }
  return (
    "A scheduled reminder has been triggered. The reminder content is:\n\n" +
    eventText +
    "\n\nPlease relay this reminder to the user in a helpful and friendly way."
  );
}
const HEARTBEAT_OK_PREFIX = HEARTBEAT_TOKEN.toLowerCase();
export function isExecCompletionEvent(evt) {
  return evt.toLowerCase().includes("exec finished");
}
export function isCronSystemEvent(evt) {
  if (!evt.trim()) {
    return false;
  }
  return !isHeartbeatNoiseEvent(evt) && !isExecCompletionEvent(evt);
}
