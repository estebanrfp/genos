let stripExistingContext = function (text) {
    const index = text.indexOf(REMINDER_CONTEXT_MARKER);
    if (index === -1) {
      return text;
    }
    return text.slice(0, index).trim();
  },
  truncateText = function (input, maxLen) {
    if (input.length <= maxLen) {
      return input;
    }
    const truncated = truncateUtf16Safe(input, Math.max(0, maxLen - 3)).trimEnd();
    return `${truncated}...`;
  },
  extractMessageText = function (message) {
    const role = typeof message.role === "string" ? message.role : "";
    if (role !== "user" && role !== "assistant") {
      return null;
    }
    const text = extractTextFromChatContent(message.content);
    return text ? { role, text } : null;
  },
  stripThreadSuffixFromSessionKey = function (sessionKey) {
    const normalized = sessionKey.toLowerCase();
    const idx = normalized.lastIndexOf(":thread:");
    if (idx <= 0) {
      return sessionKey;
    }
    const parent = sessionKey.slice(0, idx).trim();
    return parent ? parent : sessionKey;
  },
  inferDeliveryFromSessionKey = function (agentSessionKey) {
    const rawSessionKey = agentSessionKey?.trim();
    if (!rawSessionKey) {
      return null;
    }
    const parsed = parseAgentSessionKey(stripThreadSuffixFromSessionKey(rawSessionKey));
    if (!parsed || !parsed.rest) {
      return null;
    }
    const parts = parsed.rest.split(":").filter(Boolean);
    if (parts.length === 0) {
      return null;
    }
    const head = parts[0]?.trim().toLowerCase();
    if (!head || head === "main" || head === "subagent" || head === "acp") {
      return null;
    }
    const markerIndex = parts.findIndex(
      (part) => part === "direct" || part === "dm" || part === "group" || part === "channel",
    );
    if (markerIndex === -1) {
      return null;
    }
    const peerId = parts
      .slice(markerIndex + 1)
      .join(":")
      .trim();
    if (!peerId) {
      return null;
    }
    let channel;
    if (markerIndex >= 1) {
      channel = parts[0]?.trim().toLowerCase();
    }
    const delivery = { mode: "announce", to: peerId };
    if (channel) {
      delivery.channel = channel;
    }
    return delivery;
  };
