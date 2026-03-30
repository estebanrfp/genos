let resolveAccountId = function (params) {
    return typeof params.accountId === "string" ? params.accountId : undefined;
  },
  respondProviderUnavailable = function (respond) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "web login provider is not available"),
    );
  },
  respondProviderUnsupported = function (respond, providerId) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `web login is not supported by provider ${providerId}`,
      ),
    );
  };
import { randomUUID } from "node:crypto";
import { listChannelPlugins } from "../../channels/plugins/index.js";
import { loadConfig } from "../../config/io.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
} from "../protocol/index.js";
import { formatForLog } from "../ws-log.js";

// ── Pending WhatsApp QR logins (agent → UI → agent) ──────────────────────────
const pendingQrLogins = new Map();

/**
 * Create a pending QR login record with a promise that resolves on completion.
 * @param {number} [timeoutMs=120000]
 * @returns {{ id: string, createdAtMs: number, expiresAtMs: number, promise: Promise<object> }}
 */
const createPendingQr = (timeoutMs = 120_000) => {
  const id = randomUUID();
  const now = Date.now();
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => {
    resolve({ ok: false, error: "timeout" });
    pendingQrLogins.delete(id);
  }, timeoutMs);
  pendingQrLogins.set(id, { resolve, timer, promise });
  return { id, createdAtMs: now, expiresAtMs: now + timeoutMs, promise };
};

/**
 * Resolve a pending QR login by id.
 * @param {string} id
 * @param {object} result
 * @returns {boolean}
 */
const resolvePendingQr = (id, result) => {
  const entry = pendingQrLogins.get(id);
  if (!entry) {
    return false;
  }
  clearTimeout(entry.timer);
  entry.resolve(result);
  pendingQrLogins.delete(id);
  return true;
};

// ── Pending Nostr profile edits (agent → UI → agent) ─────────────────────────
const pendingProfileEdits = new Map();

/**
 * Create a pending profile edit record with a promise that resolves on completion.
 * @param {number} [timeoutMs=300000]
 * @returns {{ id: string, createdAtMs: number, expiresAtMs: number, promise: Promise<object> }}
 */
const createPendingProfileEdit = (timeoutMs = 300_000) => {
  const id = randomUUID();
  const now = Date.now();
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => {
    resolve({ ok: false, error: "timeout" });
    pendingProfileEdits.delete(id);
  }, timeoutMs);
  pendingProfileEdits.set(id, { resolve, timer, promise });
  return { id, createdAtMs: now, expiresAtMs: now + timeoutMs, promise };
};

/**
 * Resolve a pending profile edit by id.
 * @param {string} id
 * @param {object} result
 * @returns {boolean}
 */
const resolvePendingProfileEdit = (id, result) => {
  const entry = pendingProfileEdits.get(id);
  if (!entry) {
    return false;
  }
  clearTimeout(entry.timer);
  entry.resolve(result);
  pendingProfileEdits.delete(id);
  return true;
};
// ── Pending Logs view overlays (agent → UI → agent) ──────────────────────────
const pendingLogsView = new Map();

/**
 * Create a pending logs view record with a promise that resolves on dismiss.
 * @param {number} [timeoutMs=300000]
 * @returns {{ id: string, createdAtMs: number, expiresAtMs: number, promise: Promise<object> }}
 */
const createPendingLogsView = (timeoutMs = 300_000) => {
  const id = randomUUID();
  const now = Date.now();
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => {
    resolve({ ok: true, dismissed: "timeout" });
    pendingLogsView.delete(id);
  }, timeoutMs);
  pendingLogsView.set(id, { resolve, timer, promise });
  return { id, createdAtMs: now, expiresAtMs: now + timeoutMs, promise };
};

/**
 * Resolve a pending logs view by id.
 * @param {string} id
 * @param {object} result
 * @returns {boolean}
 */
const resolvePendingLogsView = (id, result) => {
  const entry = pendingLogsView.get(id);
  if (!entry) {
    return false;
  }
  clearTimeout(entry.timer);
  entry.resolve(result);
  pendingLogsView.delete(id);
  return true;
};

// ── Pending Files browser overlays (agent → UI → agent) ──────────────────────
const pendingFilesBrowser = new Map();

