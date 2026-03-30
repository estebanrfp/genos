let asRecord = function (value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  },
  readFirstStringValue = function (source, keys) {
    if (!source) {
      return;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return;
  },
  normalizeToolName = function (value) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return;
    }
    return normalized;
  },
  parseToolNameFromTitle = function (title) {
    if (!title) {
      return;
    }
    const head = title.split(":", 1)[0]?.trim();
    if (!head || !/^[a-zA-Z0-9._-]+$/.test(head)) {
      return;
    }
    return normalizeToolName(head);
  },
  resolveToolKindForPermission = function (params, toolName) {
    const toolCall = params.toolCall;
    const kindRaw = typeof toolCall?.kind === "string" ? toolCall.kind.trim().toLowerCase() : "";
    if (kindRaw) {
      return kindRaw;
    }
    const name =
      toolName ??
      parseToolNameFromTitle(typeof toolCall?.title === "string" ? toolCall.title : undefined);
    if (!name) {
      return;
    }
    const normalized = name.toLowerCase();
    const hasToken = (token) => {
      const re = new RegExp(`(?:^|[._-])${token}(?:$|[._-])`);
      return re.test(normalized);
    };
    if (normalized === "read" || hasToken("read")) {
      return "read";
    }
    if (normalized === "search" || hasToken("search") || hasToken("find")) {
      return "search";
    }
    if (normalized.includes("fetch") || normalized.includes("http")) {
      return "fetch";
    }
    if (
      normalized.includes("write") ||
      normalized.includes("edit") ||
      normalized.includes("patch")
    ) {
      return "edit";
    }
    if (normalized.includes("delete") || normalized.includes("remove")) {
      return "delete";
    }
    if (normalized.includes("move") || normalized.includes("rename")) {
      return "move";
    }
    if (normalized.includes("exec") || normalized.includes("run") || normalized.includes("bash")) {
      return "execute";
    }
    return "other";
  },
  resolveToolNameForPermission = function (params) {
    const toolCall = params.toolCall;
    const toolMeta = asRecord(toolCall?._meta);
    const rawInput = asRecord(toolCall?.rawInput);
    const fromMeta = readFirstStringValue(toolMeta, ["toolName", "tool_name", "name"]);
    const fromRawInput = readFirstStringValue(rawInput, ["tool", "toolName", "tool_name", "name"]);
    const fromTitle = parseToolNameFromTitle(toolCall?.title);
    return normalizeToolName(fromMeta ?? fromRawInput ?? fromTitle ?? "");
  },
  pickOption = function (options, kinds) {
    for (const kind of kinds) {
      const match = options.find((option) => option.kind === kind);
      if (match) {
        return match;
      }
    }
    return;
  },
  selectedPermission = function (optionId) {
    return { outcome: { outcome: "selected", optionId } };
  },
  cancelledPermission = function () {
    return { outcome: { outcome: "cancelled" } };
  },
  promptUserPermission = function (toolName, toolTitle) {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      console.error(`[permission denied] ${toolName ?? "unknown"}: non-interactive terminal`);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let settled = false;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      const finish = (approved) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        rl.close();
        resolve(approved);
      };
      const timeout = setTimeout(() => {
        console.error(`\n[permission timeout] denied: ${toolName ?? "unknown"}`);
        finish(false);
      }, 30000);
      const label = toolTitle
        ? toolName
          ? `${toolTitle} (${toolName})`
          : toolTitle
        : (toolName ?? "unknown tool");
      rl.question(`\n[permission] Allow "${label}"? (y/N) `, (answer) => {
        const approved = answer.trim().toLowerCase() === "y";
        console.error(`[permission ${approved ? "approved" : "denied"}] ${toolName ?? "unknown"}`);
        finish(approved);
      });
    });
  },
  toArgs = function (value) {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  },
  buildServerArgs = function (opts) {
    const args = ["acp", ...toArgs(opts.serverArgs)];
    if (opts.serverVerbose && !args.includes("--verbose") && !args.includes("-v")) {
      args.push("--verbose");
    }
    return args;
  },
  resolveSelfEntryPath = function () {
    try {
      const here = fileURLToPath(import.meta.url);
      const candidate = path.resolve(path.dirname(here), "..", "entry.js");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
    const argv1 = process.argv[1]?.trim();
    if (argv1) {
      return path.isAbsolute(argv1) ? argv1 : path.resolve(process.cwd(), argv1);
    }
    return null;
  },
  printSessionUpdate = function (notification) {
    const update = notification.update;
    if (!("sessionUpdate" in update)) {
      return;
    }
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content?.type === "text") {
          process.stdout.write(update.content.text);
        }
        return;
      }
      case "tool_call": {
        console.log(`\n[tool] ${update.title} (${update.status})`);
        return;
      }
      case "tool_call_update": {
        if (update.status) {
          console.log(`[tool update] ${update.toolCallId}: ${update.status}`);
        }
        return;
      }
      case "available_commands_update": {
        const names = update.availableCommands?.map((cmd) => `/${cmd.name}`).join(" ");
        if (names) {
          console.log(`\n[commands] ${names}`);
        }
        return;
      }
      default:
        return;
    }
  };
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
import { ensureGenosOSCliOnPath } from "../infra/path-env.js";
import { DANGEROUS_ACP_TOOLS } from "../security/dangerous-tools.js";
const SAFE_AUTO_APPROVE_KINDS = new Set(["read", "search"]);
export async function resolvePermissionRequest(params, deps = {}) {
  const log = deps.log ?? ((line) => console.error(line));
  const prompt = deps.prompt ?? promptUserPermission;
  const options = params.options ?? [];
  const toolTitle = params.toolCall?.title ?? "tool";
  const toolName = resolveToolNameForPermission(params);
  const toolKind = resolveToolKindForPermission(params, toolName);
  if (options.length === 0) {
    log(`[permission cancelled] ${toolName ?? "unknown"}: no options available`);
    return cancelledPermission();
  }
  const allowOption = pickOption(options, ["allow_once", "allow_always"]);
  const rejectOption = pickOption(options, ["reject_once", "reject_always"]);
  const isSafeKind = Boolean(toolKind && SAFE_AUTO_APPROVE_KINDS.has(toolKind));
  const promptRequired = !toolName || !isSafeKind || DANGEROUS_ACP_TOOLS.has(toolName);
  if (!promptRequired) {
    const option = allowOption ?? options[0];
    if (!option) {
      log(`[permission cancelled] ${toolName}: no selectable options`);
      return cancelledPermission();
    }
    log(`[permission auto-approved] ${toolName} (${toolKind ?? "unknown"})`);
    return selectedPermission(option.optionId);
  }
  log(
    `\n[permission requested] ${toolTitle}${toolName ? ` (${toolName})` : ""}${toolKind ? ` [${toolKind}]` : ""}`,
  );
  const approved = await prompt(toolName, toolTitle);
  if (approved && allowOption) {
    return selectedPermission(allowOption.optionId);
  }
  if (!approved && rejectOption) {
    return selectedPermission(rejectOption.optionId);
  }
  log(
    `[permission cancelled] ${toolName ?? "unknown"}: missing ${approved ? "allow" : "reject"} option`,
  );
  return cancelledPermission();
}
export async function createAcpClient(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const verbose = Boolean(opts.verbose);
  const log = verbose ? (msg) => console.error(`[acp-client] ${msg}`) : () => {};
  ensureGenosOSCliOnPath();
  const serverArgs = buildServerArgs(opts);
  const entryPath = resolveSelfEntryPath();
  const serverCommand = opts.serverCommand ?? (entryPath ? process.execPath : "genosos");
  const effectiveArgs = opts.serverCommand || !entryPath ? serverArgs : [entryPath, ...serverArgs];
  log(`spawning: ${serverCommand} ${effectiveArgs.join(" ")}`);
  const agent = spawn(serverCommand, effectiveArgs, {
    stdio: ["pipe", "pipe", "inherit"],
    cwd,
  });
  if (!agent.stdin || !agent.stdout) {
    throw new Error("Failed to create ACP stdio pipes");
  }
  const input = Writable.toWeb(agent.stdin);
  const output = Readable.toWeb(agent.stdout);
  const stream = ndJsonStream(input, output);
  const client = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params) => {
        printSessionUpdate(params);
      },
      requestPermission: async (params) => {
        return resolvePermissionRequest(params);
      },
    }),
    stream,
  );
  log("initializing");
  await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
    clientInfo: { name: "genosos-acp-client", version: "1.0.0" },
  });
  log("creating session");
  const session = await client.newSession({
    cwd,
    mcpServers: [],
  });
  return {
    client,
    agent,
    sessionId: session.sessionId,
  };
}
export async function runAcpClientInteractive(opts = {}) {
  const { client, agent, sessionId } = await createAcpClient(opts);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  console.log("GenosOS ACP client");
  console.log(`Session: ${sessionId}`);
  console.log('Type a prompt, or "exit" to quit.\n');
  const prompt = () => {
    rl.question("> ", async (input) => {
      const text = input.trim();
      if (!text) {
        prompt();
        return;
      }
      if (text === "exit" || text === "quit") {
        agent.kill();
        rl.close();
        process.exit(0);
      }
      try {
        const response = await client.prompt({
          sessionId,
          prompt: [{ type: "text", text }],
        });
        console.log(`\n[${response.stopReason}]\n`);
      } catch (err) {
        console.error(`\n[error] ${String(err)}\n`);
      }
      prompt();
    });
  };
  prompt();
  agent.on("exit", (code) => {
    console.log(`\nAgent exited with code ${code ?? 0}`);
    rl.close();
    process.exit(code ?? 0);
  });
}
