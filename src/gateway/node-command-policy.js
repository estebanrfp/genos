let normalizePlatformId = function (platform, deviceFamily) {
  const raw = (platform ?? "").trim().toLowerCase();
  if (raw.startsWith("ios")) {
    return "ios";
  }
  if (raw.startsWith("android")) {
    return "android";
  }
  if (raw.startsWith("mac")) {
    return "macos";
  }
  if (raw.startsWith("darwin")) {
    return "macos";
  }
  if (raw.startsWith("win")) {
    return "windows";
  }
  if (raw.startsWith("linux")) {
    return "linux";
  }
  const family = (deviceFamily ?? "").trim().toLowerCase();
  if (family.includes("iphone") || family.includes("ipad") || family.includes("ios")) {
    return "ios";
  }
  if (family.includes("android")) {
    return "android";
  }
  if (family.includes("mac")) {
    return "macos";
  }
  if (family.includes("windows")) {
    return "windows";
  }
  if (family.includes("linux")) {
    return "linux";
  }
  return "unknown";
};
const CANVAS_COMMANDS = [
  "canvas.present",
  "canvas.hide",
  "canvas.navigate",
  "canvas.eval",
  "canvas.snapshot",
];
const CAMERA_COMMANDS = ["camera.list"];
const CAMERA_DANGEROUS_COMMANDS = ["camera.snap", "camera.clip"];
const SCREEN_DANGEROUS_COMMANDS = ["screen.record"];
const LOCATION_COMMANDS = ["location.get"];
const DEVICE_COMMANDS = ["device.info", "device.status"];
const CONTACTS_COMMANDS = ["contacts.search"];
const CONTACTS_DANGEROUS_COMMANDS = ["contacts.add"];
const CALENDAR_COMMANDS = ["calendar.events"];
const CALENDAR_DANGEROUS_COMMANDS = ["calendar.add"];
const REMINDERS_COMMANDS = ["reminders.list"];
const REMINDERS_DANGEROUS_COMMANDS = ["reminders.add"];
const PHOTOS_COMMANDS = ["photos.latest"];
const MOTION_COMMANDS = ["motion.activity", "motion.pedometer"];
const SMS_DANGEROUS_COMMANDS = ["sms.send"];
const IOS_SYSTEM_COMMANDS = ["system.notify"];
const SYSTEM_COMMANDS = ["system.run", "system.which", "system.notify", "browser.proxy"];
export const DEFAULT_DANGEROUS_NODE_COMMANDS = [
  ...CAMERA_DANGEROUS_COMMANDS,
  ...SCREEN_DANGEROUS_COMMANDS,
  ...CONTACTS_DANGEROUS_COMMANDS,
  ...CALENDAR_DANGEROUS_COMMANDS,
  ...REMINDERS_DANGEROUS_COMMANDS,
  ...SMS_DANGEROUS_COMMANDS,
];
const PLATFORM_DEFAULTS = {
  ios: [
    ...CANVAS_COMMANDS,
    ...CAMERA_COMMANDS,
    ...LOCATION_COMMANDS,
    ...DEVICE_COMMANDS,
    ...CONTACTS_COMMANDS,
    ...CALENDAR_COMMANDS,
    ...REMINDERS_COMMANDS,
    ...PHOTOS_COMMANDS,
    ...MOTION_COMMANDS,
    ...IOS_SYSTEM_COMMANDS,
  ],
  android: [
    ...CANVAS_COMMANDS,
    ...CAMERA_COMMANDS,
    ...LOCATION_COMMANDS,
    ...DEVICE_COMMANDS,
    ...CONTACTS_COMMANDS,
    ...CALENDAR_COMMANDS,
    ...REMINDERS_COMMANDS,
    ...PHOTOS_COMMANDS,
    ...MOTION_COMMANDS,
  ],
  macos: [
    ...CANVAS_COMMANDS,
    ...CAMERA_COMMANDS,
    ...LOCATION_COMMANDS,
    ...DEVICE_COMMANDS,
    ...CONTACTS_COMMANDS,
    ...CALENDAR_COMMANDS,
    ...REMINDERS_COMMANDS,
    ...PHOTOS_COMMANDS,
    ...MOTION_COMMANDS,
    ...SYSTEM_COMMANDS,
  ],
  linux: [...SYSTEM_COMMANDS],
  windows: [...SYSTEM_COMMANDS],
  unknown: [...CANVAS_COMMANDS, ...CAMERA_COMMANDS, ...LOCATION_COMMANDS, ...SYSTEM_COMMANDS],
};
export function resolveNodeCommandAllowlist(cfg, node) {
  const platformId = normalizePlatformId(node?.platform, node?.deviceFamily);
  const base = PLATFORM_DEFAULTS[platformId] ?? PLATFORM_DEFAULTS.unknown;
  const extra = cfg.gateway?.nodes?.allowCommands ?? [];
  const deny = new Set(cfg.gateway?.nodes?.denyCommands ?? []);
  const allow = new Set([...base, ...extra].map((cmd) => cmd.trim()).filter(Boolean));
  for (const blocked of deny) {
    const trimmed = blocked.trim();
    if (trimmed) {
      allow.delete(trimmed);
    }
  }
  return allow;
}
export function isNodeCommandAllowed(params) {
  const command = params.command.trim();
  if (!command) {
    return { ok: false, reason: "command required" };
  }
  if (!params.allowlist.has(command)) {
    return { ok: false, reason: "command not allowlisted" };
  }
  if (Array.isArray(params.declaredCommands) && params.declaredCommands.length > 0) {
    if (!params.declaredCommands.includes(command)) {
      return { ok: false, reason: "command not declared by node" };
    }
  } else {
    return { ok: false, reason: "node did not declare commands" };
  }
  return { ok: true };
}
