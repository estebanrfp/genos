export const DEFAULT_GATEWAY_HTTP_TOOL_DENY = [
  "sessions_spawn",
  "sessions_send",
  "gateway",
  "whatsapp_login",
];
export const DANGEROUS_ACP_TOOL_NAMES = [
  "exec",
  "spawn",
  "shell",
  "sessions_spawn",
  "sessions_send",
  "gateway",
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
];
export const DANGEROUS_ACP_TOOLS = new Set(DANGEROUS_ACP_TOOL_NAMES);
