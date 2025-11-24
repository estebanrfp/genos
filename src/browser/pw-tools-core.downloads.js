let sanitizeDownloadFileName = function (fileName) {
    const trimmed = String(fileName ?? "").trim();
    if (!trimmed) {
      return "download.bin";
    }
    let base = path.posix.basename(trimmed);
    base = path.win32.basename(base);
    let cleaned = "";
    for (let i = 0; i < base.length; i++) {
      const code = base.charCodeAt(i);
      if (code < 32 || code === 127) {
        continue;
      }
      cleaned += base[i];
    }
    base = cleaned.trim();
    if (!base || base === "." || base === "..") {
      return "download.bin";
    }
    if (base.length > 200) {
      base = base.slice(0, 200);
    }
    return base;
  },
  buildTempDownloadPath = function (fileName) {
    const id = crypto.randomUUID();
    const safeName = sanitizeDownloadFileName(fileName);
    return path.join(resolvePreferredGenosOSTmpDir(), "downloads", `${id}-${safeName}`);
  },
  createPageDownloadWaiter = function (page, timeoutMs) {
    let done = false;
    let timer;
    let handler;
    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = undefined;
      if (handler) {
        page.off("download", handler);
        handler = undefined;
      }
    };
    const promise = new Promise((resolve, reject) => {
      handler = (download) => {
        if (done) {
          return;
        }
        done = true;
        cleanup();
        resolve(download);
      };
      page.on("download", handler);
      timer = setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        cleanup();
        reject(new Error("Timeout waiting for download"));
      }, timeoutMs);
    });
    return {
      promise,
      cancel: () => {
        if (done) {
          return;
        }
        done = true;
        cleanup();
      },
    };
  };
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolvePreferredGenosOSTmpDir } from "../infra/tmp-genosos-dir.js";
import {
  ensurePageState,
  getPageForTargetId,
  refLocator,
  restoreRoleRefsForTarget,
} from "./pw-session.js";
import {
  bumpDialogArmId,
  bumpDownloadArmId,
  bumpUploadArmId,
  normalizeTimeoutMs,
  requireRef,
  toAIFriendlyError,
} from "./pw-tools-core.shared.js";
async function saveDownloadPayload(download, outPath) {
  const suggested = download.suggestedFilename?.() || "download.bin";
  const resolvedOutPath = outPath?.trim() || buildTempDownloadPath(suggested);
  await fs.mkdir(path.dirname(resolvedOutPath), { recursive: true });
  await download.saveAs?.(resolvedOutPath);
  return {
    url: download.url?.() || "",
    suggestedFilename: suggested,
    path: path.resolve(resolvedOutPath),
  };
}
async function awaitDownloadPayload(params) {
  try {
    const download = await params.waiter.promise;
    if (params.state.armIdDownload !== params.armId) {
      throw new Error("Download was superseded by another waiter");
    }
    return await saveDownloadPayload(download, params.outPath ?? "");
  } catch (err) {
    params.waiter.cancel();
    throw err;
  }
}
export async function armFileUploadViaPlaywright(opts) {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  const timeout = Math.max(500, Math.min(120000, opts.timeoutMs ?? 120000));
  state.armIdUpload = bumpUploadArmId();
  const armId = state.armIdUpload;
  page
    .waitForEvent("filechooser", { timeout })
    .then(async (fileChooser) => {
      if (state.armIdUpload !== armId) {
        return;
      }
      if (!opts.paths?.length) {
        try {
          await page.keyboard.press("Escape");
        } catch {}
        return;
      }
      await fileChooser.setFiles(opts.paths);
      try {
        const input =
          typeof fileChooser.element === "function"
            ? await Promise.resolve(fileChooser.element())
            : null;
        if (input) {
          await input.evaluate((el) => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          });
        }
      } catch {}
    })
    .catch(() => {});
}
export async function armDialogViaPlaywright(opts) {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 120000);
  state.armIdDialog = bumpDialogArmId();
  const armId = state.armIdDialog;
  page
    .waitForEvent("dialog", { timeout })
    .then(async (dialog) => {
      if (state.armIdDialog !== armId) {
        return;
      }
      if (opts.accept) {
        await dialog.accept(opts.promptText);
      } else {
        await dialog.dismiss();
      }
    })
    .catch(() => {});
}
export async function waitForDownloadViaPlaywright(opts) {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 120000);
  state.armIdDownload = bumpDownloadArmId();
  const armId = state.armIdDownload;
  const waiter = createPageDownloadWaiter(page, timeout);
  return await awaitDownloadPayload({ waiter, state, armId, outPath: opts.path });
}
export async function downloadViaPlaywright(opts) {
  const page = await getPageForTargetId(opts);
  const state = ensurePageState(page);
  restoreRoleRefsForTarget({ cdpUrl: opts.cdpUrl, targetId: opts.targetId, page });
  const timeout = normalizeTimeoutMs(opts.timeoutMs, 120000);
  const ref = requireRef(opts.ref);
  const outPath = String(opts.path ?? "").trim();
  if (!outPath) {
    throw new Error("path is required");
  }
  state.armIdDownload = bumpDownloadArmId();
  const armId = state.armIdDownload;
  const waiter = createPageDownloadWaiter(page, timeout);
  try {
    const locator = refLocator(page, ref);
    try {
      await locator.click({ timeout });
    } catch (err) {
      throw toAIFriendlyError(err, ref);
    }
    return await awaitDownloadPayload({ waiter, state, armId, outPath });
  } catch (err) {
    waiter.cancel();
    throw err;
  }
}
