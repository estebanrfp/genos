import { CommandLane } from "../../process/lanes.js";
export function resolveSessionLane(key) {
  const cleaned = key.trim() || CommandLane.Main;
  return cleaned.startsWith("session:") ? cleaned : `session:${cleaned}`;
}
export function resolveGlobalLane(lane) {
  const cleaned = lane?.trim();
  return cleaned ? cleaned : CommandLane.Main;
}
export function resolveEmbeddedSessionLane(key) {
  return resolveSessionLane(key);
}
