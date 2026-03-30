let isAbsoluteHttp = function (url) {
    return /^https?:\/\//i.test(url.trim());
  },
  isLoopbackHttpUrl = function (url) {
    try {
      const host = new URL(url).hostname.trim().toLowerCase();
      const normalizedHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
      return (
        normalizedHost === "127.0.0.1" || normalizedHost === "localhost" || normalizedHost === "::1"
      );
    } catch {
      return false;
    }
  },
  withLoopbackBrowserAuthImpl = function (url, init, deps) {
    const headers = new Headers(init?.headers ?? {});
    if (headers.has("authorization") || headers.has("x-genosos-password")) {
      return { ...init, headers };
    }
    if (!isLoopbackHttpUrl(url)) {
      return { ...init, headers };
    }
    try {
      const cfg = deps.loadConfig();
      const auth = deps.resolveBrowserControlAuth(cfg);
      if (auth.token) {
        headers.set("Authorization", `Bearer ${auth.token}`);
        return { ...init, headers };
      }
      if (auth.password) {
        headers.set("x-genosos-password", auth.password);
        return { ...init, headers };
      }
    } catch {}
    try {
      const parsed = new URL(url);
      const port =
        parsed.port && Number.parseInt(parsed.port, 10) > 0
          ? Number.parseInt(parsed.port, 10)
          : parsed.protocol === "https:"
            ? 443
            : 80;
      const bridgeAuth = deps.getBridgeAuthForPort(port);
      if (bridgeAuth?.token) {
        headers.set("Authorization", `Bearer ${bridgeAuth.token}`);
      } else if (bridgeAuth?.password) {
        headers.set("x-genosos-password", bridgeAuth.password);
      }
    } catch {}
    return { ...init, headers };
  },
  withLoopbackBrowserAuth = function (url, init) {
    return withLoopbackBrowserAuthImpl(url, init, {
      loadConfig,
      resolveBrowserControlAuth,
      getBridgeAuthForPort,
    });
  },
  enhanceBrowserFetchError = function (url, err, timeoutMs) {
    const isLocal = !isAbsoluteHttp(url);
    const operatorHint = isLocal
      ? `Restart the GenosOS gateway (GenosOS.app menubar, or \`${formatCliCommand("genosos gateway")}\`).`
      : "If this is a sandboxed session, ensure the sandbox browser is running.";
    const modelHint =
      "Do NOT retry the browser tool \u2014 it will keep failing. Use an alternative approach or inform the user that the browser is currently unavailable.";
    const msg = String(err);
    const msgLower = msg.toLowerCase();
    const looksLikeTimeout =
      msgLower.includes("timed out") ||
      msgLower.includes("timeout") ||
      msgLower.includes("aborted") ||
      msgLower.includes("abort") ||
      msgLower.includes("aborterror");
    if (looksLikeTimeout) {
      return new Error(
        `Can't reach the GenosOS browser control service (timed out after ${timeoutMs}ms). ${operatorHint} ${modelHint}`,
      );
    }
    return new Error(
      `Can't reach the GenosOS browser control service. ${operatorHint} ${modelHint} (${msg})`,
    );
  };
import { formatCliCommand } from "../cli/command-format.js";
import { loadConfig } from "../config/config.js";
import { getBridgeAuthForPort } from "./bridge-auth-registry.js";
import { resolveBrowserControlAuth } from "./control-auth.js";
import {
  createBrowserControlContext,
  startBrowserControlServiceFromConfig,
} from "./control-service.js";
import { createBrowserRouteDispatcher } from "./routes/dispatcher.js";
async function fetchHttpJson(url, init) {
  const timeoutMs = init.timeoutMs ?? 5000;
  const ctrl = new AbortController();
  const upstreamSignal = init.signal;
  let upstreamAbortListener;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      ctrl.abort(upstreamSignal.reason);
    } else {
      upstreamAbortListener = () => ctrl.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener("abort", upstreamAbortListener, { once: true });
    }
  }
  const t = setTimeout(() => ctrl.abort(new Error("timed out")), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
    if (upstreamSignal && upstreamAbortListener) {
      upstreamSignal.removeEventListener("abort", upstreamAbortListener);
    }
  }
}
export async function fetchBrowserJson(url, init) {
  const timeoutMs = init?.timeoutMs ?? 5000;
  try {
    if (isAbsoluteHttp(url)) {
      const httpInit = withLoopbackBrowserAuth(url, init);
      return await fetchHttpJson(url, { ...httpInit, timeoutMs });
    }
    const started = await startBrowserControlServiceFromConfig();
    if (!started) {
      throw new Error("browser control disabled");
    }
    const dispatcher = createBrowserRouteDispatcher(createBrowserControlContext());
    const parsed = new URL(url, "http://localhost");
    const query = {};
    for (const [key, value] of parsed.searchParams.entries()) {
      query[key] = value;
    }
    let body = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {}
    }
    const abortCtrl = new AbortController();
    const upstreamSignal = init?.signal;
    let upstreamAbortListener;
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        abortCtrl.abort(upstreamSignal.reason);
      } else {
        upstreamAbortListener = () => abortCtrl.abort(upstreamSignal.reason);
        upstreamSignal.addEventListener("abort", upstreamAbortListener, { once: true });
      }
    }
    let abortListener;
    const abortPromise = abortCtrl.signal.aborted
      ? Promise.reject(abortCtrl.signal.reason ?? new Error("aborted"))
      : new Promise((_, reject) => {
          abortListener = () => reject(abortCtrl.signal.reason ?? new Error("aborted"));
          abortCtrl.signal.addEventListener("abort", abortListener, { once: true });
        });
    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => abortCtrl.abort(new Error("timed out")), timeoutMs);
    }
    const dispatchPromise = dispatcher.dispatch({
      method:
        init?.method?.toUpperCase() === "DELETE"
          ? "DELETE"
          : init?.method?.toUpperCase() === "POST"
            ? "POST"
            : "GET",
      path: parsed.pathname,
      query,
      body,
      signal: abortCtrl.signal,
    });
    const result = await Promise.race([dispatchPromise, abortPromise]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
      if (abortListener) {
        abortCtrl.signal.removeEventListener("abort", abortListener);
      }
      if (upstreamSignal && upstreamAbortListener) {
        upstreamSignal.removeEventListener("abort", upstreamAbortListener);
      }
    });
    if (result.status >= 400) {
      const message =
        result.body && typeof result.body === "object" && "error" in result.body
          ? String(result.body.error)
          : `HTTP ${result.status}`;
      throw new Error(message);
    }
    return result.body;
  } catch (err) {
    throw enhanceBrowserFetchError(url, err, timeoutMs);
  }
}
export const __test = {
  withLoopbackBrowserAuth: withLoopbackBrowserAuthImpl,
};
