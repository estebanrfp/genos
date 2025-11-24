import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { isTruthyEnvValue } from "../infra/env.js";
import { applyExtraParamsToAgent } from "./pi-embedded-runner.js";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const LIVE = isTruthyEnvValue(process.env.OPENAI_LIVE_TEST) || isTruthyEnvValue(process.env.LIVE);
const describeLive = LIVE && OPENAI_KEY ? describe : describe.skip;
describeLive("pi embedded extra params (live)", () => {
  it("applies config maxTokens to openai streamFn", async () => {
    const model = getModel("openai", "gpt-5.2");
    const cfg = {
      agents: {
        defaults: {
          models: {
            "openai/gpt-5.2": {
              params: {
                maxTokens: 16,
              },
            },
          },
        },
      },
    };
    const agent = { streamFn: streamSimple };
    applyExtraParamsToAgent(agent, cfg, "openai", model.id);
    const stream = agent.streamFn(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Write the alphabet letters A through Z as words separated by commas.",
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: OPENAI_KEY },
    );
    let stopReason;
    let outputTokens;
    for await (const event of stream) {
      if (event.type === "done") {
        stopReason = event.reason;
        outputTokens = event.message.usage.output;
      }
    }
    expect(stopReason).toBeDefined();
    expect(outputTokens).toBeDefined();
    expect(outputTokens ?? 0).toBeLessThanOrEqual(20);
  }, 30000);
});
