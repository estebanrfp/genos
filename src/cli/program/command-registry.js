let collectCoreCliCommandNames = function (predicate) {
    const seen = new Set();
    const names = [];
    for (const entry of coreEntries) {
      for (const command of entry.commands) {
        if (predicate && !predicate(command)) {
          continue;
        }
        if (seen.has(command.name)) {
          continue;
        }
        seen.add(command.name);
        names.push(command.name);
      }
    }
    return names;
  },
  removeCommand = function (program, command) {
    const commands = program.commands;
    const index = commands.indexOf(command);
    if (index >= 0) {
      commands.splice(index, 1);
    }
  },
  removeEntryCommands = function (program, entry) {
    for (const cmd of entry.commands) {
      const existing = program.commands.find((c) => c.name() === cmd.name);
      if (existing) {
        removeCommand(program, existing);
      }
    }
  },
  registerLazyCoreCommand = function (program, ctx, entry, command) {
    const placeholder = program.command(command.name).description(command.description);
    placeholder.allowUnknownOption(true);
    placeholder.allowExcessArguments(true);
    placeholder.action(async (...actionArgs) => {
      removeEntryCommands(program, entry);
      await entry.register({ program, ctx, argv: process.argv });
      await reparseProgramFromActionArgs(program, actionArgs);
    });
  };
import { getPrimaryCommand, hasHelpOrVersion } from "../argv.js";
import { reparseProgramFromActionArgs } from "./action-reparse.js";
import { registerSubCliCommands } from "./register.subclis.js";
const shouldRegisterCorePrimaryOnly = (argv) => {
  if (hasHelpOrVersion(argv)) {
    return false;
  }
  return true;
};
const coreEntries = [
  {
    commands: [
      {
        name: "setup",
        description: "Initialize local config and agent workspace",
        hasSubcommands: false,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("./register.setup.js");
      mod.registerSetupCommand(program);
    },
  },
  {
    commands: [
      {
        name: "onboard",
        description: "Interactive onboarding wizard for gateway, workspace, and skills",
        hasSubcommands: false,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("./register.onboard.js");
      mod.registerOnboardCommand(program);
    },
  },
  {
    commands: [
      {
        name: "configure",
        description:
          "Interactive setup wizard for credentials, channels, gateway, and agent defaults",
        hasSubcommands: false,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("./register.configure.js");
      mod.registerConfigureCommand(program);
    },
  },
  {
    commands: [
      {
        name: "config",
        description:
          "Non-interactive config helpers (get/set/unset). Default: starts setup wizard.",
        hasSubcommands: true,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("../config-cli.js");
      mod.registerConfigCli(program);
    },
  },
  {
    commands: [
      {
        name: "doctor",
        description: "Health checks + quick fixes for the gateway and channels",
        hasSubcommands: false,
      },
      {
        name: "dashboard",
        description: "Open the Control UI with your current token",
        hasSubcommands: false,
      },
      {
        name: "reset",
        description: "Reset local config/state (keeps the CLI installed)",
        hasSubcommands: false,
      },
      {
        name: "uninstall",
        description: "Uninstall the gateway service + local data (CLI remains)",
        hasSubcommands: false,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("./register.maintenance.js");
      mod.registerMaintenanceCommands(program);
    },
  },
  {
    commands: [
      {
        name: "message",
        description: "Send, read, and manage messages",
        hasSubcommands: true,
      },
    ],
    register: async ({ program, ctx }) => {
      const mod = await import("./register.message.js");
      mod.registerMessageCommands(program, ctx);
    },
  },
  {
    commands: [
      {
        name: "memory",
        description: "Search and reindex memory files",
        hasSubcommands: true,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("../memory-cli.js");
      mod.registerMemoryCli(program);
    },
  },
  {
    commands: [
      {
        name: "agent",
        description: "Run one agent turn via the Gateway",
        hasSubcommands: false,
      },
      {
        name: "agents",
        description: "Manage isolated agents (workspaces, auth, routing)",
        hasSubcommands: true,
      },
    ],
    register: async ({ program, ctx }) => {
      const mod = await import("./register.agent.js");
      mod.registerAgentCommands(program, {
        agentChannelOptions: ctx.agentChannelOptions,
      });
    },
  },
  {
    commands: [
      {
        name: "status",
        description: "Show channel health and recent session recipients",
        hasSubcommands: false,
      },
      {
        name: "health",
        description: "Fetch health from the running gateway",
        hasSubcommands: false,
      },
      {
        name: "sessions",
        description: "List stored conversation sessions",
        hasSubcommands: false,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("./register.status-health-sessions.js");
      mod.registerStatusHealthSessionsCommands(program);
    },
  },
  {
    commands: [
      {
        name: "browser",
        description: "Manage GenosOS's dedicated browser (Chrome/Chromium)",
        hasSubcommands: true,
      },
    ],
    register: async ({ program }) => {
      const mod = await import("../browser-cli.js");
      mod.registerBrowserCli(program);
    },
  },
];
export function getCoreCliCommandNames() {
  return collectCoreCliCommandNames();
}
export function getCoreCliCommandsWithSubcommands() {
  return collectCoreCliCommandNames((command) => command.hasSubcommands);
}
export async function registerCoreCliByName(program, ctx, name, argv = process.argv) {
  const entry = coreEntries.find((candidate) =>
    candidate.commands.some((cmd) => cmd.name === name),
  );
  if (!entry) {
    return false;
  }
  removeEntryCommands(program, entry);
  await entry.register({ program, ctx, argv });
  return true;
}
export function registerCoreCliCommands(program, ctx, argv) {
  const primary = getPrimaryCommand(argv);
  if (primary && shouldRegisterCorePrimaryOnly(argv)) {
    const entry = coreEntries.find((candidate) =>
      candidate.commands.some((cmd) => cmd.name === primary),
    );
    if (entry) {
      const cmd = entry.commands.find((c) => c.name === primary);
      if (cmd) {
        registerLazyCoreCommand(program, ctx, entry, cmd);
      }
      return;
    }
  }
  for (const entry of coreEntries) {
    for (const cmd of entry.commands) {
      registerLazyCoreCommand(program, ctx, entry, cmd);
    }
  }
}
export function registerProgramCommands(program, ctx, argv = process.argv) {
  registerCoreCliCommands(program, ctx, argv);
  registerSubCliCommands(program, argv);
}
