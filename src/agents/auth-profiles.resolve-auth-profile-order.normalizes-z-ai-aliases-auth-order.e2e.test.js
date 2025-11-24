let makeApiKeyStore = function (provider, profileIds) {
    return {
      version: 1,
      profiles: Object.fromEntries(
        profileIds.map((profileId) => [
          profileId,
          {
            type: "api_key",
            provider,
            key: profileId.endsWith(":work") ? "sk-work" : "sk-default",
          },
        ]),
      ),
    };
  },
  makeApiKeyProfilesByProviderProvider = function (providerByProfileId) {
    return Object.fromEntries(
      Object.entries(providerByProfileId).map(([profileId, provider]) => [
        profileId,
        { provider, mode: "api_key" },
      ]),
    );
  };
import { describe, expect, it } from "vitest";
import { resolveAuthProfileOrder } from "./auth-profiles.js";
describe("resolveAuthProfileOrder", () => {
  it("normalizes z.ai aliases in auth.order", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: { "z.ai": ["zai:work", "zai:default"] },
          profiles: makeApiKeyProfilesByProviderProvider({
            "zai:default": "zai",
            "zai:work": "zai",
          }),
        },
      },
      store: makeApiKeyStore("zai", ["zai:default", "zai:work"]),
      provider: "zai",
    });
    expect(order).toEqual(["zai:work", "zai:default"]);
  });
  it("normalizes provider casing in auth.order keys", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          order: { OpenAI: ["openai:work", "openai:default"] },
          profiles: makeApiKeyProfilesByProviderProvider({
            "openai:default": "openai",
            "openai:work": "openai",
          }),
        },
      },
      store: makeApiKeyStore("openai", ["openai:default", "openai:work"]),
      provider: "openai",
    });
    expect(order).toEqual(["openai:work", "openai:default"]);
  });
  it("normalizes z.ai aliases in auth.profiles", () => {
    const order = resolveAuthProfileOrder({
      cfg: {
        auth: {
          profiles: makeApiKeyProfilesByProviderProvider({
            "zai:default": "z.ai",
            "zai:work": "Z.AI",
          }),
        },
      },
      store: makeApiKeyStore("zai", ["zai:default", "zai:work"]),
      provider: "zai",
    });
    expect(order).toEqual(["zai:default", "zai:work"]);
  });
  it("prioritizes oauth profiles when order missing", () => {
    const mixedStore = {
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-default",
        },
        "anthropic:oauth": {
          type: "oauth",
          provider: "anthropic",
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60000,
        },
      },
    };
    const order = resolveAuthProfileOrder({
      store: mixedStore,
      provider: "anthropic",
    });
    expect(order).toEqual(["anthropic:oauth", "anthropic:default"]);
  });
});
