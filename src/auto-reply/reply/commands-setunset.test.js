let createActionMappers = function () {
    return {
      onSet: (path, value) => ({ action: "set", path, value }),
      onUnset: (path) => ({ action: "unset", path }),
      onError: (message) => ({ action: "error", message }),
    };
  },
  createSlashParams = function (params) {
    return {
      raw: params.raw,
      slash: "/config",
      invalidMessage: "Invalid /config syntax.",
      usageMessage: "Usage: /config show|set|unset",
      onKnownAction:
        params.onKnownAction ??
        (() => {
          return;
        }),
      ...createActionMappers(),
    };
  };
import { describe, expect, it } from "vitest";
import { parseStandardSetUnsetSlashCommand } from "./commands-setunset-standard.js";
import {
  parseSetUnsetCommand,
  parseSetUnsetCommandAction,
  parseSlashCommandWithSetUnset,
} from "./commands-setunset.js";
describe("parseSetUnsetCommand", () => {
  it("parses unset values", () => {
    expect(
      parseSetUnsetCommand({
        slash: "/config",
        action: "unset",
        args: "foo.bar",
      }),
    ).toEqual({ kind: "unset", path: "foo.bar" });
  });
  it("parses set values", () => {
    expect(
      parseSetUnsetCommand({
        slash: "/config",
        action: "set",
        args: 'foo.bar={"x":1}',
      }),
    ).toEqual({ kind: "set", path: "foo.bar", value: { x: 1 } });
  });
});
describe("parseSetUnsetCommandAction", () => {
  it("returns null for non set/unset actions", () => {
    const mappers = createActionMappers();
    const result = parseSetUnsetCommandAction({
      slash: "/config",
      action: "show",
      args: "",
      ...mappers,
    });
    expect(result).toBeNull();
  });
  it("maps parse errors through onError", () => {
    const mappers = createActionMappers();
    const result = parseSetUnsetCommandAction({
      slash: "/config",
      action: "set",
      args: "",
      ...mappers,
    });
    expect(result).toEqual({ action: "error", message: "Usage: /config set path=value" });
  });
});
describe("parseSlashCommandWithSetUnset", () => {
  it("returns null when the input does not match the slash command", () => {
    const result = parseSlashCommandWithSetUnset(createSlashParams({ raw: "/debug show" }));
    expect(result).toBeNull();
  });
  it("prefers set/unset mapping and falls back to known actions", () => {
    const setResult = parseSlashCommandWithSetUnset(
      createSlashParams({
        raw: '/config set a.b={"ok":true}',
      }),
    );
    expect(setResult).toEqual({ action: "set", path: "a.b", value: { ok: true } });
    const showResult = parseSlashCommandWithSetUnset(
      createSlashParams({
        raw: "/config show",
        onKnownAction: (action) =>
          action === "show" ? { action: "unset", path: "dummy" } : undefined,
      }),
    );
    expect(showResult).toEqual({ action: "unset", path: "dummy" });
  });
  it("returns onError for unknown actions", () => {
    const unknownAction = parseSlashCommandWithSetUnset(
      createSlashParams({
        raw: "/config whoami",
      }),
    );
    expect(unknownAction).toEqual({ action: "error", message: "Usage: /config show|set|unset" });
  });
});
describe("parseStandardSetUnsetSlashCommand", () => {
  it("uses default set/unset/error mappings", () => {
    const result = parseStandardSetUnsetSlashCommand({
      raw: '/config set a.b={"ok":true}',
      slash: "/config",
      invalidMessage: "Invalid /config syntax.",
      usageMessage: "Usage: /config show|set|unset",
      onKnownAction: () => {
        return;
      },
    });
    expect(result).toEqual({ action: "set", path: "a.b", value: { ok: true } });
  });
  it("supports caller-provided mappings", () => {
    const result = parseStandardSetUnsetSlashCommand({
      raw: "/config unset a.b",
      slash: "/config",
      invalidMessage: "Invalid /config syntax.",
      usageMessage: "Usage: /config show|set|unset",
      onKnownAction: () => {
        return;
      },
      onUnset: (path) => ({ action: "unset", path: `wrapped:${path}` }),
    });
    expect(result).toEqual({ action: "unset", path: "wrapped:a.b" });
  });
});
