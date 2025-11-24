let writeSse = function (res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  },
  asMessages = function (val) {
    return Array.isArray(val) ? val : [];
  },
  extractTextContent = function (content) {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (!part || typeof part !== "object") {
            return "";
          }
          const type = part.type;
          const text = part.text;
          const inputText = part.input_text;
          if (type === "text" && typeof text === "string") {
            return text;
          }
          if (type === "input_text" && typeof text === "string") {
            return text;
          }
          if (typeof inputText === "string") {
            return inputText;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    return "";
  },
  buildAgentPrompt = function (messagesUnknown) {
    const messages = asMessages(messagesUnknown);
    const systemParts = [];
    const conversationEntries = [];
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") {
        continue;
      }
      const role = typeof msg.role === "string" ? msg.role.trim() : "";
      const content = extractTextContent(msg.content).trim();
      if (!role || !content) {
        continue;
      }
      if (role === "system" || role === "developer") {
        systemParts.push(content);
        continue;
      }
      const normalizedRole = role === "function" ? "tool" : role;
      if (
        normalizedRole !== "user" &&
        normalizedRole !== "assistant" &&
        normalizedRole !== "tool"
      ) {
        continue;
      }
      const name = typeof msg.name === "string" ? msg.name.trim() : "";
      const sender =
        normalizedRole === "assistant"
          ? "Assistant"
          : normalizedRole === "user"
            ? "User"
            : name
              ? `Tool:${name}`
              : "Tool";
      conversationEntries.push({
        role: normalizedRole,
        entry: { sender, body: content },
      });
    }
    const message = buildAgentMessageFromConversationEntries(conversationEntries);
    return {
      message,
      extraSystemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    };
  },
  resolveOpenAiSessionKey = function (params) {
    return resolveSessionKey({ ...params, prefix: "openai" });
  },
  coerceRequest = function (val) {
    if (!val || typeof val !== "object") {
      return {};
    }
    return val;
  },
  resolveAgentResponseText = function (result) {
    const payloads = result?.payloads;
    if (!Array.isArray(payloads) || payloads.length === 0) {
      return "No response from GenosOS.";
    }
    const content = payloads
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("\n\n");
    return content || "No response from GenosOS.";
  };
import { randomUUID } from "node:crypto";
import { createDefaultDeps } from "../cli/deps.js";
import { agentCommand } from "../commands/agent.js";
import { emitAgentEvent, onAgentEvent } from "../infra/agent-events.js";
import { logWarn } from "../logger.js";
import { defaultRuntime } from "../runtime.js";
import { resolveAssistantStreamDeltaText } from "./agent-event-assistant-text.js";
import { buildAgentMessageFromConversationEntries } from "./agent-prompt.js";
import { sendJson, setSseHeaders, writeDone } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { resolveAgentIdForRequest, resolveSessionKey } from "./http-utils.js";
export async function handleOpenAiHttpRequest(req, res, opts) {
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/v1/chat/completions",
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    rateLimiter: opts.rateLimiter,
    maxBodyBytes: opts.maxBodyBytes ?? 1048576,
  });
  if (handled === false) {
    return false;
  }
  if (!handled) {
    return true;
  }
  const payload = coerceRequest(handled.body);
  const stream = Boolean(payload.stream);
  const model = typeof payload.model === "string" ? payload.model : "genosos";
  const user = typeof payload.user === "string" ? payload.user : undefined;
  const agentId = resolveAgentIdForRequest({ req, model });
  const sessionKey = resolveOpenAiSessionKey({ req, agentId, user });
  const prompt = buildAgentPrompt(payload.messages);
  if (!prompt.message) {
    sendJson(res, 400, {
      error: {
        message: "Missing user message in `messages`.",
        type: "invalid_request_error",
      },
    });
    return true;
  }
  const runId = `chatcmpl_${randomUUID()}`;
  const deps = createDefaultDeps();
  if (!stream) {
    try {
      const result = await agentCommand(
        {
          message: prompt.message,
          extraSystemPrompt: prompt.extraSystemPrompt,
          sessionKey,
          runId,
          deliver: false,
          messageChannel: "webchat",
          bestEffortDeliver: false,
        },
        defaultRuntime,
        deps,
      );
      const content = resolveAgentResponseText(result);
      sendJson(res, 200, {
        id: runId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (err) {
      logWarn(`openai-compat: chat completion failed: ${String(err)}`);
      sendJson(res, 500, {
        error: { message: "internal error", type: "api_error" },
      });
    }
    return true;
  }
  setSseHeaders(res);
  let wroteRole = false;
  let sawAssistantDelta = false;
  let closed = false;
  const unsubscribe = onAgentEvent((evt) => {
    if (evt.runId !== runId) {
      return;
    }
    if (closed) {
      return;
    }
    if (evt.stream === "assistant") {
      const content = resolveAssistantStreamDeltaText(evt);
      if (!content) {
        return;
      }
      if (!wroteRole) {
        wroteRole = true;
        writeSse(res, {
          id: runId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { role: "assistant" } }],
        });
      }
      sawAssistantDelta = true;
      writeSse(res, {
        id: runId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content },
            finish_reason: null,
          },
        ],
      });
      return;
    }
    if (evt.stream === "lifecycle") {
      const phase = evt.data?.phase;
      if (phase === "end" || phase === "error") {
        closed = true;
        unsubscribe();
        writeDone(res);
        res.end();
      }
    }
  });
  req.on("close", () => {
    closed = true;
    unsubscribe();
  });
  (async () => {
    try {
      const result = await agentCommand(
        {
          message: prompt.message,
          extraSystemPrompt: prompt.extraSystemPrompt,
          sessionKey,
          runId,
          deliver: false,
          messageChannel: "webchat",
          bestEffortDeliver: false,
        },
        defaultRuntime,
        deps,
      );
      if (closed) {
        return;
      }
      if (!sawAssistantDelta) {
        if (!wroteRole) {
          wroteRole = true;
          writeSse(res, {
            id: runId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { role: "assistant" } }],
          });
        }
        const content = resolveAgentResponseText(result);
        sawAssistantDelta = true;
        writeSse(res, {
          id: runId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason: null,
            },
          ],
        });
      }
    } catch (err) {
      logWarn(`openai-compat: streaming chat completion failed: ${String(err)}`);
      if (closed) {
        return;
      }
      writeSse(res, {
        id: runId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            delta: { content: "Error: internal error" },
            finish_reason: "stop",
          },
        ],
      });
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: { phase: "error" },
      });
    } finally {
      if (!closed) {
        closed = true;
        unsubscribe();
        writeDone(res);
        res.end();
      }
    }
  })();
  return true;
}
