let resolveCommand = function (command) {
  if (process.platform !== "win32") {
    return command;
  }
  const lower = command.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return command;
  }
  const basename = lower.split(/[\\/]/).pop() ?? lower;
  if (basename === "npm" || basename === "pnpm" || basename === "yarn" || basename === "npx") {
    return `${command}.cmd`;
  }
  return command;
};
import { killProcessTree } from "../../kill-tree.js";
import { spawnWithFallback } from "../../spawn-utils.js";
import { toStringEnv } from "./env.js";
export async function createChildAdapter(params) {
  const resolvedArgv = [...params.argv];
  resolvedArgv[0] = resolveCommand(resolvedArgv[0] ?? "");
  const stdinMode = params.stdinMode ?? (params.input !== undefined ? "pipe-closed" : "inherit");
  const useDetached = process.platform !== "win32";
  const options = {
    cwd: params.cwd,
    env: params.env ? toStringEnv(params.env) : undefined,
    stdio: ["pipe", "pipe", "pipe"],
    detached: useDetached,
    windowsHide: true,
    windowsVerbatimArguments: params.windowsVerbatimArguments,
  };
  if (stdinMode === "inherit") {
    options.stdio = ["inherit", "pipe", "pipe"];
  } else {
    options.stdio = ["pipe", "pipe", "pipe"];
  }
  const spawned = await spawnWithFallback({
    argv: resolvedArgv,
    options,
    fallbacks: useDetached
      ? [
          {
            label: "no-detach",
            options: { detached: false },
          },
        ]
      : [],
  });
  const child = spawned.child;
  if (child.stdin) {
    if (params.input !== undefined) {
      child.stdin.write(params.input);
      child.stdin.end();
    } else if (stdinMode === "pipe-closed") {
      child.stdin.end();
    }
  }
  const stdin = child.stdin
    ? {
        destroyed: false,
        write: (data, cb) => {
          try {
            child.stdin.write(data, cb);
          } catch (err) {
            cb?.(err);
          }
        },
        end: () => {
          try {
            child.stdin.end();
          } catch {}
        },
        destroy: () => {
          try {
            child.stdin.destroy();
          } catch {}
        },
      }
    : undefined;
  const onStdout = (listener) => {
    child.stdout.on("data", (chunk) => {
      listener(chunk.toString());
    });
  };
  const onStderr = (listener) => {
    child.stderr.on("data", (chunk) => {
      listener(chunk.toString());
    });
  };
  const wait = async () =>
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({ code, signal });
      });
    });
  const kill = (signal) => {
    const pid = child.pid ?? undefined;
    if (signal === undefined || signal === "SIGKILL") {
      if (pid) {
        killProcessTree(pid);
      } else {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
      return;
    }
    try {
      child.kill(signal);
    } catch {}
  };
  const dispose = () => {
    child.removeAllListeners();
  };
  return {
    pid: child.pid ?? undefined,
    stdin,
    onStdout,
    onStderr,
    wait,
    kill,
    dispose,
  };
}
