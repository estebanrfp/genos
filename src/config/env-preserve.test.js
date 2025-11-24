import { describe, it, expect } from "vitest";
import { restoreEnvVarRefs } from "./env-preserve.js";
describe("restoreEnvVarRefs", () => {
  const env = {
    ANTHROPIC_API_KEY: "sk-ant-api03-real-key",
    OPENAI_API_KEY: "sk-openai-real-key",
    MY_TOKEN: "tok-12345",
  };
  it("restores a simple ${VAR} reference when value matches", () => {
    const incoming = { apiKey: "sk-ant-api03-real-key" };
    const parsed = { apiKey: "${ANTHROPIC_API_KEY}" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ apiKey: "${ANTHROPIC_API_KEY}" });
  });
  it("keeps new value when caller intentionally changed it", () => {
    const incoming = { apiKey: "sk-ant-new-different-key" };
    const parsed = { apiKey: "${ANTHROPIC_API_KEY}" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ apiKey: "sk-ant-new-different-key" });
  });
  it("handles nested objects", () => {
    const incoming = {
      models: {
        providers: {
          anthropic: { apiKey: "sk-ant-api03-real-key" },
          openai: { apiKey: "sk-openai-real-key" },
        },
      },
    };
    const parsed = {
      models: {
        providers: {
          anthropic: { apiKey: "${ANTHROPIC_API_KEY}" },
          openai: { apiKey: "${OPENAI_API_KEY}" },
        },
      },
    };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({
      models: {
        providers: {
          anthropic: { apiKey: "${ANTHROPIC_API_KEY}" },
          openai: { apiKey: "${OPENAI_API_KEY}" },
        },
      },
    });
  });
  it("preserves new keys not in parsed", () => {
    const incoming = { apiKey: "sk-ant-api03-real-key", newField: "hello" };
    const parsed = { apiKey: "${ANTHROPIC_API_KEY}" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ apiKey: "${ANTHROPIC_API_KEY}", newField: "hello" });
  });
  it("handles non-env-var strings (no restoration needed)", () => {
    const incoming = { name: "my-config" };
    const parsed = { name: "my-config" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ name: "my-config" });
  });
  it("handles arrays", () => {
    const incoming = ["sk-ant-api03-real-key", "literal"];
    const parsed = ["${ANTHROPIC_API_KEY}", "literal"];
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual(["${ANTHROPIC_API_KEY}", "literal"]);
  });
  it("handles null/undefined parsed gracefully", () => {
    const incoming = { apiKey: "sk-ant-api03-real-key" };
    expect(restoreEnvVarRefs(incoming, null, env)).toEqual(incoming);
    expect(restoreEnvVarRefs(incoming, undefined, env)).toEqual(incoming);
  });
  it("handles missing env var (cannot verify match)", () => {
    const envMissing = {};
    const incoming = { apiKey: "some-value" };
    const parsed = { apiKey: "${MISSING_VAR}" };
    const result = restoreEnvVarRefs(incoming, parsed, envMissing);
    expect(result).toEqual({ apiKey: "some-value" });
  });
  it("handles composite template strings like prefix-${VAR}-suffix", () => {
    const incoming = { url: "https://tok-12345.example.com" };
    const parsed = { url: "https://${MY_TOKEN}.example.com" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ url: "https://${MY_TOKEN}.example.com" });
  });
  it("handles type mismatches between incoming and parsed", () => {
    const incoming = { port: 8080 };
    const parsed = { port: "8080" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ port: 8080 });
  });
  it("does not restore when parsed value has no env var pattern", () => {
    const incoming = { apiKey: "sk-ant-api03-real-key" };
    const parsed = { apiKey: "sk-ant-api03-real-key" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ apiKey: "sk-ant-api03-real-key" });
  });
  it("does not incorrectly restore when env var value changed between read and write", () => {
    const mutatedEnv = { MY_VAR: "mutated-value" };
    const incoming = { key: "original-value" };
    const parsed = { key: "${MY_VAR}" };
    const result = restoreEnvVarRefs(incoming, parsed, mutatedEnv);
    expect(result).toEqual({ key: "original-value" });
  });
  it("correctly restores when env var value hasn't changed", () => {
    const stableEnv = { MY_VAR: "stable-value" };
    const incoming = { key: "stable-value" };
    const parsed = { key: "${MY_VAR}" };
    const result = restoreEnvVarRefs(incoming, parsed, stableEnv);
    expect(result).toEqual({ key: "${MY_VAR}" });
  });
  it("does not restore when env snapshot differs from live env (TOCTOU fix)", () => {
    const readTimeEnv = { MY_VAR: "old-value" };
    const incoming = { key: "new-value" };
    const parsed = { key: "${MY_VAR}" };
    const result = restoreEnvVarRefs(incoming, parsed, readTimeEnv);
    expect(result).toEqual({ key: "new-value" });
  });
  it("handles $${VAR} escape sequence (literal ${VAR} in output)", () => {
    const incoming = { note: "${ANTHROPIC_API_KEY}" };
    const parsed = { note: "$${ANTHROPIC_API_KEY}" };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({ note: "$${ANTHROPIC_API_KEY}" });
  });
  it("does not confuse $${VAR} escape with ${VAR} substitution", () => {
    const incoming = {
      literal: "${MY_TOKEN}",
      resolved: "tok-12345",
    };
    const parsed = {
      literal: "$${MY_TOKEN}",
      resolved: "${MY_TOKEN}",
    };
    const result = restoreEnvVarRefs(incoming, parsed, env);
    expect(result).toEqual({
      literal: "$${MY_TOKEN}",
      resolved: "${MY_TOKEN}",
    });
  });
});
