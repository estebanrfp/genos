import { HEARTBEAT_PROMPT } from "../heartbeat.js";
import { BARE_SESSION_RESET_PROMPT } from "./session-reset-prompt.js";

/** Known prefixes for messages injected as role:"user" that are actually system instructions. */
export const SYSTEM_INSTRUCTION_PREFIXES = [
  BARE_SESSION_RESET_PROMPT.slice(0, 40),
  HEARTBEAT_PROMPT.slice(0, 40),
];

/**
 * Check whether a text string matches a known system instruction.
 * @param {string} text
 * @returns {boolean}
 */
export const isSystemInstruction = (text) =>
  typeof text === "string" && SYSTEM_INSTRUCTION_PREFIXES.some((prefix) => text.startsWith(prefix));
