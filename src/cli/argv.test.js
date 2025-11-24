import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";
describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "genosos", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "genosos", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "genosos", "status"])).toBe(false);
  });
  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "genosos", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "genosos", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "genosos", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });
  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "genosos", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "genosos"])).toBeNull();
  });
  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "genosos", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "genosos", "--", "--json"], "--json")).toBe(false);
  });
  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "genosos", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "genosos", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "genosos", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "genosos", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "genosos", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });
  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "genosos", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "genosos", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "genosos", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });
  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "genosos", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "genosos", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "genosos", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "genosos", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });
  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["node", "genosos", "status"],
    });
    expect(nodeArgv).toEqual(["node", "genosos", "status"]);
    const versionedNodeArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["node-22", "genosos", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "genosos", "status"]);
    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["node-22.2.0.exe", "genosos", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "genosos", "status"]);
    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["node-22.2", "genosos", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "genosos", "status"]);
    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["node-22.2.exe", "genosos", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "genosos", "status"]);
    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["/usr/bin/node-22.2.0", "genosos", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "genosos", "status"]);
    const nodejsArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["nodejs", "genosos", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "genosos", "status"]);
    const nonVersionedNodeArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["node-dev", "genosos", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "genosos", "node-dev", "genosos", "status"]);
    const directArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["genosos", "status"],
    });
    expect(directArgv).toEqual(["node", "genosos", "status"]);
    const bunArgv = buildParseArgv({
      programName: "genosos",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });
  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "genosos",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "genosos", "status"]);
  });
  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "genosos", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "config", "get", "update"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "config", "unset", "update"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "models", "list"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "models", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "genosos", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "genosos", "message", "send"])).toBe(true);
  });
  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["config", "get"])).toBe(false);
    expect(shouldMigrateStateFromPath(["models", "status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