/**
 * Create a pending files browser record with a promise that resolves on dismiss.
 * @param {number} [timeoutMs=600000]
 * @returns {{ id: string, createdAtMs: number, expiresAtMs: number, promise: Promise<object> }}
 */
const createPendingFilesBrowser = (timeoutMs = 600_000) => {
  const id = randomUUID();
  const now = Date.now();
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => {
    resolve({ ok: true, dismissed: "timeout" });
    pendingFilesBrowser.delete(id);
  }, timeoutMs);
  pendingFilesBrowser.set(id, { resolve, timer, promise });
  return { id, createdAtMs: now, expiresAtMs: now + timeoutMs, promise };
};

/**
 * Resolve a pending files browser by id.
 * @param {string} id
 * @param {object} result
 * @returns {boolean}
 */
const resolvePendingFilesBrowser = (id, result) => {
  const entry = pendingFilesBrowser.get(id);
  if (!entry) {
    return false;
  }
  clearTimeout(entry.timer);
  entry.resolve(result);
  pendingFilesBrowser.delete(id);
  return true;
};

// ── Pending Cron board overlays (agent → UI → agent) ─────────────────────────
const pendingCronBoard = new Map();

/**
 * Create a pending cron board record with a promise that resolves on dismiss.
 * @param {number} [timeoutMs=300000]
 * @returns {{ id: string, createdAtMs: number, expiresAtMs: number, promise: Promise<object> }}
 */
const createPendingCronBoard = (timeoutMs = 300_000) => {
  const id = randomUUID();
  const now = Date.now();
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => {
    resolve({ ok: true, dismissed: "timeout" });
    pendingCronBoard.delete(id);
  }, timeoutMs);
  pendingCronBoard.set(id, { resolve, timer, promise });
  return { id, createdAtMs: now, expiresAtMs: now + timeoutMs, promise };
};

/**
 * Resolve a pending cron board by id.
 * @param {string} id
 * @param {object} result
 * @returns {boolean}
 */
const resolvePendingCronBoard = (id, result) => {
  const entry = pendingCronBoard.get(id);
  if (!entry) {
    return false;
  }
  clearTimeout(entry.timer);
  entry.resolve(result);
  pendingCronBoard.delete(id);
  return true;
};

const WEB_LOGIN_METHODS = new Set(["web.login.start", "web.login.wait"]);
const resolveWebLoginProvider = () =>
  listChannelPlugins().find((plugin) =>
    (plugin.gatewayMethods ?? []).some((method) => WEB_LOGIN_METHODS.has(method)),
  ) ?? null;
