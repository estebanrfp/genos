let removeCommand = function (program, command) {
    const commands = program.commands;
    const index = commands.indexOf(command);
    if (index >= 0) {
      commands.splice(index, 1);
    }
  },
  registerLazyCommand = function (program, entry) {
    const placeholder = program.command(entry.name).description(entry.description);
    placeholder.allowUnknownOption(true);
    placeholder.allowExcessArguments(true);
    placeholder.action(async (...actionArgs) => {
      removeCommand(program, placeholder);
      await entry.register(program);
      await reparseProgramFromActionArgs(program, actionArgs);
    });
  };
import { isTruthyEnvValue } from "../../infra/env.js";
import { getPrimaryCommand, hasHelpOrVersion } from "../argv.js";
import { reparseProgramFromActionArgs } from "./action-reparse.js";
const shouldRegisterPrimaryOnly = (argv) => {
  if (isTruthyEnvValue(process.env.GENOS_DISABLE_LAZY_SUBCOMMANDS)) {
    return false;
  }
  if (hasHelpOrVersion(argv)) {
    return false;
  }
  return true;
};
const shouldEagerRegisterSubcommands = (_argv) => {
  return isTruthyEnvValue(process.env.GENOS_DISABLE_LAZY_SUBCOMMANDS);
};
const loadConfig = async () => {
  const mod = await import("../../config/config.js");
  return mod.loadConfig();
};
const entries = [
  {
    name: "acp",
    description: "Agent Control Protocol tools",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../acp-cli.js");
      mod.registerAcpCli(program);
    },
  },
  {
    name: "gateway",
    description: "Run, inspect, and query the WebSocket Gateway",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../gateway-cli.js");
      mod.registerGatewayCli(program);
    },
  },
  {
    name: "daemon",
    description: "Gateway service (legacy alias)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../daemon-cli.js");
      mod.registerDaemonCli(program);
    },
  },
  {
    name: "logs",
    description: "Tail gateway file logs via RPC",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../logs-cli.js");
      mod.registerLogsCli(program);
    },
  },
  {
    name: "system",
    description: "System events, heartbeat, and presence",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../system-cli.js");
      mod.registerSystemCli(program);
    },
  },
  {
    name: "models",
    description: "Discover, scan, and configure models",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../models-cli.js");
      mod.registerModelsCli(program);
    },
  },
  {
    name: "approvals",
    description: "Manage exec approvals (gateway or node host)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../exec-approvals-cli.js");
      mod.registerExecApprovalsCli(program);
    },
  },
  {
    name: "nodes",
    description: "Manage gateway-owned node pairing and node commands",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../nodes-cli.js");
      mod.registerNodesCli(program);
    },
  },
  {
    name: "devices",
    description: "Device pairing + token management",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../devices-cli.js");
      mod.registerDevicesCli(program);
    },
  },
  {
    name: "node",
    description: "Run and manage the headless node host service",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../node-cli.js");
      mod.registerNodeCli(program);
    },
  },
  {
    name: "cron",
    description: "Manage cron jobs via the Gateway scheduler",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../cron-cli.js");
      mod.registerCronCli(program);
    },
  },
  {
    name: "dns",
    description: "DNS helpers for wide-area discovery (Tailscale + CoreDNS)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../dns-cli.js");
      mod.registerDnsCli(program);
    },
  },
  {
    name: "docs",
    description: "Search the live GenosOS docs",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../docs-cli.js");
      mod.registerDocsCli(program);
    },
  },
  {
    name: "hooks",
    description: "Manage internal agent hooks",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../hooks-cli.js");
      mod.registerHooksCli(program);
    },
  },
  {
    name: "webhooks",
    description: "Webhook helpers and integrations",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../webhooks-cli.js");
      mod.registerWebhooksCli(program);
    },
  },
  {
    name: "qr",
    description: "Generate iOS pairing QR/setup code",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../qr-cli.js");
      mod.registerQrCli(program);
    },
  },
  {
    name: "clawbot",
    description: "Legacy clawbot command aliases",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../clawbot-cli.js");
      mod.registerClawbotCli(program);
    },
  },
  {
    name: "pairing",
    description: "Secure DM pairing (approve inbound requests)",
    hasSubcommands: true,
    register: async (program) => {
      const { registerPluginCliCommands } = await import("../../plugins/cli.js");
      registerPluginCliCommands(program, await loadConfig());
      const mod = await import("../pairing-cli.js");
      mod.registerPairingCli(program);
    },
  },
  {
    name: "plugins",
    description: "Manage GenosOS plugins and extensions",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../plugins-cli.js");
      mod.registerPluginsCli(program);
      const { registerPluginCliCommands } = await import("../../plugins/cli.js");
      registerPluginCliCommands(program, await loadConfig());
    },
  },
  {
    name: "channels",
    description: "Manage connected chat channels (Telegram, Discord, etc.)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../channels-cli.js");
      mod.registerChannelsCli(program);
    },
  },
  {
    name: "directory",
    description: "Lookup contact and group IDs (self, peers, groups) for supported chat channels",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../directory-cli.js");
      mod.registerDirectoryCli(program);
    },
  },
  {
    name: "security",
    description: "Security tools and local config audits",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../security-cli.js");
      mod.registerSecurityCli(program);
    },
  },
  {
    name: "vault",
    description: "Manage the encrypted secret vault",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../vault-cli.js");
      mod.registerVaultCli(program);
    },
  },
  {
    name: "audit",
    description: "Verify and inspect the tamper-evident audit log",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../audit-cli.js");
      mod.registerAuditCli(program);
    },
  },
  {
    name: "skills",
    description: "List and inspect available skills",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../skills-cli.js");
      mod.registerSkillsCli(program);
    },
  },
  {
    name: "update",
    description: "Update GenosOS and inspect update channel status",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../update-cli.js");
      mod.registerUpdateCli(program);
    },
  },
  {
    name: "completion",
    description: "Generate shell completion script",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../completion-cli.js");
      mod.registerCompletionCli(program);
    },
  },
];
export function getSubCliEntries() {
  return entries;
}
export function getSubCliCommandsWithSubcommands() {
  return entries.filter((entry) => entry.hasSubcommands).map((entry) => entry.name);
}
export async function registerSubCliByName(program, name) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    return false;
  }
  const existing = program.commands.find((cmd) => cmd.name() === entry.name);
  if (existing) {
    removeCommand(program, existing);
  }
  await entry.register(program);
  return true;
}
export function registerSubCliCommands(program, argv = process.argv) {
  if (shouldEagerRegisterSubcommands(argv)) {
    for (const entry of entries) {
      entry.register(program);
    }
    return;
  }
  const primary = getPrimaryCommand(argv);
  if (primary && shouldRegisterPrimaryOnly(argv)) {
    const entry = entries.find((candidate) => candidate.name === primary);
    if (entry) {
      registerLazyCommand(program, entry);
      return;
    }
  }
  for (const candidate of entries) {
    registerLazyCommand(program, candidate);
  }
}
