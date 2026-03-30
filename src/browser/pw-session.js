let normalizeCdpUrl = function (raw) {
    return raw.replace(/\/$/, "");
  },
  findNetworkRequestById = function (state, id) {
    for (let i = state.requests.length - 1; i >= 0; i -= 1) {
      const candidate = state.requests[i];
      if (candidate && candidate.id === id) {
        return candidate;
      }
    }
    return;
  },
  roleRefsKey = function (cdpUrl, targetId) {
    return `${normalizeCdpUrl(cdpUrl)}::${targetId}`;
  },
  observeContext = function (context) {
    if (observedContexts.has(context)) {
      return;
    }
    observedContexts.add(context);
    ensureContextState(context);
    for (const page of context.pages()) {
      ensurePageState(page);
    }
    context.on("page", (page) => ensurePageState(page));
  },
  observeBrowser = function (browser) {
    for (const context of browser.contexts()) {
      observeContext(context);
    }
  },
  normalizeCdpHttpBaseForJsonEndpoints = function (cdpUrl) {
    try {
      const url = new URL(cdpUrl);
      if (url.protocol === "ws:") {
        url.protocol = "http:";
      } else if (url.protocol === "wss:") {
        url.protocol = "https:";
      }
      url.pathname = url.pathname.replace(/\/devtools\/browser\/.*$/, "");
      url.pathname = url.pathname.replace(/\/cdp$/, "");
      return url.toString().replace(/\/$/, "");
    } catch {
      return cdpUrl
        .replace(/^ws:/, "http:")
        .replace(/^wss:/, "https:")
        .replace(/\/devtools\/browser\/.*$/, "")
        .replace(/\/cdp$/, "")
        .replace(/\/$/, "");
    }
  },
  cdpSocketNeedsAttach = function (wsUrl) {
    try {
      const pathname = new URL(wsUrl).pathname;
      return (
        pathname === "/cdp" || pathname.endsWith("/cdp") || pathname.includes("/devtools/browser/")
      );
    } catch {
      return false;
    }
  };
