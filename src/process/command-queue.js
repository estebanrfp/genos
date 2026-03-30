let getLaneState = function (lane) {
    const existing = lanes.get(lane);
    if (existing) {
      return existing;
    }
    const created = {
      lane,
      queue: [],
      activeTaskIds: new Set(),
      maxConcurrent: 1,
      draining: false,
      generation: 0,
    };
    lanes.set(lane, created);
    return created;
  },
  completeTask = function (state, taskId, taskGeneration) {
    if (taskGeneration !== state.generation) {
      return false;
    }
    state.activeTaskIds.delete(taskId);
    return true;
  },
  drainLane = function (lane) {
    const state = getLaneState(lane);
    if (state.draining) {
      return;
    }
    state.draining = true;
    const pump = () => {
      while (state.activeTaskIds.size < state.maxConcurrent && state.queue.length > 0) {
        const entry = state.queue.shift();
        const waitedMs = Date.now() - entry.enqueuedAt;
        if (waitedMs >= entry.warnAfterMs) {
          entry.onWait?.(waitedMs, state.queue.length);
          diag.warn(
            `lane wait exceeded: lane=${lane} waitedMs=${waitedMs} queueAhead=${state.queue.length}`,
          );
        }
        logLaneDequeue(lane, waitedMs, state.queue.length);
        const taskId = nextTaskId++;
        const taskGeneration = state.generation;
        state.activeTaskIds.add(taskId);
        (async () => {
          const startTime = Date.now();
          try {
            const result = await entry.task();
            const completedCurrentGeneration = completeTask(state, taskId, taskGeneration);
            if (completedCurrentGeneration) {
              diag.debug(
                `lane task done: lane=${lane} durationMs=${Date.now() - startTime} active=${state.activeTaskIds.size} queued=${state.queue.length}`,
              );
              pump();
            }
            entry.resolve(result);
          } catch (err) {
            const completedCurrentGeneration = completeTask(state, taskId, taskGeneration);
            const isProbeLane = lane.startsWith("auth-probe:") || lane.startsWith("session:probe-");
            if (!isProbeLane) {
              diag.error(
                `lane task error: lane=${lane} durationMs=${Date.now() - startTime} error="${String(err)}"`,
              );
            }
            if (completedCurrentGeneration) {
              pump();
            }
            entry.reject(err);
          }
        })();
      }
      state.draining = false;
    };
    pump();
  };
import { diagnosticLogger as diag, logLaneDequeue, logLaneEnqueue } from "../logging/diagnostic.js";
import { CommandLane } from "./lanes.js";

export class CommandLaneClearedError extends Error {
  constructor(lane) {
    super(lane ? `Command lane "${lane}" cleared` : "Command lane cleared");
    this.name = "CommandLaneClearedError";
  }
}
const lanes = new Map();
let nextTaskId = 1;
export function setCommandLaneConcurrency(lane, maxConcurrent) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = getLaneState(cleaned);
  state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
  drainLane(cleaned);
}
export function enqueueCommandInLane(lane, task, opts) {
  const cleaned = lane.trim() || CommandLane.Main;
  const warnAfterMs = opts?.warnAfterMs ?? 2000;
  const state = getLaneState(cleaned);
  return new Promise((resolve, reject) => {
    state.queue.push({
      task: () => task(),
      resolve: (value) => resolve(value),
      reject,
      enqueuedAt: Date.now(),
      warnAfterMs,
      onWait: opts?.onWait,
    });
    logLaneEnqueue(cleaned, state.queue.length + state.activeTaskIds.size);
    drainLane(cleaned);
  });
}
export function enqueueCommand(task, opts) {
  return enqueueCommandInLane(CommandLane.Main, task, opts);
}
export function getQueueSize(lane = CommandLane.Main) {
  const resolved = lane.trim() || CommandLane.Main;
  const state = lanes.get(resolved);
  if (!state) {
    return 0;
  }
  return state.queue.length + state.activeTaskIds.size;
}
export function getTotalQueueSize() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.queue.length + s.activeTaskIds.size;
  }
  return total;
}
export function clearCommandLane(lane = CommandLane.Main) {
  const cleaned = lane.trim() || CommandLane.Main;
  const state = lanes.get(cleaned);
  if (!state) {
    return 0;
  }
  const removed = state.queue.length;
  const pending = state.queue.splice(0);
  for (const entry of pending) {
    entry.reject(new CommandLaneClearedError(cleaned));
  }
  return removed;
}
export function resetAllLanes() {
  const lanesToDrain = [];
  for (const state of lanes.values()) {
    state.generation += 1;
    state.activeTaskIds.clear();
    state.draining = false;
    if (state.queue.length > 0) {
      lanesToDrain.push(state.lane);
    }
  }
  for (const lane of lanesToDrain) {
    drainLane(lane);
  }
}
export function getActiveTaskCount() {
  let total = 0;
  for (const s of lanes.values()) {
    total += s.activeTaskIds.size;
  }
  return total;
}
export function waitForActiveTasks(timeoutMs) {
  const POLL_INTERVAL_MS = 50;
  const deadline = Date.now() + timeoutMs;
  const activeAtStart = new Set();
  for (const state of lanes.values()) {
    for (const taskId of state.activeTaskIds) {
      activeAtStart.add(taskId);
    }
  }
  return new Promise((resolve) => {
    const check = () => {
      if (activeAtStart.size === 0) {
        resolve({ drained: true });
        return;
      }
      let hasPending = false;
      for (const state of lanes.values()) {
        for (const taskId of state.activeTaskIds) {
          if (activeAtStart.has(taskId)) {
            hasPending = true;
            break;
          }
        }
        if (hasPending) {
          break;
        }
      }
      if (!hasPending) {
        resolve({ drained: true });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ drained: false });
        return;
      }
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}
