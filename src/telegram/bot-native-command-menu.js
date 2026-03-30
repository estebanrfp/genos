import {
  normalizeTelegramCommandName,
  TELEGRAM_COMMAND_NAME_PATTERN,
} from "../config/telegram-custom-commands.js";
import { withTelegramApiErrorLogging } from "./api-logging.js";
export const TELEGRAM_MAX_COMMANDS = 100;
export function buildPluginTelegramMenuCommands(params) {
  const { specs, existingCommands } = params;
  const commands = [];
  const issues = [];
  const pluginCommandNames = new Set();
  for (const spec of specs) {
    const normalized = normalizeTelegramCommandName(spec.name);
    if (!normalized || !TELEGRAM_COMMAND_NAME_PATTERN.test(normalized)) {
      issues.push(
        `Plugin command "/${spec.name}" is invalid for Telegram (use a-z, 0-9, underscore; max 32 chars).`,
      );
      continue;
    }
    const description = spec.description.trim();
    if (!description) {
      issues.push(`Plugin command "/${normalized}" is missing a description.`);
      continue;
    }
    if (existingCommands.has(normalized)) {
      if (pluginCommandNames.has(normalized)) {
        issues.push(`Plugin command "/${normalized}" is duplicated.`);
      } else {
        issues.push(`Plugin command "/${normalized}" conflicts with an existing Telegram command.`);
      }
      continue;
    }
    pluginCommandNames.add(normalized);
    existingCommands.add(normalized);
    commands.push({ command: normalized, description });
  }
  return { commands, issues };
}
export function buildCappedTelegramMenuCommands(params) {
  const { allCommands } = params;
  const maxCommands = params.maxCommands ?? TELEGRAM_MAX_COMMANDS;
  const totalCommands = allCommands.length;
  const overflowCount = Math.max(0, totalCommands - maxCommands);
  const commandsToRegister = allCommands.slice(0, maxCommands);
  return { commandsToRegister, totalCommands, maxCommands, overflowCount };
}
export function syncTelegramMenuCommands(params) {
  const { bot, runtime, commandsToRegister } = params;
  const sync = async () => {
    if (typeof bot.api.deleteMyCommands === "function") {
      await withTelegramApiErrorLogging({
        operation: "deleteMyCommands",
        runtime,
        fn: () => bot.api.deleteMyCommands(),
      }).catch(() => {});
    }
    if (commandsToRegister.length === 0) {
      return;
    }
    await withTelegramApiErrorLogging({
      operation: "setMyCommands",
      runtime,
      fn: () => bot.api.setMyCommands(commandsToRegister),
    });
  };
  sync().catch((err) => {
    runtime.error?.(`Telegram command sync failed: ${String(err)}`);
  });
}
