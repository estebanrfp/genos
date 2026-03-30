import { refreshChat } from "./app-chat.js";
import { scheduleChatScroll } from "./app-scroll.js";
import {
  inferBasePathFromPathname,
  normalizeBasePath,
  normalizePath,
  pathForTab,
  tabFromPath,
} from "./navigation.js";
import { saveSettings } from "./storage.js";
import { startThemeTransition } from "./theme-transition.js";
import { resolveTheme } from "./theme.js";
export function applySettings(host, next) {
  const normalized = {
    ...next,
    lastActiveSessionKey: next.lastActiveSessionKey?.trim() || next.sessionKey.trim() || "main",
  };
  host.settings = normalized;
  saveSettings(normalized);
  if (next.theme !== host.theme) {
    host.theme = next.theme;
    applyResolvedTheme(host, resolveTheme(next.theme));
  }
  host.applySessionKey = host.settings.lastActiveSessionKey;
}
export function setLastActiveSessionKey(host, next) {
  const trimmed = next.trim();
  if (!trimmed) {
    return;
  }
  if (host.settings.lastActiveSessionKey === trimmed) {
    return;
  }
  applySettings(host, { ...host.settings, lastActiveSessionKey: trimmed });
}
export function applySettingsFromUrl(host) {
  if (!window.location.search && !window.location.hash) {
    return;
  }
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const tokenRaw = params.get("token") ?? hashParams.get("token");
  const sessionRaw = params.get("session") ?? hashParams.get("session");
  const gatewayUrlRaw = params.get("gatewayUrl") ?? hashParams.get("gatewayUrl");
  let shouldCleanUrl = false;
  if (tokenRaw != null) {
    const token = tokenRaw.trim();
    if (token && token !== host.settings.token) {
      applySettings(host, { ...host.settings, token });
    }
    params.delete("token");
    hashParams.delete("token");
    shouldCleanUrl = true;
  }
  if (sessionRaw != null) {
    const session = sessionRaw.trim();
    if (session) {
      const changed = session !== host.sessionKey;
      host.sessionKey = session;
      if (changed) {
        host.chatMessages = [];
      }
      applySettings(host, {
        ...host.settings,
        sessionKey: session,
        lastActiveSessionKey: session,
      });
    }
  }
  if (gatewayUrlRaw != null) {
    const gatewayUrl = gatewayUrlRaw.trim();
    if (gatewayUrl && gatewayUrl !== host.settings.gatewayUrl) {
      host.pendingGatewayUrl = gatewayUrl;
    }
    params.delete("gatewayUrl");
    hashParams.delete("gatewayUrl");
    shouldCleanUrl = true;
  }
  if (!shouldCleanUrl) {
    return;
  }
  url.search = params.toString();
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  window.history.replaceState({}, "", url.toString());
}
const PROTECTED_TABS = new Set();

export function setTab(host, next) {
  // Lock tab when leaving it — each protected tab requires its own auth
  if (PROTECTED_TABS.has(host.tab) && host.tab !== next) {
    host.unlockedTabs = new Set([...host.unlockedTabs].filter((t) => t !== host.tab));
  }
  if (host.tab !== next) {
    host.tab = next;
  }
  if (next === "chat") {
    host.chatHasAutoScrolled = false;
  }
  refreshActiveTab(host);
  syncUrlWithTab(host, next, false);
}
export function setTheme(host, next, context) {
  const applyTheme = () => {
    host.theme = next;
    applySettings(host, { ...host.settings, theme: next });
    applyResolvedTheme(host, resolveTheme(next));
  };
  startThemeTransition({
    nextTheme: next,
    applyTheme,
    context,
    currentTheme: host.theme,
  });
}
export async function refreshActiveTab(host) {
  if (host.tab === "chat") {
    await refreshChat(host);
    scheduleChatScroll(host, !host.chatHasAutoScrolled);
  }
}
export function inferBasePath() {
  if (typeof window === "undefined") {
    return "";
  }
  const configured = window.__GENOS_CONTROL_UI_BASE_PATH__;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeBasePath(configured);
  }
  return inferBasePathFromPathname(window.location.pathname);
}
export function syncThemeWithSettings(host) {
  host.theme = host.settings.theme ?? "system";
  applyResolvedTheme(host, resolveTheme(host.theme));
}
export function applyResolvedTheme(host, resolved) {
  host.themeResolved = resolved;
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}
export function attachThemeListener(host) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  host.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  host.themeMediaHandler = (event) => {
    if (host.theme !== "system") {
      return;
    }
    applyResolvedTheme(host, event.matches ? "dark" : "light");
  };
  if (typeof host.themeMedia.addEventListener === "function") {
    host.themeMedia.addEventListener("change", host.themeMediaHandler);
    return;
  }
  const legacy = host.themeMedia;
  legacy.addListener(host.themeMediaHandler);
}
export function detachThemeListener(host) {
  if (!host.themeMedia || !host.themeMediaHandler) {
    return;
  }
  if (typeof host.themeMedia.removeEventListener === "function") {
    host.themeMedia.removeEventListener("change", host.themeMediaHandler);
    return;
  }
  const legacy = host.themeMedia;
  legacy.removeListener(host.themeMediaHandler);
  host.themeMedia = null;
  host.themeMediaHandler = null;
}
export function syncTabWithLocation(host, replace) {
  if (typeof window === "undefined") {
    return;
  }
  const resolved = tabFromPath(window.location.pathname, host.basePath) ?? "chat";
  setTabFromRoute(host, resolved);
  syncUrlWithTab(host, resolved, replace);
}
export function onPopState(host) {
  if (typeof window === "undefined") {
    return;
  }
  const resolved = tabFromPath(window.location.pathname, host.basePath);
  if (!resolved) {
    return;
  }
  const url = new URL(window.location.href);
  const session = url.searchParams.get("session")?.trim();
  if (session) {
    const changed = session !== host.sessionKey;
    host.sessionKey = session;
    if (changed) {
      host.chatMessages = [];
    }
    applySettings(host, {
      ...host.settings,
      sessionKey: session,
      lastActiveSessionKey: session,
    });
  }
  setTabFromRoute(host, resolved);
}
export function setTabFromRoute(host, next) {
  if (host.tab !== next) {
    host.tab = next;
  }
  if (next === "chat") {
    host.chatHasAutoScrolled = false;
  }
  if (host.connected) {
    refreshActiveTab(host);
  }
}
export function syncUrlWithTab(host, tab, replace) {
  if (typeof window === "undefined") {
    return;
  }
  const targetPath = normalizePath(pathForTab(tab, host.basePath));
  const currentPath = normalizePath(window.location.pathname);
  const url = new URL(window.location.href);
  if (tab === "chat" && host.sessionKey) {
    url.searchParams.set("session", host.sessionKey);
  } else {
    url.searchParams.delete("session");
  }
  if (currentPath !== targetPath) {
    url.pathname = targetPath;
  }
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}
export function syncUrlWithSessionKey(host, sessionKey, replace) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionKey);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}
