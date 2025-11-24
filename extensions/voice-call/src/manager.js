let resolveDefaultStoreBase = function (config, storePath) {
  const rawOverride = storePath?.trim() || config.store?.trim();
  if (rawOverride) {
    return resolveUserPath(rawOverride);
  }
  const preferred = path.join(os.homedir(), ".genos", "voice-calls");
  const candidates = [preferred].map((dir) => resolveUserPath(dir));
  const existing =
    candidates.find((dir) => {
      try {
        return fs.existsSync(path.join(dir, "calls.jsonl")) || fs.existsSync(dir);
      } catch {
        return false;
      }
    }) ?? resolveUserPath(preferred);
  return existing;
};
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processEvent as processManagerEvent } from "./manager/events.js";
import { getCallByProviderCallId as getCallByProviderCallIdFromMaps } from "./manager/lookup.js";
import {
  continueCall as continueCallWithContext,
  endCall as endCallWithContext,
  initiateCall as initiateCallWithContext,
  speak as speakWithContext,
  speakInitialMessage as speakInitialMessageWithContext,
} from "./manager/outbound.js";
import { getCallHistoryFromStore, loadActiveCallsFromStore } from "./manager/store.js";
import { resolveUserPath } from "./utils.js";

export class CallManager {
  activeCalls = new Map();
  providerCallIdMap = new Map();
  processedEventIds = new Set();
  rejectedProviderCallIds = new Set();
  provider = null;
  config;
  storePath;
  webhookUrl = null;
  activeTurnCalls = new Set();
  transcriptWaiters = new Map();
  maxDurationTimers = new Map();
  constructor(config, storePath) {
    this.config = config;
    this.storePath = resolveDefaultStoreBase(config, storePath);
  }
  initialize(provider, webhookUrl) {
    this.provider = provider;
    this.webhookUrl = webhookUrl;
    fs.mkdirSync(this.storePath, { recursive: true });
    const persisted = loadActiveCallsFromStore(this.storePath);
    this.activeCalls = persisted.activeCalls;
    this.providerCallIdMap = persisted.providerCallIdMap;
    this.processedEventIds = persisted.processedEventIds;
    this.rejectedProviderCallIds = persisted.rejectedProviderCallIds;
  }
  getProvider() {
    return this.provider;
  }
  async initiateCall(to, sessionKey, options) {
    return initiateCallWithContext(this.getContext(), to, sessionKey, options);
  }
  async speak(callId, text) {
    return speakWithContext(this.getContext(), callId, text);
  }
  async speakInitialMessage(providerCallId) {
    return speakInitialMessageWithContext(this.getContext(), providerCallId);
  }
  async continueCall(callId, prompt) {
    return continueCallWithContext(this.getContext(), callId, prompt);
  }
  async endCall(callId) {
    return endCallWithContext(this.getContext(), callId);
  }
  getContext() {
    return {
      activeCalls: this.activeCalls,
      providerCallIdMap: this.providerCallIdMap,
      processedEventIds: this.processedEventIds,
      rejectedProviderCallIds: this.rejectedProviderCallIds,
      provider: this.provider,
      config: this.config,
      storePath: this.storePath,
      webhookUrl: this.webhookUrl,
      activeTurnCalls: this.activeTurnCalls,
      transcriptWaiters: this.transcriptWaiters,
      maxDurationTimers: this.maxDurationTimers,
      onCallAnswered: (call) => {
        this.maybeSpeakInitialMessageOnAnswered(call);
      },
    };
  }
  processEvent(event) {
    processManagerEvent(this.getContext(), event);
  }
  maybeSpeakInitialMessageOnAnswered(call) {
    const initialMessage =
      typeof call.metadata?.initialMessage === "string" ? call.metadata.initialMessage.trim() : "";
    if (!initialMessage) {
      return;
    }
    if (!this.provider || !call.providerCallId) {
      return;
    }
    if (this.provider.name === "twilio") {
      return;
    }
    this.speakInitialMessage(call.providerCallId);
  }
  getCall(callId) {
    return this.activeCalls.get(callId);
  }
  getCallByProviderCallId(providerCallId) {
    return getCallByProviderCallIdFromMaps({
      activeCalls: this.activeCalls,
      providerCallIdMap: this.providerCallIdMap,
      providerCallId,
    });
  }
  getActiveCalls() {
    return Array.from(this.activeCalls.values());
  }
  async getCallHistory(limit = 50) {
    return getCallHistoryFromStore(this.storePath, limit);
  }
}