export const webHandlers = {
  "web.login.start": async ({ params, respond, context }) => {
    if (!validateWebLoginStartParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrStart({
        force: Boolean(params.force),
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
        verbose: Boolean(params.verbose),
        accountId,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
  "web.login.wait": async ({ params, respond, context }) => {
    if (!validateWebLoginWaitParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = resolveAccountId(params);
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      if (!provider.gateway?.loginWithQrWait) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const result = await provider.gateway.loginWithQrWait({
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
        accountId,
      });
      if (result.connected) {
        await context.startChannel(provider.id, accountId);
      }
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "whatsapp.qr.initiate": async ({ params, respond, context }) => {
    try {
      const provider = resolveWebLoginProvider();
      if (!provider) {
        respondProviderUnavailable(respond);
        return;
      }
      const accountId = resolveAccountId(params ?? {});
      await context.stopChannel(provider.id, accountId);
      if (!provider.gateway?.loginWithQrStart) {
        respondProviderUnsupported(respond, provider.id);
        return;
      }
      const qrResult = await provider.gateway.loginWithQrStart({
        force: true,
        timeoutMs: 30000,
        accountId,
      });
      const qrDataUrl = qrResult?.qrDataUrl ?? qrResult?.qr ?? null;
      const message = qrResult?.message ?? null;
      const pending = createPendingQr();
      context.broadcast(
        "whatsapp.qr.requested",
        {
          id: pending.id,
          qrDataUrl,
          message,
          createdAtMs: pending.createdAtMs,
          expiresAtMs: pending.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const result = await pending.promise;
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "whatsapp.qr.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing QR login id"));
      return;
    }
    const success = params.success === true;
    const error = typeof params.error === "string" ? params.error : undefined;
    const result = success
      ? { ok: true, connected: true }
      : { ok: false, ...(error ? { error } : {}) };
    const resolved = resolvePendingQr(id, result);
    if (resolved) {
      context.broadcast("whatsapp.qr.completed", { id, success }, { dropIfSlow: true });
    }
    respond(true, { ok: resolved }, undefined);
  },

  "nostr.profile.edit.initiate": async ({ params, respond, context }) => {
    try {
      const cfg = loadConfig();
      const nostrCfg = cfg.channels?.nostr ?? {};
      const accountId =
        resolveAccountId(params ?? {}) ??
        nostrCfg.accounts?.[0]?.id ??
        nostrCfg.accountId ??
        "default";
      const profile = nostrCfg.profile ?? {};
      const pending = createPendingProfileEdit();
      context.broadcast(
        "nostr.profile.edit.requested",
        {
          id: pending.id,
          accountId,
          profile,
          createdAtMs: pending.createdAtMs,
          expiresAtMs: pending.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const result = await pending.promise;
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "nostr.profile.edit.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing profile edit id"));
      return;
    }
    const success = params.success === true;
    const profile =
      params.profile && typeof params.profile === "object" ? params.profile : undefined;
    const error = typeof params.error === "string" ? params.error : undefined;
    const result = success
      ? { ok: true, ...(profile ? { profile } : {}) }
      : { ok: false, ...(error ? { error } : {}) };
    const resolved = resolvePendingProfileEdit(id, result);
    if (resolved) {
      context.broadcast("nostr.profile.edit.completed", { id, success }, { dropIfSlow: true });
    }
    respond(true, { ok: resolved }, undefined);
  },

  "cron.board.initiate": async ({ respond, context }) => {
    try {
      const pending = createPendingCronBoard();
      context.broadcast(
        "cron.board.requested",
        {
          id: pending.id,
          createdAtMs: pending.createdAtMs,
          expiresAtMs: pending.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const result = await pending.promise;
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "cron.board.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing cron board id"));
      return;
    }
    const resolved = resolvePendingCronBoard(id, { ok: true, dismissed: true });
    if (resolved) {
      context.broadcast("cron.board.completed", { id }, { dropIfSlow: true });
    }
    respond(true, { ok: resolved }, undefined);
  },

  "logs.view.initiate": async ({ params, respond, context }) => {
    try {
      const levels = Array.isArray(params?.levels) ? params.levels : undefined;
      const text = typeof params?.text === "string" ? params.text : undefined;
      const pending = createPendingLogsView();
      context.broadcast(
        "logs.view.requested",
        {
          id: pending.id,
          filters: { ...(levels ? { levels } : {}), ...(text ? { text } : {}) },
          createdAtMs: pending.createdAtMs,
          expiresAtMs: pending.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const result = await pending.promise;
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "logs.view.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing logs view id"));
      return;
    }
    const resolved = resolvePendingLogsView(id, { ok: true, dismissed: true });
    if (resolved) {
      context.broadcast("logs.view.completed", { id }, { dropIfSlow: true });
    }
    respond(true, { ok: resolved }, undefined);
  },

  "files.browser.initiate": async ({ params, respond, context }) => {
    try {
      const cfg = loadConfig();
      const list = cfg?.agents?.list ?? [];
      const agentId =
        (typeof params?.agentId === "string" ? params.agentId : null) ?? list[0]?.id ?? "main";
      const pending = createPendingFilesBrowser();
      context.broadcast(
        "files.browser.requested",
        {
          id: pending.id,
          agentId,
          createdAtMs: pending.createdAtMs,
          expiresAtMs: pending.expiresAtMs,
        },
        { dropIfSlow: true },
      );
      const result = await pending.promise;
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "files.browser.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing files browser id"));
      return;
    }
    const resolved = resolvePendingFilesBrowser(id, { ok: true, dismissed: true });
    if (resolved) {
      context.broadcast("files.browser.completed", { id }, { dropIfSlow: true });
    }
    respond(true, { ok: resolved }, undefined);
  },

  "channel.setup.initiate": async ({ params, respond, context }) => {
    try {
      const channel =
        typeof params?.channel === "string" ? params.channel.trim().toLowerCase() : "";
      if (!channel) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing channel name"));
        return;
      }
      const { loadChannelSetup } = await import("../../channels/setup/index.js");
      const mod = await loadChannelSetup(channel);
      if (!mod) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `No setup descriptor for channel: ${channel}`),
        );
        return;
      }
      const cfg = loadConfig();
      const accountId = typeof params.accountId === "string" ? params.accountId : undefined;
      const state = await mod.resolveState(cfg, accountId);
      const id = randomUUID();
      const now = Date.now();
      const expiresAtMs = now + 300_000;
      context.broadcast(
        "channel.setup.requested",
        {
          id,
          channel,
          descriptor: mod.descriptor,
          state,
          createdAtMs: now,
          expiresAtMs,
        },
        { dropIfSlow: true },
      );
      // Non-blocking: respond immediately so the agent doesn't timeout
      respond(
        true,
        {
          ok: true,
          opened: true,
          id,
          channel,
          configured: state.configured ?? false,
          linked: state.linked ?? false,
          message: `${mod.descriptor.title} overlay opened in browser. User is completing the setup wizard.`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "channel.setup.complete": async ({ params, respond, context }) => {
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing channel setup id"));
      return;
    }
    const cancelled = params?.cancelled === true;
    if (cancelled) {
      context.broadcast("channel.setup.completed", { id, cancelled: true }, { dropIfSlow: true });
      respond(true, { ok: true, cancelled: true }, undefined);
      return;
    }
    const channel = typeof params?.channel === "string" ? params.channel.trim().toLowerCase() : "";
    const answers = params?.answers && typeof params.answers === "object" ? params.answers : {};
    let writeResult = null;
    try {
      const { loadChannelSetup } = await import("../../channels/setup/index.js");
      const mod = await loadChannelSetup(channel);
      if (!mod) {
        writeResult = { ok: false, error: `No setup module for channel: ${channel}` };
      } else {
        const { readConfigFileSnapshot, writeConfigFile } = await import("../../config/io.js");
        const snapshot = await readConfigFileSnapshot();
        const cfg = snapshot.parsed;
        const accountId = typeof params.accountId === "string" ? params.accountId : undefined;
        const state = await mod.resolveState(cfg, accountId);
        const updated = await mod.apply(cfg, answers, state);
        await writeConfigFile(updated);
        // Re-resolve to get post-apply metadata (e.g. botUsername)
        const postState = await mod.resolveState(updated, accountId).catch(() => null);
        writeResult = {
          ok: true,
          ...(postState?.botUsername ? { botUsername: postState.botUsername } : {}),
        };
      }
    } catch (err) {
      writeResult = { ok: false, error: formatForLog(err) };
    }
    context.broadcast(
      "channel.setup.completed",
      { id, channel, ...(writeResult ? { writeResult } : {}) },
      { dropIfSlow: true },
    );
    respond(
      true,
      { ok: writeResult?.ok ?? false, ...(writeResult ? { writeResult } : {}) },
      undefined,
    );
  },

  "channel.pairing.approve": async ({ params, respond }) => {
    const channel = typeof params?.channel === "string" ? params.channel.trim().toLowerCase() : "";
    const code = typeof params?.code === "string" ? params.code.trim() : "";
    if (!channel || !code) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Missing channel or code"));
      return;
    }
    try {
      const { approveChannelPairingCode } = await import("../../pairing/pairing-store.js");
      const accountId = typeof params.accountId === "string" ? params.accountId.trim() : undefined;
      const approved = await approveChannelPairingCode({
        channel,
        code,
        ...(accountId ? { accountId } : {}),
      });
      if (!approved) {
        respond(
          true,
          { ok: false, error: "No pending pairing request found for that code." },
          undefined,
        );
        return;
      }
      // Also persist approved ID in config allowFrom so the agent can resolve targets
      try {
        const { readConfigFileSnapshot, writeConfigFile } = await import("../../config/io.js");
        const snapshot = await readConfigFileSnapshot();
        const cfg = snapshot.parsed ?? {};
        const channelCfg = cfg.channels?.[channel];
        if (channelCfg) {
          const existing = Array.isArray(channelCfg.allowFrom) ? channelCfg.allowFrom : [];
          if (!existing.includes(approved.id)) {
            await writeConfigFile({
              ...cfg,
              channels: {
                ...cfg.channels,
                [channel]: { ...channelCfg, allowFrom: [...existing, approved.id] },
              },
            });
          }
        }
      } catch {
        /* best-effort — store already has it */
      }
      respond(true, { ok: true, id: approved.id }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },
};
