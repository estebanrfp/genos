let parseMemoryDateFromPath = function (filePath) {
    const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
    const match = DATED_MEMORY_PATH_RE.exec(normalized);
    if (!match) {
      return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }
    return parsed;
  },
  isEvergreenMemoryPath = function (filePath) {
    const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
    if (normalized === "MEMORY.md" || normalized === "memory.md") {
      return true;
    }
    if (!normalized.startsWith("memory/")) {
      return false;
    }
    return !DATED_MEMORY_PATH_RE.test(normalized);
  },
  ageInDaysFromTimestamp = function (timestamp, nowMs) {
    const ageMs = Math.max(0, nowMs - timestamp.getTime());
    return ageMs / DAY_MS;
  };
import fs from "node:fs/promises";
import path from "node:path";
export const DEFAULT_TEMPORAL_DECAY_CONFIG = {
  enabled: false,
  halfLifeDays: 30,
};
const DAY_MS = 86400000;
const DATED_MEMORY_PATH_RE = /(?:^|\/)memory\/(\d{4})-(\d{2})-(\d{2})\.md$/;
export function toDecayLambda(halfLifeDays) {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    return 0;
  }
  return Math.LN2 / halfLifeDays;
}
export function calculateTemporalDecayMultiplier(params) {
  const lambda = toDecayLambda(params.halfLifeDays);
  const clampedAge = Math.max(0, params.ageInDays);
  if (lambda <= 0 || !Number.isFinite(clampedAge)) {
    return 1;
  }
  return Math.exp(-lambda * clampedAge);
}
export function applyTemporalDecayToScore(params) {
  return params.score * calculateTemporalDecayMultiplier(params);
}
async function extractTimestamp(params) {
  const fromPath = parseMemoryDateFromPath(params.filePath);
  if (fromPath) {
    return fromPath;
  }
  if (params.source === "memory" && isEvergreenMemoryPath(params.filePath)) {
    return null;
  }
  if (!params.workspaceDir) {
    return null;
  }
  const absolutePath = path.isAbsolute(params.filePath)
    ? params.filePath
    : path.resolve(params.workspaceDir, params.filePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (!Number.isFinite(stat.mtimeMs)) {
      return null;
    }
    return new Date(stat.mtimeMs);
  } catch {
    return null;
  }
}
export async function applyTemporalDecayToHybridResults(params) {
  const config = { ...DEFAULT_TEMPORAL_DECAY_CONFIG, ...params.temporalDecay };
  if (!config.enabled) {
    return [...params.results];
  }
  const nowMs = params.nowMs ?? Date.now();
  const timestampPromiseCache = new Map();
  return Promise.all(
    params.results.map(async (entry) => {
      const cacheKey = `${entry.source}:${entry.path}`;
      let timestampPromise = timestampPromiseCache.get(cacheKey);
      if (!timestampPromise) {
        timestampPromise = extractTimestamp({
          filePath: entry.path,
          source: entry.source,
          workspaceDir: params.workspaceDir,
        });
        timestampPromiseCache.set(cacheKey, timestampPromise);
      }
      const timestamp = await timestampPromise;
      if (!timestamp) {
        return entry;
      }
      const decayedScore = applyTemporalDecayToScore({
        score: entry.score,
        ageInDays: ageInDaysFromTimestamp(timestamp, nowMs),
        halfLifeDays: config.halfLifeDays,
      });
      return {
        ...entry,
        score: decayedScore,
      };
    }),
  );
}
