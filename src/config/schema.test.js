import { describe, expect, it } from "vitest";
import { buildConfigSchema } from "./schema.js";
describe("config schema", () => {
  it("exports schema + hints", () => {
    const res = buildConfigSchema();
    const schema = res.schema;
    expect(schema.properties?.gateway).toBeTruthy();
    expect(schema.properties?.agents).toBeTruthy();
    expect(schema.properties?.$schema).toBeUndefined();
    expect(res.uiHints.gateway?.label).toBe("Gateway");
    expect(res.uiHints["gateway.auth.token"]?.sensitive).toBe(true);
    expect(res.version).toBeTruthy();
    expect(res.generatedAt).toBeTruthy();
  });
  it("merges plugin ui hints", () => {
    const res = buildConfigSchema({
      plugins: [
        {
          id: "voice-call",
          name: "Voice Call",
          description: "Outbound voice calls",
          configUiHints: {
            provider: { label: "Provider" },
            "twilio.authToken": { label: "Auth Token", sensitive: true },
          },
        },
      ],
    });
    expect(res.uiHints["plugins.entries.voice-call"]?.label).toBe("Voice Call");
    expect(res.uiHints["plugins.entries.voice-call.config"]?.label).toBe("Voice Call Config");
    expect(res.uiHints["plugins.entries.voice-call.config.twilio.authToken"]?.label).toBe(
      "Auth Token",
    );
    expect(res.uiHints["plugins.entries.voice-call.config.twilio.authToken"]?.sensitive).toBe(true);
  });
  it("does not re-mark existing non-sensitive token-like fields", () => {
    const res = buildConfigSchema({
      plugins: [
        {
          id: "voice-call",
          configUiHints: {
            tokens: { label: "Tokens", sensitive: false },
          },
        },
      ],
    });
    expect(res.uiHints["plugins.entries.voice-call.config.tokens"]?.sensitive).toBe(false);
  });
  it("merges plugin + channel schemas", () => {
    const res = buildConfigSchema({
      plugins: [
        {
          id: "voice-call",
          name: "Voice Call",
          configSchema: {
            type: "object",
            properties: {
              provider: { type: "string" },
            },
          },
        },
      ],
      channels: [
        {
          id: "matrix",
          label: "Matrix",
          configSchema: {
            type: "object",
            properties: {
              accessToken: { type: "string" },
            },
          },
        },
      ],
    });
    const schema = res.schema;
    const pluginsNode = schema.properties?.plugins;
    const entriesNode = pluginsNode?.properties;
    const entriesProps = entriesNode?.entries;
    const entryProps = entriesProps?.properties;
    const pluginEntry = entryProps?.["voice-call"];
    const pluginConfig = pluginEntry?.properties;
    const pluginConfigSchema = pluginConfig?.config;
    const pluginConfigProps = pluginConfigSchema?.properties;
    expect(pluginConfigProps?.provider).toBeTruthy();
    const channelsNode = schema.properties?.channels;
    const channelsProps = channelsNode?.properties;
    const channelSchema = channelsProps?.matrix;
    const channelProps = channelSchema?.properties;
    expect(channelProps?.accessToken).toBeTruthy();
  });
  it("adds heartbeat target hints with dynamic channels", () => {
    const res = buildConfigSchema({
      channels: [
        {
          id: "bluebubbles",
          label: "BlueBubbles",
          configSchema: { type: "object" },
        },
      ],
    });
    const defaultsHint = res.uiHints["agents.defaults.heartbeat.target"];
    const listHint = res.uiHints["agents.list.*.heartbeat.target"];
    expect(defaultsHint?.help).toContain("bluebubbles");
    expect(defaultsHint?.help).toContain("last");
    expect(listHint?.help).toContain("bluebubbles");
  });
});