import { chromium } from "playwright-core";
import { formatErrorMessage } from "../infra/errors.js";
import { appendCdpPath, fetchJson, getHeadersWithAuth, withCdpSocket } from "./cdp.helpers.js";
import { normalizeCdpWsUrl } from "./cdp.js";
import { getChromeWebSocketUrl } from "./chrome.js";
const pageStates = new WeakMap();
const contextStates = new WeakMap();
const observedContexts = new WeakSet();
const observedPages = new WeakSet();
const roleRefsByTarget = new Map();
const MAX_ROLE_REFS_CACHE = 50;
const MAX_CONSOLE_MESSAGES = 500;
const MAX_PAGE_ERRORS = 200;
const MAX_NETWORK_REQUESTS = 500;
let cached = null;
let connecting = null;
export function rememberRoleRefsForTarget(opts) {
  const targetId = opts.targetId.trim();
  if (!targetId) {
    return;
  }
  roleRefsByTarget.set(roleRefsKey(opts.cdpUrl, targetId), {
    refs: opts.refs,
    ...(opts.frameSelector ? { frameSelector: opts.frameSelector } : {}),
    ...(opts.mode ? { mode: opts.mode } : {}),
  });
  while (roleRefsByTarget.size > MAX_ROLE_REFS_CACHE) {
    const first = roleRefsByTarget.keys().next();
    if (first.done) {
      break;
    }
    roleRefsByTarget.delete(first.value);
  }
}
export function storeRoleRefsForTarget(opts) {
  const state = ensurePageState(opts.page);
  state.roleRefs = opts.refs;
  state.roleRefsFrameSelector = opts.frameSelector;
  state.roleRefsMode = opts.mode;
  if (!opts.targetId?.trim()) {
    return;
  }
  rememberRoleRefsForTarget({
    cdpUrl: opts.cdpUrl,
    targetId: opts.targetId,
    refs: opts.refs,
    frameSelector: opts.frameSelector,
    mode: opts.mode,
  });
}
export function restoreRoleRefsForTarget(opts) {
  const targetId = opts.targetId?.trim() || "";
  if (!targetId) {
    return;
  }
  const cached = roleRefsByTarget.get(roleRefsKey(opts.cdpUrl, targetId));
  if (!cached) {
    return;
  }
  const state = ensurePageState(opts.page);
  if (state.roleRefs) {
    return;
  }
  state.roleRefs = cached.refs;
  state.roleRefsFrameSelector = cached.frameSelector;
  state.roleRefsMode = cached.mode;
}
export function ensurePageState(page) {
  const existing = pageStates.get(page);
  if (existing) {
    return existing;
  }
  const state = {
    console: [],
    errors: [],
    requests: [],
    requestIds: new WeakMap(),
    nextRequestId: 0,
    armIdUpload: 0,
    armIdDialog: 0,
    armIdDownload: 0,
  };
  pageStates.set(page, state);
  if (!observedPages.has(page)) {
    observedPages.add(page);
    page.on("console", (msg) => {
      const entry = {
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
        location: msg.location(),
      };
      state.console.push(entry);
      if (state.console.length > MAX_CONSOLE_MESSAGES) {
        state.console.shift();
      }
    });
    page.on("pageerror", (err) => {
      state.errors.push({
        message: err?.message ? String(err.message) : String(err),
        name: err?.name ? String(err.name) : undefined,
        stack: err?.stack ? String(err.stack) : undefined,
        timestamp: new Date().toISOString(),
      });
      if (state.errors.length > MAX_PAGE_ERRORS) {
        state.errors.shift();
      }
    });
    page.on("request", (req) => {
      state.nextRequestId += 1;
      const id = `r${state.nextRequestId}`;
      state.requestIds.set(req, id);
      state.requests.push({
        id,
        timestamp: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
      if (state.requests.length > MAX_NETWORK_REQUESTS) {
        state.requests.shift();
      }
    });
    page.on("response", (resp) => {
      const req = resp.request();
      const id = state.requestIds.get(req);
      if (!id) {
        return;
      }
      const rec = findNetworkRequestById(state, id);
      if (!rec) {
        return;
      }
      rec.status = resp.status();
      rec.ok = resp.ok();
    });
    page.on("requestfailed", (req) => {
      const id = state.requestIds.get(req);
      if (!id) {
        return;
      }
      const rec = findNetworkRequestById(state, id);
      if (!rec) {
        return;
      }
      rec.failureText = req.failure()?.errorText;
      rec.ok = false;
    });
    page.on("close", () => {
      pageStates.delete(page);
      observedPages.delete(page);
    });
  }
  return state;
}
export function ensureContextState(context) {
  const existing = contextStates.get(context);
  if (existing) {
    return existing;
  }
  const state = { traceActive: false };
  contextStates.set(context, state);
  return state;
}
async function connectBrowser(cdpUrl) {
  const normalized = normalizeCdpUrl(cdpUrl);
  if (cached?.cdpUrl === normalized) {
    return cached;
  }
  if (connecting) {
    return await connecting;
  }
  const connectWithRetry = async () => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const timeout = 5000 + attempt * 2000;
        const wsUrl = await getChromeWebSocketUrl(normalized, timeout).catch(() => null);
        const endpoint = wsUrl ?? normalized;
        const headers = getHeadersWithAuth(endpoint);
        const browser = await chromium.connectOverCDP(endpoint, { timeout, headers });
        const onDisconnected = () => {
          if (cached?.browser === browser) {
            cached = null;
          }
        };
        const connected = { browser, cdpUrl: normalized, onDisconnected };
        cached = connected;
        browser.on("disconnected", onDisconnected);
        observeBrowser(browser);
        return connected;
      } catch (err) {
        lastErr = err;
        const delay = 250 + attempt * 250;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (lastErr instanceof Error) {
      throw lastErr;
    }
    const message = lastErr ? formatErrorMessage(lastErr) : "CDP connect failed";
    throw new Error(message);
  };
  connecting = connectWithRetry().finally(() => {
    connecting = null;
  });
  return await connecting;
}
async function getAllPages(browser) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((c) => c.pages());
  return pages;
}
async function pageTargetId(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const info = await session.send("Target.getTargetInfo");
    const targetId = String(info?.targetInfo?.targetId ?? "").trim();
    return targetId || null;
  } finally {
    await session.detach().catch(() => {});
  }
}
async function findPageByTargetId(browser, targetId, cdpUrl) {
  const pages = await getAllPages(browser);
  let resolvedViaCdp = false;
  for (const page of pages) {
    let tid = null;
    try {
      tid = await pageTargetId(page);
      resolvedViaCdp = true;
    } catch {
      tid = null;
    }
    if (tid && tid === targetId) {
      return page;
    }
  }
  if (!resolvedViaCdp && pages.length === 1) {
    return pages[0];
  }
  if (cdpUrl) {
    try {
      const baseUrl = cdpUrl
        .replace(/\/+$/, "")
        .replace(/^ws:/, "http:")
        .replace(/\/cdp$/, "");
      const listUrl = `${baseUrl}/json/list`;
      const response = await fetch(listUrl, { headers: getHeadersWithAuth(listUrl) });
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find((t) => t.id === targetId);
        if (target) {
          const urlMatch = pages.filter((p) => p.url() === target.url);
          if (urlMatch.length === 1) {
            return urlMatch[0];
          }
          if (urlMatch.length > 1) {
            const sameUrlTargets = targets.filter((t) => t.url === target.url);
            if (sameUrlTargets.length === urlMatch.length) {
              const idx = sameUrlTargets.findIndex((t) => t.id === targetId);
              if (idx >= 0 && idx < urlMatch.length) {
                return urlMatch[idx];
              }
            }
          }
        }
      }
    } catch {}
  }
  return null;
}
export async function getPageForTargetId(opts) {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const pages = await getAllPages(browser);
  if (!pages.length) {
    throw new Error("No pages available in the connected browser.");
  }
  const first = pages[0];
  if (!opts.targetId) {
    return first;
  }
  const found = await findPageByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!found) {
    if (pages.length === 1) {
      return first;
    }
    throw new Error("tab not found");
  }
  return found;
}
export function refLocator(page, ref) {
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;
  if (/^e\d+$/.test(normalized)) {
    const state = pageStates.get(page);
    if (state?.roleRefsMode === "aria") {
      const scope = state.roleRefsFrameSelector
        ? page.frameLocator(state.roleRefsFrameSelector)
        : page;
      return scope.locator(`aria-ref=${normalized}`);
    }
    const info = state?.roleRefs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`,
      );
    }
    const scope = state?.roleRefsFrameSelector
      ? page.frameLocator(state.roleRefsFrameSelector)
      : page;
    const locAny = scope;
    const locator = info.name
      ? locAny.getByRole(info.role, { name: info.name, exact: true })
      : locAny.getByRole(info.role);
    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }
  return page.locator(`aria-ref=${normalized}`);
}
export async function closePlaywrightBrowserConnection() {
  const cur = cached;
  cached = null;
  connecting = null;
  if (!cur) {
    return;
  }
  if (cur.onDisconnected && typeof cur.browser.off === "function") {
    cur.browser.off("disconnected", cur.onDisconnected);
  }
  await cur.browser.close().catch(() => {});
}
async function tryTerminateExecutionViaCdp(opts) {
  const cdpHttpBase = normalizeCdpHttpBaseForJsonEndpoints(opts.cdpUrl);
  const listUrl = appendCdpPath(cdpHttpBase, "/json/list");
  const pages = await fetchJson(listUrl, 2000).catch(() => null);
  if (!pages || pages.length === 0) {
    return;
  }
  const target = pages.find((p) => String(p.id ?? "").trim() === opts.targetId);
  const wsUrlRaw = String(target?.webSocketDebuggerUrl ?? "").trim();
  if (!wsUrlRaw) {
    return;
  }
  const wsUrl = normalizeCdpWsUrl(wsUrlRaw, cdpHttpBase);
  const needsAttach = cdpSocketNeedsAttach(wsUrl);
  const runWithTimeout = async (work, ms) => {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("CDP command timed out")), ms);
    });
    try {
      return await Promise.race([work, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
  await withCdpSocket(
    wsUrl,
    async (send) => {
      let sessionId;
      try {
        if (needsAttach) {
          const attached = await runWithTimeout(
            send("Target.attachToTarget", { targetId: opts.targetId, flatten: true }),
            1500,
          );
          if (typeof attached?.sessionId === "string" && attached.sessionId.trim()) {
            sessionId = attached.sessionId;
          }
        }
        await runWithTimeout(send("Runtime.terminateExecution", undefined, sessionId), 1500);
        if (sessionId) {
          send("Target.detachFromTarget", { sessionId }).catch(() => {});
        }
      } catch {}
    },
    { handshakeTimeoutMs: 2000 },
  ).catch(() => {});
}
export async function forceDisconnectPlaywrightForTarget(opts) {
  const normalized = normalizeCdpUrl(opts.cdpUrl);
  if (cached?.cdpUrl !== normalized) {
    return;
  }
  const cur = cached;
  cached = null;
  connecting = null;
  if (cur) {
    if (cur.onDisconnected && typeof cur.browser.off === "function") {
      cur.browser.off("disconnected", cur.onDisconnected);
    }
    const targetId = opts.targetId?.trim() || "";
    if (targetId) {
      await tryTerminateExecutionViaCdp({ cdpUrl: normalized, targetId }).catch(() => {});
    }
    cur.browser.close().catch(() => {});
  }
}
export async function listPagesViaPlaywright(opts) {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const pages = await getAllPages(browser);
  const results = [];
  for (const page of pages) {
    const tid = await pageTargetId(page).catch(() => null);
    if (tid) {
      results.push({
        targetId: tid,
        title: await page.title().catch(() => ""),
        url: page.url(),
        type: "page",
      });
    }
  }
  return results;
}
export async function createPageViaPlaywright(opts) {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  ensureContextState(context);
  const page = await context.newPage();
  ensurePageState(page);
  const targetUrl = opts.url.trim() || "about:blank";
  if (targetUrl !== "about:blank") {
    await page.goto(targetUrl, { timeout: 30000 }).catch(() => {});
  }
  const tid = await pageTargetId(page).catch(() => null);
  if (!tid) {
    throw new Error("Failed to get targetId for new page");
  }
  return {
    targetId: tid,
    title: await page.title().catch(() => ""),
    url: page.url(),
    type: "page",
  };
}
export async function closePageByTargetIdViaPlaywright(opts) {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const page = await findPageByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!page) {
    throw new Error("tab not found");
  }
  await page.close();
}
export async function focusPageByTargetIdViaPlaywright(opts) {
  const { browser } = await connectBrowser(opts.cdpUrl);
  const page = await findPageByTargetId(browser, opts.targetId, opts.cdpUrl);
  if (!page) {
    throw new Error("tab not found");
  }
  try {
    await page.bringToFront();
  } catch (err) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Page.bringToFront");
      return;
    } catch {
      throw err;
    } finally {
      await session.detach().catch(() => {});
    }
  }
}
