export function normalizeMessage(message) {
  const m = message;
  let role = typeof m.role === "string" ? m.role : "unknown";
  const hasToolId = typeof m.toolCallId === "string" || typeof m.tool_call_id === "string";
  const contentRaw = m.content;
  const contentItems = Array.isArray(contentRaw) ? contentRaw : null;
  const hasToolContent =
    Array.isArray(contentItems) &&
    contentItems.some((item) => {
      const x = item;
      const t = (typeof x.type === "string" ? x.type : "").toLowerCase();
      return t === "toolresult" || t === "tool_result";
    });
  const hasToolName = typeof m.toolName === "string" || typeof m.tool_name === "string";
  const isToolRole = role === "tool" || role === "function";
  if (hasToolId || hasToolContent || hasToolName || isToolRole) {
    role = "toolResult";
  }
  let content = [];
  if (typeof m.content === "string") {
    content = [{ type: "text", text: m.content }];
  } else if (Array.isArray(m.content)) {
    content = m.content.map((item) => ({
      type: item.type || "text",
      text: item.text,
      name: item.name,
      args: item.args || item.arguments,
    }));
  } else if (typeof m.text === "string") {
    content = [{ type: "text", text: m.text }];
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : Date.now();
  const id = typeof m.id === "string" ? m.id : undefined;
  return { role, content, timestamp, id };
}
export function normalizeRoleForGrouping(role) {
  const lower = role.toLowerCase();
  if (role === "user" || role === "User") {
    return role;
  }
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "system") {
    return "system";
  }
  if (
    lower === "toolresult" ||
    lower === "tool_result" ||
    lower === "tool" ||
    lower === "function"
  ) {
    return "tool";
  }
  return role;
}
export function isToolResultMessage(message) {
  const m = message;
  const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
  return role === "toolresult" || role === "tool_result" || role === "tool" || role === "function";
}
