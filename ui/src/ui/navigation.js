import { t } from "../i18n/index.js";
export const TAB_GROUPS = [{ label: "chat", tabs: ["chat"] }];
const TAB_PATHS = {
  chat: "/chat",
};
const PATH_TO_TAB = new Map(Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab]));
export function normalizeBasePath(basePath) {
  if (!basePath) {
    return "";
  }
  let base = basePath.trim();
  if (!base.startsWith("/")) {
    base = `/${base}`;
  }
  if (base === "/") {
    return "";
  }
  if (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}
export function normalizePath(path) {
  if (!path) {
    return "/";
  }
  let normalized = path.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
export function pathForTab(tab, basePath = "") {
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab];
  return base ? `${base}${path}` : path;
}
export function tabFromPath(pathname, basePath = "") {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith("/index.html")) {
    normalized = "/";
  }
  if (normalized === "/") {
    return "chat";
  }
  return PATH_TO_TAB.get(normalized) ?? null;
}
export function inferBasePathFromPathname(pathname) {
  let normalized = normalizePath(pathname);
  if (normalized.endsWith("/index.html")) {
    normalized = normalizePath(normalized.slice(0, -"/index.html".length));
  }
  if (normalized === "/") {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  for (let i = 0; i < segments.length; i++) {
    const candidate = `/${segments.slice(i).join("/")}`.toLowerCase();
    if (PATH_TO_TAB.has(candidate)) {
      const prefix = segments.slice(0, i);
      return prefix.length ? `/${prefix.join("/")}` : "";
    }
  }
  return `/${segments.join("/")}`;
}
export function iconForTab(tab) {
  switch (tab) {
    case "chat":
      return "messageSquare";
    default:
      return "folder";
  }
}
export function titleForTab(tab) {
  return t(`tabs.${tab}`);
}
export function subtitleForTab(tab) {
  return t(`subtitles.${tab}`);
}
