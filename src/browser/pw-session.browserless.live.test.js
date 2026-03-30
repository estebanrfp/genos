import { describe, expect, it } from "vitest";
import { isTruthyEnvValue } from "../infra/env.js";
const LIVE = isTruthyEnvValue(process.env.LIVE) || isTruthyEnvValue(process.env.GENOS_LIVE_TEST);
const CDP_URL = process.env.GENOS_LIVE_BROWSER_CDP_URL?.trim() || "";
const describeLive = LIVE && CDP_URL ? describe : describe.skip;
async function waitFor(fn, opts) {
  await expect.poll(fn, { timeout: opts.timeoutMs, interval: opts.intervalMs }).toBe(true);
}
describeLive("browser (live): remote CDP tab persistence", () => {
  it("creates, lists, focuses, and closes tabs via Playwright", { timeout: 60000 }, async () => {
    const pw = await import("./pw-ai.js");
    await pw.closePlaywrightBrowserConnection().catch(() => {});
    const created = await pw.createPageViaPlaywright({ cdpUrl: CDP_URL, url: "about:blank" });
    try {
      await waitFor(
        async () => {
          const pages = await pw.listPagesViaPlaywright({ cdpUrl: CDP_URL });
          return pages.some((p) => p.targetId === created.targetId);
        },
        { timeoutMs: 1e4, intervalMs: 250 },
      );
      await pw.focusPageByTargetIdViaPlaywright({ cdpUrl: CDP_URL, targetId: created.targetId });
      await pw.closePageByTargetIdViaPlaywright({ cdpUrl: CDP_URL, targetId: created.targetId });
      await waitFor(
        async () => {
          const pages = await pw.listPagesViaPlaywright({ cdpUrl: CDP_URL });
          return !pages.some((p) => p.targetId === created.targetId);
        },
        { timeoutMs: 1e4, intervalMs: 250 },
      );
    } finally {
      await pw.closePlaywrightBrowserConnection().catch(() => {});
    }
  });
});
