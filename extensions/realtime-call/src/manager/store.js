import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { CallRecordSchema, TerminalStates } from "../types.js";
export function persistCallRecord(storePath, call) {
  const logPath = path.join(storePath, "calls.jsonl");
  const line = `${JSON.stringify(call)}\n`;
  fsp.appendFile(logPath, line).catch((err) => {
    console.error("[voice-call] Failed to persist call record:", err);
  });
}
export function loadActiveCallsFromStore(storePath) {
  const logPath = path.join(storePath, "calls.jsonl");
  if (!fs.existsSync(logPath)) {
    return {
      activeCalls: new Map(),
      providerCallIdMap: new Map(),
      processedEventIds: new Set(),
      rejectedProviderCallIds: new Set(),
    };
  }
  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n");
  const callMap = new Map();
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const call = CallRecordSchema.parse(JSON.parse(line));
      callMap.set(call.callId, call);
    } catch {}
  }
  const activeCalls = new Map();
  const providerCallIdMap = new Map();
  const processedEventIds = new Set();
  const rejectedProviderCallIds = new Set();
  for (const [callId, call] of callMap) {
    if (TerminalStates.has(call.state)) {
      continue;
    }
    activeCalls.set(callId, call);
    if (call.providerCallId) {
      providerCallIdMap.set(call.providerCallId, callId);
    }
    for (const eventId of call.processedEventIds) {
      processedEventIds.add(eventId);
    }
  }
  return { activeCalls, providerCallIdMap, processedEventIds, rejectedProviderCallIds };
}
export async function getCallHistoryFromStore(storePath, limit = 50) {
  const logPath = path.join(storePath, "calls.jsonl");
  try {
    await fsp.access(logPath);
  } catch {
    return [];
  }
  const content = await fsp.readFile(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const calls = [];
  for (const line of lines.slice(-limit)) {
    try {
      const parsed = CallRecordSchema.parse(JSON.parse(line));
      calls.push(parsed);
    } catch {}
  }
  return calls;
}
