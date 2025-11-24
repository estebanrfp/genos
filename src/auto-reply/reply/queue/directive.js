let parseQueueDebounce = function (raw) {
    if (!raw) {
      return;
    }
    try {
      const parsed = parseDurationMs(raw.trim(), { defaultUnit: "ms" });
      if (!parsed || parsed < 0) {
        return;
      }
      return Math.round(parsed);
    } catch {
      return;
    }
  },
  parseQueueCap = function (raw) {
    if (!raw) {
      return;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) {
      return;
    }
    const cap = Math.floor(num);
    if (cap < 1) {
      return;
    }
    return cap;
  },
  parseQueueDirectiveArgs = function (raw) {
    const len = raw.length;
    let i = skipDirectiveArgPrefix(raw);
    let consumed = i;
    let queueMode;
    let queueReset = false;
    let rawMode;
    let debounceMs;
    let cap;
    let dropPolicy;
    let rawDebounce;
    let rawCap;
    let rawDrop;
    let hasOptions = false;
    const takeToken = () => {
      const res = takeDirectiveToken(raw, i);
      i = res.nextIndex;
      return res.token;
    };
    while (i < len) {
      const token = takeToken();
      if (!token) {
        break;
      }
      const lowered = token.trim().toLowerCase();
      if (lowered === "default" || lowered === "reset" || lowered === "clear") {
        queueReset = true;
        consumed = i;
        break;
      }
      if (lowered.startsWith("debounce:") || lowered.startsWith("debounce=")) {
        rawDebounce = token.split(/[:=]/)[1] ?? "";
        debounceMs = parseQueueDebounce(rawDebounce);
        hasOptions = true;
        consumed = i;
        continue;
      }
      if (lowered.startsWith("cap:") || lowered.startsWith("cap=")) {
        rawCap = token.split(/[:=]/)[1] ?? "";
        cap = parseQueueCap(rawCap);
        hasOptions = true;
        consumed = i;
        continue;
      }
      if (lowered.startsWith("drop:") || lowered.startsWith("drop=")) {
        rawDrop = token.split(/[:=]/)[1] ?? "";
        dropPolicy = normalizeQueueDropPolicy(rawDrop);
        hasOptions = true;
        consumed = i;
        continue;
      }
      const mode = normalizeQueueMode(token);
      if (mode) {
        queueMode = mode;
        rawMode = token;
        consumed = i;
        continue;
      }
      break;
    }
    return {
      consumed,
      queueMode,
      queueReset,
      rawMode,
      debounceMs,
      cap,
      dropPolicy,
      rawDebounce,
      rawCap,
      rawDrop,
      hasOptions,
    };
  };
import { parseDurationMs } from "../../../cli/parse-duration.js";
import { skipDirectiveArgPrefix, takeDirectiveToken } from "../directive-parsing.js";
import { normalizeQueueDropPolicy, normalizeQueueMode } from "./normalize.js";
export function extractQueueDirective(body) {
  if (!body) {
    return {
      cleaned: "",
      hasDirective: false,
      queueReset: false,
      hasOptions: false,
    };
  }
  const re = /(?:^|\s)\/queue(?=$|\s|:)/i;
  const match = re.exec(body);
  if (!match) {
    return {
      cleaned: body.trim(),
      hasDirective: false,
      queueReset: false,
      hasOptions: false,
    };
  }
  const start = match.index + match[0].indexOf("/queue");
  const argsStart = start + "/queue".length;
  const args = body.slice(argsStart);
  const parsed = parseQueueDirectiveArgs(args);
  const cleanedRaw = `${body.slice(0, start)} ${body.slice(argsStart + parsed.consumed)}`;
  const cleaned = cleanedRaw.replace(/\s+/g, " ").trim();
  return {
    cleaned,
    queueMode: parsed.queueMode,
    queueReset: parsed.queueReset,
    rawMode: parsed.rawMode,
    debounceMs: parsed.debounceMs,
    cap: parsed.cap,
    dropPolicy: parsed.dropPolicy,
    rawDebounce: parsed.rawDebounce,
    rawCap: parsed.rawCap,
    rawDrop: parsed.rawDrop,
    hasDirective: true,
    hasOptions: parsed.hasOptions,
  };
}
