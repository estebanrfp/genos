let resolveTaskName = function (env) {
    const override = env.GENOS_WINDOWS_TASK_NAME?.trim();
    if (override) {
      return override;
    }
    return resolveGatewayWindowsTaskName(env.GENOS_PROFILE);
  },
  quoteCmdArg = function (value) {
    if (!/[ \t"]/g.test(value)) {
      return value;
    }
    return `"${value.replace(/"/g, '\\"')}"`;
  },
  resolveTaskUser = function (env) {
    const username = env.USERNAME || env.USER || env.LOGNAME;
    if (!username) {
      return null;
    }
    if (username.includes("\\")) {
      return username;
    }
    const domain = env.USERDOMAIN;
    if (domain) {
      return `${domain}\\${username}`;
    }
    return username;
  },
  parseCommandLine = function (value) {
    return splitArgsPreservingQuotes(value, { escapeMode: "backslash-quote-only" });
  },
  buildTaskScript = function ({ description, programArguments, workingDirectory, environment }) {
    const lines = ["@echo off"];
    if (description?.trim()) {
      lines.push(`rem ${description.trim()}`);
    }
    if (workingDirectory) {
      lines.push(`cd /d ${quoteCmdArg(workingDirectory)}`);
    }
    if (environment) {
      for (const [key, value] of Object.entries(environment)) {
        if (!value) {
          continue;
        }
        lines.push(`set ${key}=${value}`);
      }
    }
    const command = programArguments.map(quoteCmdArg).join(" ");
    lines.push(command);
    return `${lines.join("\r\n")}\r\n`;
  },
  isTaskNotRunning = function (res) {
    const detail = (res.stderr || res.stdout).toLowerCase();
    return detail.includes("not running");
  };
import fs from "node:fs/promises";
import path from "node:path";
import { splitArgsPreservingQuotes } from "./arg-split.js";
import { resolveGatewayServiceDescription, resolveGatewayWindowsTaskName } from "./constants.js";
import { formatLine, writeFormattedLines } from "./output.js";
import { resolveGatewayStateDir } from "./paths.js";
import { parseKeyValueOutput } from "./runtime-parse.js";
import { execSchtasks } from "./schtasks-exec.js";
export function resolveTaskScriptPath(env) {
  const override = env.GENOS_TASK_SCRIPT?.trim();
  if (override) {
    return override;
  }
  const scriptName = env.GENOS_TASK_SCRIPT_NAME?.trim() || "gateway.cmd";
  const stateDir = resolveGatewayStateDir(env);
  return path.join(stateDir, scriptName);
}
export async function readScheduledTaskCommand(env) {
  const scriptPath = resolveTaskScriptPath(env);
  try {
    const content = await fs.readFile(scriptPath, "utf8");
    let workingDirectory = "";
    let commandLine = "";
    const environment = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line.startsWith("@echo")) {
        continue;
      }
      if (line.toLowerCase().startsWith("rem ")) {
        continue;
      }
      if (line.toLowerCase().startsWith("set ")) {
        const assignment = line.slice(4).trim();
        const index = assignment.indexOf("=");
        if (index > 0) {
          const key = assignment.slice(0, index).trim();
          const value = assignment.slice(index + 1).trim();
          if (key) {
            environment[key] = value;
          }
        }
        continue;
      }
      if (line.toLowerCase().startsWith("cd /d ")) {
        workingDirectory = line.slice("cd /d ".length).trim().replace(/^"|"$/g, "");
        continue;
      }
      commandLine = line;
      break;
    }
    if (!commandLine) {
      return null;
    }
    return {
      programArguments: parseCommandLine(commandLine),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
    };
  } catch {
    return null;
  }
}
export function parseSchtasksQuery(output) {
  const entries = parseKeyValueOutput(output, ":");
  const info = {};
  const status = entries.status;
  if (status) {
    info.status = status;
  }
  const lastRunTime = entries["last run time"];
  if (lastRunTime) {
    info.lastRunTime = lastRunTime;
  }
  const lastRunResult = entries["last run result"];
  if (lastRunResult) {
    info.lastRunResult = lastRunResult;
  }
  return info;
}
async function assertSchtasksAvailable() {
  const res = await execSchtasks(["/Query"]);
  if (res.code === 0) {
    return;
  }
  const detail = res.stderr || res.stdout;
  throw new Error(`schtasks unavailable: ${detail || "unknown error"}`.trim());
}
export async function installScheduledTask({
  env,
  stdout,
  programArguments,
  workingDirectory,
  environment,
  description,
}) {
  await assertSchtasksAvailable();
  const scriptPath = resolveTaskScriptPath(env);
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  const taskDescription = resolveGatewayServiceDescription({ env, environment, description });
  const script = buildTaskScript({
    description: taskDescription,
    programArguments,
    workingDirectory,
    environment,
  });
  await fs.writeFile(scriptPath, script, "utf8");
  const taskName = resolveTaskName(env);
  const quotedScript = quoteCmdArg(scriptPath);
  const baseArgs = [
    "/Create",
    "/F",
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/TN",
    taskName,
    "/TR",
    quotedScript,
  ];
  const taskUser = resolveTaskUser(env);
  let create = await execSchtasks(
    taskUser ? [...baseArgs, "/RU", taskUser, "/NP", "/IT"] : baseArgs,
  );
  if (create.code !== 0 && taskUser) {
    create = await execSchtasks(baseArgs);
  }
  if (create.code !== 0) {
    const detail = create.stderr || create.stdout;
    const hint = /access is denied/i.test(detail)
      ? " Run PowerShell as Administrator or rerun without installing the daemon."
      : "";
    throw new Error(`schtasks create failed: ${detail}${hint}`.trim());
  }
  await execSchtasks(["/Run", "/TN", taskName]);
  writeFormattedLines(
    stdout,
    [
      { label: "Installed Scheduled Task", value: taskName },
      { label: "Task script", value: scriptPath },
    ],
    { leadingBlankLine: true },
  );
  return { scriptPath };
}
export async function uninstallScheduledTask({ env, stdout }) {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(env);
  await execSchtasks(["/Delete", "/F", "/TN", taskName]);
  const scriptPath = resolveTaskScriptPath(env);
  try {
    await fs.unlink(scriptPath);
    stdout.write(`${formatLine("Removed task script", scriptPath)}\n`);
  } catch {
    stdout.write(`Task script not found at ${scriptPath}\n`);
  }
}
export async function stopScheduledTask({ stdout, env }) {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(env ?? process.env);
  const res = await execSchtasks(["/End", "/TN", taskName]);
  if (res.code !== 0 && !isTaskNotRunning(res)) {
    throw new Error(`schtasks end failed: ${res.stderr || res.stdout}`.trim());
  }
  stdout.write(`${formatLine("Stopped Scheduled Task", taskName)}\n`);
}
export async function restartScheduledTask({ stdout, env }) {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(env ?? process.env);
  await execSchtasks(["/End", "/TN", taskName]);
  const res = await execSchtasks(["/Run", "/TN", taskName]);
  if (res.code !== 0) {
    throw new Error(`schtasks run failed: ${res.stderr || res.stdout}`.trim());
  }
  stdout.write(`${formatLine("Restarted Scheduled Task", taskName)}\n`);
}
export async function isScheduledTaskInstalled(args) {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(args.env ?? process.env);
  const res = await execSchtasks(["/Query", "/TN", taskName]);
  return res.code === 0;
}
export async function readScheduledTaskRuntime(env = process.env) {
  try {
    await assertSchtasksAvailable();
  } catch (err) {
    return {
      status: "unknown",
      detail: String(err),
    };
  }
  const taskName = resolveTaskName(env);
  const res = await execSchtasks(["/Query", "/TN", taskName, "/V", "/FO", "LIST"]);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim();
    const missing = detail.toLowerCase().includes("cannot find the file");
    return {
      status: missing ? "stopped" : "unknown",
      detail: detail || undefined,
      missingUnit: missing,
    };
  }
  const parsed = parseSchtasksQuery(res.stdout || "");
  const statusRaw = parsed.status?.toLowerCase();
  const status = statusRaw === "running" ? "running" : statusRaw ? "stopped" : "unknown";
  return {
    status,
    state: parsed.status,
    lastRunTime: parsed.lastRunTime,
    lastRunResult: parsed.lastRunResult,
  };
}