import { Type } from "@sinclair/typebox";
import { loadConfig } from "../../config/config.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import { normalizeHttpWebhookUrl } from "../../cron/webhook-url.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { extractTextFromChatContent } from "../../shared/chat-content.js";
import { isRecord, truncateUtf16Safe } from "../../utils.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { optionalStringEnum, stringEnum } from "../schema/typebox.js";
import { jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";
const CRON_ACTIONS = ["status", "list", "add", "update", "remove", "run", "runs", "wake"];
const CRON_WAKE_MODES = ["now", "next-heartbeat"];
const CRON_RUN_MODES = ["due", "force"];
const REMINDER_CONTEXT_MESSAGES_MAX = 10;
const REMINDER_CONTEXT_PER_MESSAGE_MAX = 220;
const REMINDER_CONTEXT_TOTAL_MAX = 700;
const REMINDER_CONTEXT_MARKER = "\n\nRecent context:\n";
const CronToolSchema = Type.Object({
  action: stringEnum(CRON_ACTIONS),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  includeDisabled: Type.Optional(Type.Boolean()),
  job: Type.Optional(Type.Object({}, { additionalProperties: true })),
  jobId: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  patch: Type.Optional(Type.Object({}, { additionalProperties: true })),
  text: Type.Optional(Type.String()),
  mode: optionalStringEnum(CRON_WAKE_MODES),
  runMode: optionalStringEnum(CRON_RUN_MODES),
  contextMessages: Type.Optional(
    Type.Number({ minimum: 0, maximum: REMINDER_CONTEXT_MESSAGES_MAX }),
  ),
});
async function buildReminderContextLines(params) {
  const maxMessages = Math.min(
    REMINDER_CONTEXT_MESSAGES_MAX,
    Math.max(0, Math.floor(params.contextMessages)),
  );
  if (maxMessages <= 0) {
    return [];
  }
  const sessionKey = params.agentSessionKey?.trim();
  if (!sessionKey) {
    return [];
  }
  const cfg = loadConfig();
  const { mainKey, alias } = resolveMainSessionAlias(cfg);
  const resolvedKey = resolveInternalSessionKey({ key: sessionKey, alias, mainKey });
  try {
    const res = await callGatewayTool("chat.history", params.gatewayOpts, {
      sessionKey: resolvedKey,
      limit: maxMessages,
    });
    const messages = Array.isArray(res?.messages) ? res.messages : [];
    const parsed = messages.map((msg) => extractMessageText(msg)).filter((msg) => Boolean(msg));
    const recent = parsed.slice(-maxMessages);
    if (recent.length === 0) {
      return [];
    }
    const lines = [];
    let total = 0;
    for (const entry of recent) {
      const label = entry.role === "user" ? "User" : "Assistant";
      const text = truncateText(entry.text, REMINDER_CONTEXT_PER_MESSAGE_MAX);
      const line = `- ${label}: ${text}`;
      total += line.length;
      if (total > REMINDER_CONTEXT_TOTAL_MAX) {
        break;
      }
      lines.push(line);
    }
    return lines;
  } catch {
    return [];
  }
}
export function createCronTool(opts) {
  return {
    label: "Cron",
    name: "cron",
    description: `Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events. This is the ONLY tool for cron operations — call it exactly once per operation.

ACTIONS:
- status: Check cron scheduler status
- list: List jobs (use includeDisabled:true to include disabled)
- add: Create job (requires job object, see schema below)
- update: Modify job (requires jobId + patch object)
- remove: Delete job (requires jobId)
- run: Trigger job immediately (requires jobId)
- runs: Get job run history (requires jobId)
- wake: Send wake event (requires text, optional mode)

JOB SCHEMA (for add action):
{
  "name": "string (optional)",
  "schedule": { ... },      // Required: when to run
  "payload": { ... },       // Required: what to execute
  "delivery": { ... },      // Optional: announce summary or webhook POST
  "sessionTarget": "main" | "isolated",  // Required
  "enabled": true | false   // Optional, default true
}

SCHEDULE TYPES (schedule.kind):
- "at": One-shot at absolute time
  { "kind": "at", "at": "<ISO-8601 timestamp>" }
- "every": Recurring interval
  { "kind": "every", "everyMs": <interval-ms>, "anchorMs": <optional-start-ms> }
- "cron": Cron expression
  { "kind": "cron", "expr": "<cron-expression>", "tz": "<optional-timezone>" }

ISO timestamps without an explicit timezone are treated as UTC.

PAYLOAD TYPES (payload.kind):
- "systemEvent": Injects text as system event into session
  { "kind": "systemEvent", "text": "<message>" }
- "agentTurn": Runs agent with message (isolated sessions only)
  { "kind": "agentTurn", "message": "<prompt>", "model": "<optional>", "thinking": "<optional>", "timeoutSeconds": <optional, 0 means no timeout> }

DELIVERY (top-level):
  { "mode": "none|announce|webhook", "channel": "<optional>", "to": "<optional>", "bestEffort": <optional-bool> }
  - Default for isolated agentTurn jobs (when delivery omitted): "announce"
  - announce: send to chat channel (optional channel/to target)
  - webhook: send finished-run event as HTTP POST to delivery.to (URL required)
  - If the task needs to send to a specific chat/recipient, set announce delivery.channel/to; do not call messaging tools inside the run.

CRITICAL CONSTRAINTS:
- sessionTarget="main" REQUIRES payload.kind="systemEvent"
- sessionTarget="isolated" REQUIRES payload.kind="agentTurn"
- For webhook callbacks, use delivery.mode="webhook" with delivery.to set to a URL.
Default: prefer isolated agentTurn jobs unless the user explicitly wants a main-session system event.

WAKE MODES (for wake action):
- "next-heartbeat" (default): Wake on next heartbeat
- "now": Wake immediately

Use jobId as the canonical identifier; id is accepted for compatibility. Use contextMessages (0-10) to add previous messages as context to the job text.

REMINDERS:
For reminders: write systemEvent text as the reminder message itself (include context).
Mention that it is a reminder if the delay is significant.
Include recent conversation context when appropriate.`,
    parameters: CronToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = {
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 60000,
      };
      switch (action) {
        case "status":
          return jsonResult(await callGatewayTool("cron.status", gatewayOpts, {}));
        case "list":
          return jsonResult(
            await callGatewayTool("cron.list", gatewayOpts, {
              includeDisabled: Boolean(params.includeDisabled),
            }),
          );
        case "add": {
          if (
            !params.job ||
            (typeof params.job === "object" &&
              params.job !== null &&
              Object.keys(params.job).length === 0)
          ) {
            const JOB_KEYS = new Set([
              "name",
              "schedule",
              "sessionTarget",
              "wakeMode",
              "payload",
              "delivery",
              "enabled",
              "description",
              "deleteAfterRun",
              "agentId",
              "sessionKey",
              "message",
              "text",
              "model",
              "thinking",
              "timeoutSeconds",
              "allowUnsafeExternalContent",
            ]);
            const synthetic = {};
            let found = false;
            for (const key of Object.keys(params)) {
              if (JOB_KEYS.has(key) && params[key] !== undefined) {
                synthetic[key] = params[key];
                found = true;
              }
            }
            if (
              found &&
              (synthetic.schedule !== undefined ||
                synthetic.payload !== undefined ||
                synthetic.message !== undefined ||
                synthetic.text !== undefined)
            ) {
              params.job = synthetic;
            }
          }
          if (!params.job || typeof params.job !== "object") {
            throw new Error("job required");
          }
          const job = normalizeCronJobCreate(params.job) ?? params.job;
          if (job && typeof job === "object") {
            const cfg = loadConfig();
            const { mainKey, alias } = resolveMainSessionAlias(cfg);
            const resolvedSessionKey = opts?.agentSessionKey
              ? resolveInternalSessionKey({ key: opts.agentSessionKey, alias, mainKey })
              : undefined;
            if (!("agentId" in job)) {
              const agentId = opts?.agentSessionKey
                ? resolveSessionAgentId({ sessionKey: opts.agentSessionKey, config: cfg })
                : undefined;
              if (agentId) {
                job.agentId = agentId;
              }
            }
            if (!("sessionKey" in job) && resolvedSessionKey) {
              job.sessionKey = resolvedSessionKey;
            }
          }
          if (
            opts?.agentSessionKey &&
            job &&
            typeof job === "object" &&
            "payload" in job &&
            job.payload?.kind === "agentTurn"
          ) {
            const deliveryValue = job.delivery;
            const delivery = isRecord(deliveryValue) ? deliveryValue : undefined;
            const modeRaw = typeof delivery?.mode === "string" ? delivery.mode : "";
            const mode = modeRaw.trim().toLowerCase();
            if (mode === "webhook") {
              const webhookUrl = normalizeHttpWebhookUrl(delivery?.to);
              if (!webhookUrl) {
                throw new Error(
                  'delivery.mode="webhook" requires delivery.to to be a valid http(s) URL',
                );
              }
              if (delivery) {
                delivery.to = webhookUrl;
              }
            }
            const hasTarget =
              (typeof delivery?.channel === "string" && delivery.channel.trim()) ||
              (typeof delivery?.to === "string" && delivery.to.trim());
            const shouldInfer =
              (deliveryValue == null || delivery) &&
              (mode === "" || mode === "announce") &&
              !hasTarget;
            if (shouldInfer) {
              const inferred = inferDeliveryFromSessionKey(opts.agentSessionKey);
              if (inferred) {
                job.delivery = {
                  ...delivery,
                  ...inferred,
                };
              }
            }
          }
          const contextMessages =
            typeof params.contextMessages === "number" && Number.isFinite(params.contextMessages)
              ? params.contextMessages
              : 0;
          if (
            job &&
            typeof job === "object" &&
            "payload" in job &&
            job.payload?.kind === "systemEvent"
          ) {
            const payload = job.payload;
            if (typeof payload.text === "string" && payload.text.trim()) {
              const contextLines = await buildReminderContextLines({
                agentSessionKey: opts?.agentSessionKey,
                gatewayOpts,
                contextMessages,
              });
              if (contextLines.length > 0) {
                const baseText = stripExistingContext(payload.text);
                payload.text = `${baseText}${REMINDER_CONTEXT_MARKER}${contextLines.join("\n")}`;
              }
            }
          }
          return jsonResult(await callGatewayTool("cron.add", gatewayOpts, job));
        }
        case "update": {
          const id = readStringParam(params, "jobId") ?? readStringParam(params, "id");
          if (!id) {
            throw new Error("jobId required (id accepted for backward compatibility)");
          }
          if (!params.patch || typeof params.patch !== "object") {
            throw new Error("patch required");
          }
          const patch = normalizeCronJobPatch(params.patch) ?? params.patch;
          return jsonResult(
            await callGatewayTool("cron.update", gatewayOpts, {
              id,
              patch,
            }),
          );
        }
        case "remove": {
          const id = readStringParam(params, "jobId") ?? readStringParam(params, "id");
          if (!id) {
            throw new Error("jobId required (id accepted for backward compatibility)");
          }
          return jsonResult(await callGatewayTool("cron.remove", gatewayOpts, { id }));
        }
        case "run": {
          const id = readStringParam(params, "jobId") ?? readStringParam(params, "id");
          if (!id) {
            throw new Error("jobId required (id accepted for backward compatibility)");
          }
          const runMode =
            params.runMode === "due" || params.runMode === "force" ? params.runMode : "force";
          return jsonResult(await callGatewayTool("cron.run", gatewayOpts, { id, mode: runMode }));
        }
        case "runs": {
          const id = readStringParam(params, "jobId") ?? readStringParam(params, "id");
          if (!id) {
            throw new Error("jobId required (id accepted for backward compatibility)");
          }
          return jsonResult(await callGatewayTool("cron.runs", gatewayOpts, { id }));
        }
        case "wake": {
          const text = readStringParam(params, "text", { required: true });
          const mode =
            params.mode === "now" || params.mode === "next-heartbeat"
              ? params.mode
              : "next-heartbeat";
          return jsonResult(
            await callGatewayTool("wake", gatewayOpts, { mode, text }, { expectFinal: false }),
          );
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
