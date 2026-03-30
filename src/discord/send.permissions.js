let addPermissionBits = function (base, add) {
    if (!add) {
      return base;
    }
    return base | BigInt(add);
  },
  removePermissionBits = function (base, deny) {
    if (!deny) {
      return base;
    }
    return base & ~BigInt(deny);
  },
  bitfieldToPermissions = function (bitfield) {
    return PERMISSION_ENTRIES.filter(([, value]) => (bitfield & value) === value)
      .map(([name]) => name)
      .toSorted();
  },
  hasAdministrator = function (bitfield) {
    return (bitfield & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT;
  };
import { ChannelType, PermissionFlagsBits, Routes } from "discord-api-types/v10";
import { resolveDiscordRest } from "./client.js";
const PERMISSION_ENTRIES = Object.entries(PermissionFlagsBits).filter(
  ([, value]) => typeof value === "bigint",
);
const ALL_PERMISSIONS = PERMISSION_ENTRIES.reduce((acc, [, value]) => acc | value, 0n);
const ADMINISTRATOR_BIT = PermissionFlagsBits.Administrator;
export function isThreadChannelType(channelType) {
  return (
    channelType === ChannelType.GuildNewsThread ||
    channelType === ChannelType.GuildPublicThread ||
    channelType === ChannelType.GuildPrivateThread
  );
}
async function fetchBotUserId(rest) {
  const me = await rest.get(Routes.user("@me"));
  if (!me?.id) {
    throw new Error("Failed to resolve bot user id");
  }
  return me.id;
}
export async function fetchChannelPermissionsDiscord(channelId, opts = {}) {
  const rest = resolveDiscordRest(opts);
  const channel = await rest.get(Routes.channel(channelId));
  const channelType = "type" in channel ? channel.type : undefined;
  const guildId = "guild_id" in channel ? channel.guild_id : undefined;
  if (!guildId) {
    return {
      channelId,
      permissions: [],
      raw: "0",
      isDm: true,
      channelType,
    };
  }
  const botId = await fetchBotUserId(rest);
  const [guild, member] = await Promise.all([
    rest.get(Routes.guild(guildId)),
    rest.get(Routes.guildMember(guildId, botId)),
  ]);
  const rolesById = new Map((guild.roles ?? []).map((role) => [role.id, role]));
  const everyoneRole = rolesById.get(guildId);
  let base = 0n;
  if (everyoneRole?.permissions) {
    base = addPermissionBits(base, everyoneRole.permissions);
  }
  for (const roleId of member.roles ?? []) {
    const role = rolesById.get(roleId);
    if (role?.permissions) {
      base = addPermissionBits(base, role.permissions);
    }
  }
  if (hasAdministrator(base)) {
    return {
      channelId,
      guildId,
      permissions: bitfieldToPermissions(ALL_PERMISSIONS),
      raw: ALL_PERMISSIONS.toString(),
      isDm: false,
      channelType,
    };
  }
  let permissions = base;
  const overwrites =
    "permission_overwrites" in channel ? (channel.permission_overwrites ?? []) : [];
  for (const overwrite of overwrites) {
    if (overwrite.id === guildId) {
      permissions = removePermissionBits(permissions, overwrite.deny ?? "0");
      permissions = addPermissionBits(permissions, overwrite.allow ?? "0");
    }
  }
  for (const overwrite of overwrites) {
    if (member.roles?.includes(overwrite.id)) {
      permissions = removePermissionBits(permissions, overwrite.deny ?? "0");
      permissions = addPermissionBits(permissions, overwrite.allow ?? "0");
    }
  }
  for (const overwrite of overwrites) {
    if (overwrite.id === botId) {
      permissions = removePermissionBits(permissions, overwrite.deny ?? "0");
      permissions = addPermissionBits(permissions, overwrite.allow ?? "0");
    }
  }
  return {
    channelId,
    guildId,
    permissions: bitfieldToPermissions(permissions),
    raw: permissions.toString(),
    isDm: false,
    channelType,
  };
}
