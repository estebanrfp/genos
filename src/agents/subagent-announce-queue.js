let getAnnounceQueue = function (key, settings, send) {
    const existing = ANNOUNCE_QUEUES.get(key);
    if (existing) {
      applyQueueRuntimeSettings({
        target: existing,
        settings,
      });
      existing.send = send;
      return existing;
    }
    const created = {
      items: [],
      draining: false,
      lastEnqueuedAt: 0,
      mode: settings.mode,
      debounceMs: typeof settings.debounceMs === "number" ? Math.max(0, settings.debounceMs) : 1000,
      cap: typeof settings.cap === "number" && settings.cap > 0 ? Math.floor(settings.cap) : 20,
      dropPolicy: settings.dropPolicy ?? "summarize",
      droppedCount: 0,
      summaryLines: [],
      send,
    };
    applyQueueRuntimeSettings({
      target: created,
      settings,
    });
    ANNOUNCE_QUEUES.set(key, created);
    return created;
  },
  scheduleAnnounceDrain = function (key) {
    const queue = ANNOUNCE_QUEUES.get(key);
    if (!queue || queue.draining) {
      return;
    }
    queue.draining = true;
    (async () => {
      try {
        let forceIndividualCollect = false;
        while (queue.items.length > 0 || queue.droppedCount > 0) {
          await waitForQueueDebounce(queue);
          if (queue.mode === "collect") {
            const isCrossChannel = hasCrossChannelItems(queue.items, (item) => {
              if (!item.origin) {
                return {};
              }
              if (!item.originKey) {
                return { cross: true };
              }
              return { key: item.originKey };
            });
            const collectDrainResult = await drainCollectItemIfNeeded({
              forceIndividualCollect,
              isCrossChannel,
              setForceIndividualCollect: (next) => {
                forceIndividualCollect = next;
              },
              items: queue.items,
              run: async (item) => await queue.send(item),
            });
            if (collectDrainResult === "empty") {
              break;
            }
            if (collectDrainResult === "drained") {
              continue;
            }
            const items = queue.items.slice();
            const summary = previewQueueSummaryPrompt({ state: queue, noun: "announce" });
            const prompt = buildCollectPrompt({
              title: "[Queued announce messages while agent was busy]",
              items,
              summary,
              renderItem: (item, idx) => `---\nQueued #${idx + 1}\n${item.prompt}`.trim(),
            });
            const last = items.at(-1);
            if (!last) {
              break;
            }
            await queue.send({ ...last, prompt });
            queue.items.splice(0, items.length);
            if (summary) {
              clearQueueSummaryState(queue);
            }
            continue;
          }
          const summaryPrompt = previewQueueSummaryPrompt({ state: queue, noun: "announce" });
          if (summaryPrompt) {
            if (
              !(await drainNextQueueItem(
                queue.items,
                async (item) => await queue.send({ ...item, prompt: summaryPrompt }),
              ))
            ) {
              break;
            }
            clearQueueSummaryState(queue);
            continue;
          }
          if (!(await drainNextQueueItem(queue.items, async (item) => await queue.send(item)))) {
            break;
          }
        }
      } catch (err) {
        queue.lastEnqueuedAt = Date.now();
        defaultRuntime.error?.(`announce queue drain failed for ${key}: ${String(err)}`);
      } finally {
        queue.draining = false;
        if (queue.items.length === 0 && queue.droppedCount === 0) {
          ANNOUNCE_QUEUES.delete(key);
        } else {
          scheduleAnnounceDrain(key);
        }
      }
    })();
  };
import { defaultRuntime } from "../runtime.js";
import { deliveryContextKey, normalizeDeliveryContext } from "../utils/delivery-context.js";
import {
  applyQueueRuntimeSettings,
  applyQueueDropPolicy,
  buildCollectPrompt,
  clearQueueSummaryState,
  drainCollectItemIfNeeded,
  drainNextQueueItem,
  hasCrossChannelItems,
  previewQueueSummaryPrompt,
  waitForQueueDebounce,
} from "../utils/queue-helpers.js";
const ANNOUNCE_QUEUES = new Map();
export function resetAnnounceQueuesForTests() {
  for (const queue of ANNOUNCE_QUEUES.values()) {
    queue.items.length = 0;
    queue.summaryLines.length = 0;
    queue.droppedCount = 0;
    queue.lastEnqueuedAt = 0;
  }
  ANNOUNCE_QUEUES.clear();
}
export function enqueueAnnounce(params) {
  const queue = getAnnounceQueue(params.key, params.settings, params.send);
  queue.lastEnqueuedAt = Date.now();
  const shouldEnqueue = applyQueueDropPolicy({
    queue,
    summarize: (item) => item.summaryLine?.trim() || item.prompt.trim(),
  });
  if (!shouldEnqueue) {
    if (queue.dropPolicy === "new") {
      scheduleAnnounceDrain(params.key);
    }
    return false;
  }
  const origin = normalizeDeliveryContext(params.item.origin);
  const originKey = deliveryContextKey(origin);
  queue.items.push({ ...params.item, origin, originKey });
  scheduleAnnounceDrain(params.key);
  return true;
}
