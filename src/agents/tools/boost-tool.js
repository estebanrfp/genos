import { BOOST_MODELS } from "../../commands/auth-choice-options.js";
import { resolveModel } from "../pi-embedded-runner/model.js";

/**
 * Create the boost tool — activates the advanced model mid-stream.
 * Same behavior as GenosOS Pro: LLM calls boost BEFORE answering,
 * model switches via agent.setModel(), next round uses advanced model.
 * @param {{ sessionRef: { current: any }, provider: string, agentDir?: string, config?: any, sessionKey?: string }} options
 */
export function createBoostTool({ sessionRef, provider, agentDir, config }) {
  return {
    label: "Boost",
    name: "boost",
    description:
      "Activate the advanced model for higher quality. Call this BEFORE answering when the user expresses high importance, urgency, or desire for excellence in the task. After boost activates, re-process the task with the advanced model.",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      const session = sessionRef?.current;
      if (!session) {
        return {
          content: [{ type: "text", text: "Boost unavailable — no active session." }],
          details: { ok: false },
        };
      }

      const normalizedProvider = provider?.trim().toLowerCase();
      const pair = BOOST_MODELS[normalizedProvider];
      if (!pair?.boost) {
        return {
          content: [{ type: "text", text: `Boost unavailable for provider: ${provider}` }],
          details: { ok: false },
        };
      }

      const { model: boostModel } = resolveModel(normalizedProvider, pair.boost, agentDir, config);
      if (!boostModel) {
        return {
          content: [{ type: "text", text: `Boost model not found: ${pair.boost}` }],
          details: { ok: false },
        };
      }

      session.agent.setModel(boostModel);
      console.log(`[boost] activated → ${normalizedProvider}/${pair.boost}`);

      return {
        content: [{ type: "text", text: "Boost activated — re-processing with advanced model." }],
        details: { ok: true },
      };
    },
  };
}
