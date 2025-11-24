let writeSseEvent = function (res, event) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  },
  extractTextContent = function (content) {
    if (typeof content === "string") {
      return content;
    }
    return content
      .map((part) => {
        if (part.type === "input_text") {
          return part.text;
        }
        if (part.type === "output_text") {
          return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  },
  normalizeHostnameAllowlist = function (values) {
    if (!values || values.length === 0) {
      return;
    }
    const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  },
  resolveResponsesLimits = function (config) {
    const files = config?.files;
    const images = config?.images;
    const fileLimits = resolveInputFileLimits(files);
    return {
      maxBodyBytes: config?.maxBodyBytes ?? DEFAULT_BODY_BYTES,
      maxUrlParts:
        typeof config?.maxUrlParts === "number"
          ? Math.max(0, Math.floor(config.maxUrlParts))
          : DEFAULT_MAX_URL_PARTS,
      files: {
        ...fileLimits,
        urlAllowlist: normalizeHostnameAllowlist(files?.urlAllowlist),
      },
      images: {
        allowUrl: images?.allowUrl ?? true,
        urlAllowlist: normalizeHostnameAllowlist(images?.urlAllowlist),
        allowedMimes: normalizeMimeList(images?.allowedMimes, DEFAULT_INPUT_IMAGE_MIMES),
        maxBytes: images?.maxBytes ?? DEFAULT_INPUT_IMAGE_MAX_BYTES,
        maxRedirects: images?.maxRedirects ?? DEFAULT_INPUT_MAX_REDIRECTS,
        timeoutMs: images?.timeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS,
      },
    };
  },
  extractClientTools = function (body) {
    return body.tools ?? [];
  },
  applyToolChoice = function (params) {
    const { tools, toolChoice } = params;
    if (!toolChoice) {
      return { tools };
    }
    if (toolChoice === "none") {
      return { tools: [] };
    }
    if (toolChoice === "required") {
      if (tools.length === 0) {
        throw new Error("tool_choice=required but no tools were provided");
      }
      return {
        tools,
        extraSystemPrompt: "You must call one of the available tools before responding.",
      };
    }
    if (typeof toolChoice === "object" && toolChoice.type === "function") {
      const targetName = toolChoice.function?.name?.trim();
      if (!targetName) {
        throw new Error("tool_choice.function.name is required");
      }
      const matched = tools.filter((tool) => tool.function?.name === targetName);
      if (matched.length === 0) {
        throw new Error(`tool_choice requested unknown tool: ${targetName}`);
      }
      return {
        tools: matched,
        extraSystemPrompt: `You must call the ${targetName} tool before responding.`,
      };
    }
    return { tools };
  },
  resolveOpenResponsesSessionKey = function (params) {
    return resolveSessionKey({ ...params, prefix: "openresponses" });
  },
  createEmptyUsage = function () {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  },
  toUsage = function (value) {
    if (!value) {
      return createEmptyUsage();
    }
    const input = value.input ?? 0;
    const output = value.output ?? 0;
    const cacheRead = value.cacheRead ?? 0;
    const cacheWrite = value.cacheWrite ?? 0;
    const total = value.total ?? input + output + cacheRead + cacheWrite;
    return {
      input_tokens: Math.max(0, input),
      output_tokens: Math.max(0, output),
      total_tokens: Math.max(0, total),
    };
  },
  extractUsageFromResult = function (result) {
    const meta = result?.meta;
    const usage = meta && typeof meta === "object" ? meta.agentMeta?.usage : undefined;
    return toUsage(usage);
  },
  createResponseResource = function (params) {
    return {
      id: params.id,
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: params.status,
      model: params.model,
      output: params.output,
      usage: params.usage ?? createEmptyUsage(),
      error: params.error,
    };
  },
  createAssistantOutputItem = function (params) {
    return {
      type: "message",
      id: params.id,
      role: "assistant",
      content: [{ type: "output_text", text: params.text }],
      status: params.status,
    };
  };
import { randomUUID } from "node:crypto";
import { createDefaultDeps } from "../cli/deps.js";
import { agentCommand } from "../commands/agent.js";
import { emitAgentEvent, onAgentEvent } from "../infra/agent-events.js";
import { logWarn } from "../logger.js";
import {
  DEFAULT_INPUT_IMAGE_MAX_BYTES,
  DEFAULT_INPUT_IMAGE_MIMES,
  DEFAULT_INPUT_MAX_REDIRECTS,
  DEFAULT_INPUT_TIMEOUT_MS,
  extractFileContentFromSource,
  extractImageContentFromSource,
  normalizeMimeList,
  resolveInputFileLimits,
} from "../media/input-files.js";
import { defaultRuntime } from "../runtime.js";
import { resolveAssistantStreamDeltaText } from "./agent-event-assistant-text.js";
import { buildAgentMessageFromConversationEntries } from "./agent-prompt.js";
import { sendJson, setSseHeaders, writeDone } from "./http-common.js";
import { handleGatewayPostJsonEndpoint } from "./http-endpoint-helpers.js";
import { resolveAgentIdForRequest, resolveSessionKey } from "./http-utils.js";
import { CreateResponseBodySchema } from "./open-responses.schema.js";
const DEFAULT_BODY_BYTES = 20971520;
const DEFAULT_MAX_URL_PARTS = 8;
export function buildAgentPrompt(input) {
  if (typeof input === "string") {
    return { message: input };
  }
  const systemParts = [];
  const conversationEntries = [];
  for (const item of input) {
    if (item.type === "message") {
      const content = extractTextContent(item.content).trim();
      if (!content) {
        continue;
      }
      if (item.role === "system" || item.role === "developer") {
        systemParts.push(content);
        continue;
      }
      const normalizedRole = item.role === "assistant" ? "assistant" : "user";
      const sender = normalizedRole === "assistant" ? "Assistant" : "User";
      conversationEntries.push({
        role: normalizedRole,
        entry: { sender, body: content },
      });
    } else if (item.type === "function_call_output") {
      conversationEntries.push({
        role: "tool",
        entry: { sender: `Tool:${item.call_id}`, body: item.output },
      });
    }
  }
  const message = buildAgentMessageFromConversationEntries(conversationEntries);
  return {
    message,
    extraSystemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
  };
}
async function runResponsesAgentCommand(params) {
  return agentCommand(
    {
      message: params.message,
      images: params.images.length > 0 ? params.images : undefined,
      clientTools: params.clientTools.length > 0 ? params.clientTools : undefined,
      extraSystemPrompt: params.extraSystemPrompt || undefined,
      streamParams: params.streamParams ?? undefined,
      sessionKey: params.sessionKey,
      runId: params.runId,
      deliver: false,
      messageChannel: "webchat",
      bestEffortDeliver: false,
    },
    defaultRuntime,
    params.deps,
  );
}
export async function handleOpenResponsesHttpRequest(req, res, opts) {
  const limits = resolveResponsesLimits(opts.config);
  const maxBodyBytes =
    opts.maxBodyBytes ??
    (opts.config?.maxBodyBytes
      ? limits.maxBodyBytes
      : Math.max(limits.maxBodyBytes, limits.files.maxBytes * 2, limits.images.maxBytes * 2));
  const handled = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/v1/responses",
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    rateLimiter: opts.rateLimiter,
    maxBodyBytes,
  });
  if (handled === false) {
    return false;
  }
  if (!handled) {
    return true;
  }
  const parseResult = CreateResponseBodySchema.safeParse(handled.body);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    const message = issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid request body";
    sendJson(res, 400, {
      error: { message, type: "invalid_request_error" },
    });
    return true;
  }
  const payload = parseResult.data;
  const stream = Boolean(payload.stream);
  const model = payload.model;
  const user = payload.user;
  let images = [];
  let fileContexts = [];
  let urlParts = 0;
  const markUrlPart = () => {
    urlParts += 1;
    if (urlParts > limits.maxUrlParts) {
      throw new Error(
        `Too many URL-based input sources: ${urlParts} (limit: ${limits.maxUrlParts})`,
      );
    }
  };
  try {
    if (Array.isArray(payload.input)) {
      for (const item of payload.input) {
        if (item.type === "message" && typeof item.content !== "string") {
          for (const part of item.content) {
            if (part.type === "input_image") {
              const source = part.source;
              const sourceType =
                source.type === "base64" || source.type === "url" ? source.type : undefined;
              if (!sourceType) {
                throw new Error("input_image must have 'source.url' or 'source.data'");
              }
              if (sourceType === "url") {
                markUrlPart();
              }
              const imageSource = {
                type: sourceType,
                url: source.url,
                data: source.data,
                mediaType: source.media_type,
              };
              const image = await extractImageContentFromSource(imageSource, limits.images);
              images.push(image);
              continue;
            }
            if (part.type === "input_file") {
              const source = part.source;
              const sourceType =
                source.type === "base64" || source.type === "url" ? source.type : undefined;
              if (!sourceType) {
                throw new Error("input_file must have 'source.url' or 'source.data'");
              }
              if (sourceType === "url") {
                markUrlPart();
              }
              const file = await extractFileContentFromSource({
                source: {
                  type: sourceType,
                  url: source.url,
                  data: source.data,
                  mediaType: source.media_type,
                  filename: source.filename,
                },
                limits: limits.files,
              });
              if (file.text?.trim()) {
                fileContexts.push(`<file name="${file.filename}">\n${file.text}\n</file>`);
              } else if (file.images && file.images.length > 0) {
                fileContexts.push(
                  `<file name="${file.filename}">[PDF content rendered to images]</file>`,
                );
              }
              if (file.images && file.images.length > 0) {
                images = images.concat(file.images);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logWarn(`openresponses: request parsing failed: ${String(err)}`);
    sendJson(res, 400, {
      error: { message: "invalid request", type: "invalid_request_error" },
    });
    return true;
  }
  const clientTools = extractClientTools(payload);
  let toolChoicePrompt;
  let resolvedClientTools = clientTools;
  try {
    const toolChoiceResult = applyToolChoice({
      tools: clientTools,
      toolChoice: payload.tool_choice,
    });
    resolvedClientTools = toolChoiceResult.tools;
    toolChoicePrompt = toolChoiceResult.extraSystemPrompt;
  } catch (err) {
    logWarn(`openresponses: tool configuration failed: ${String(err)}`);
    sendJson(res, 400, {
      error: { message: "invalid tool configuration", type: "invalid_request_error" },
    });
    return true;
  }
  const agentId = resolveAgentIdForRequest({ req, model });
  const sessionKey = resolveOpenResponsesSessionKey({ req, agentId, user });
  const prompt = buildAgentPrompt(payload.input);
  const fileContext = fileContexts.length > 0 ? fileContexts.join("\n\n") : undefined;
  const toolChoiceContext = toolChoicePrompt?.trim();
  const extraSystemPrompt = [
    payload.instructions,
    prompt.extraSystemPrompt,
    toolChoiceContext,
    fileContext,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!prompt.message) {
    sendJson(res, 400, {
      error: {
        message: "Missing user message in `input`.",
        type: "invalid_request_error",
      },
    });
    return true;
  }
  const responseId = `resp_${randomUUID()}`;
  const outputItemId = `msg_${randomUUID()}`;
  const deps = createDefaultDeps();
  const streamParams =
    typeof payload.max_output_tokens === "number"
      ? { maxTokens: payload.max_output_tokens }
      : undefined;
  if (!stream) {
    try {
      const result = await runResponsesAgentCommand({
        message: prompt.message,
        images,
        clientTools: resolvedClientTools,
        extraSystemPrompt,
        streamParams,
        sessionKey,
        runId: responseId,
        deps,
      });
      const payloads = result?.payloads;
      const usage = extractUsageFromResult(result);
      const meta = result?.meta;
      const stopReason = meta && typeof meta === "object" ? meta.stopReason : undefined;
      const pendingToolCalls = meta && typeof meta === "object" ? meta.pendingToolCalls : undefined;
      if (stopReason === "tool_calls" && pendingToolCalls && pendingToolCalls.length > 0) {
        const functionCall = pendingToolCalls[0];
        const functionCallItemId = `call_${randomUUID()}`;
        const response = createResponseResource({
          id: responseId,
          model,
          status: "incomplete",
          output: [
            {
              type: "function_call",
              id: functionCallItemId,
              call_id: functionCall.id,
              name: functionCall.name,
              arguments: functionCall.arguments,
            },
          ],
          usage,
        });
        sendJson(res, 200, response);
        return true;
      }
      const content =
        Array.isArray(payloads) && payloads.length > 0
          ? payloads
              .map((p) => (typeof p.text === "string" ? p.text : ""))
              .filter(Boolean)
              .join("\n\n")
          : "No response from GenosOS.";
      const response = createResponseResource({
        id: responseId,
        model,
        status: "completed",
        output: [
          createAssistantOutputItem({ id: outputItemId, text: content, status: "completed" }),
        ],
        usage,
      });
      sendJson(res, 200, response);
    } catch (err) {
      logWarn(`openresponses: non-stream response failed: ${String(err)}`);
      const response = createResponseResource({
        id: responseId,
        model,
        status: "failed",
        output: [],
        error: { code: "api_error", message: "internal error" },
      });
      sendJson(res, 500, response);
    }
    return true;
  }
  setSseHeaders(res);
  let accumulatedText = "";
  let sawAssistantDelta = false;
  let closed = false;
  let unsubscribe = () => {};
  let finalUsage;
  let finalizeRequested = null;
  const maybeFinalize = () => {
    if (closed) {
      return;
    }
    if (!finalizeRequested) {
      return;
    }
    if (!finalUsage) {
      return;
    }
    const usage = finalUsage;
    closed = true;
    unsubscribe();
    writeSseEvent(res, {
      type: "response.output_text.done",
      item_id: outputItemId,
      output_index: 0,
      content_index: 0,
      text: finalizeRequested.text,
    });
    writeSseEvent(res, {
      type: "response.content_part.done",
      item_id: outputItemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: finalizeRequested.text },
    });
    const completedItem = createAssistantOutputItem({
      id: outputItemId,
      text: finalizeRequested.text,
      status: "completed",
    });
    writeSseEvent(res, {
      type: "response.output_item.done",
      output_index: 0,
      item: completedItem,
    });
    const finalResponse = createResponseResource({
      id: responseId,
      model,
      status: finalizeRequested.status,
      output: [completedItem],
      usage,
    });
    writeSseEvent(res, { type: "response.completed", response: finalResponse });
    writeDone(res);
    res.end();
  };
  const requestFinalize = (status, text) => {
    if (finalizeRequested) {
      return;
    }
    finalizeRequested = { status, text };
    maybeFinalize();
  };
  const initialResponse = createResponseResource({
    id: responseId,
    model,
    status: "in_progress",
    output: [],
  });
  writeSseEvent(res, { type: "response.created", response: initialResponse });
  writeSseEvent(res, { type: "response.in_progress", response: initialResponse });
  const outputItem = createAssistantOutputItem({
    id: outputItemId,
    text: "",
    status: "in_progress",
  });
  writeSseEvent(res, {
    type: "response.output_item.added",
    output_index: 0,
    item: outputItem,
  });
  writeSseEvent(res, {
    type: "response.content_part.added",
    item_id: outputItemId,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "" },
  });
  unsubscribe = onAgentEvent((evt) => {
    if (evt.runId !== responseId) {
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
      sawAssistantDelta = true;
      accumulatedText += content;
      writeSseEvent(res, {
        type: "response.output_text.delta",
        item_id: outputItemId,
        output_index: 0,
        content_index: 0,
        delta: content,
      });
      return;
    }
    if (evt.stream === "lifecycle") {
      const phase = evt.data?.phase;
      if (phase === "end" || phase === "error") {
        const finalText = accumulatedText || "No response from GenosOS.";
        const finalStatus = phase === "error" ? "failed" : "completed";
        requestFinalize(finalStatus, finalText);
      }
    }
  });
  req.on("close", () => {
    closed = true;
    unsubscribe();
  });
  (async () => {
    try {
      const result = await runResponsesAgentCommand({
        message: prompt.message,
        images,
        clientTools: resolvedClientTools,
        extraSystemPrompt,
        streamParams,
        sessionKey,
        runId: responseId,
        deps,
      });
      finalUsage = extractUsageFromResult(result);
      maybeFinalize();
      if (closed) {
        return;
      }
      if (!sawAssistantDelta) {
        const resultAny = result;
        const payloads = resultAny.payloads;
        const meta = resultAny.meta;
        const stopReason = meta && typeof meta === "object" ? meta.stopReason : undefined;
        const pendingToolCalls =
          meta && typeof meta === "object" ? meta.pendingToolCalls : undefined;
        if (stopReason === "tool_calls" && pendingToolCalls && pendingToolCalls.length > 0) {
          const functionCall = pendingToolCalls[0];
          const usage = finalUsage ?? createEmptyUsage();
          writeSseEvent(res, {
            type: "response.output_text.done",
            item_id: outputItemId,
            output_index: 0,
            content_index: 0,
            text: "",
          });
          writeSseEvent(res, {
            type: "response.content_part.done",
            item_id: outputItemId,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "" },
          });
          const completedItem = createAssistantOutputItem({
            id: outputItemId,
            text: "",
            status: "completed",
          });
          writeSseEvent(res, {
            type: "response.output_item.done",
            output_index: 0,
            item: completedItem,
          });
          const functionCallItemId = `call_${randomUUID()}`;
          const functionCallItem = {
            type: "function_call",
            id: functionCallItemId,
            call_id: functionCall.id,
            name: functionCall.name,
            arguments: functionCall.arguments,
          };
          writeSseEvent(res, {
            type: "response.output_item.added",
            output_index: 1,
            item: functionCallItem,
          });
          writeSseEvent(res, {
            type: "response.output_item.done",
            output_index: 1,
            item: { ...functionCallItem, status: "completed" },
          });
          const incompleteResponse = createResponseResource({
            id: responseId,
            model,
            status: "incomplete",
            output: [completedItem, functionCallItem],
            usage,
          });
          closed = true;
          unsubscribe();
          writeSseEvent(res, { type: "response.completed", response: incompleteResponse });
          writeDone(res);
          res.end();
          return;
        }
        const content =
          Array.isArray(payloads) && payloads.length > 0
            ? payloads
                .map((p) => (typeof p.text === "string" ? p.text : ""))
                .filter(Boolean)
                .join("\n\n")
            : "No response from GenosOS.";
        accumulatedText = content;
        sawAssistantDelta = true;
        writeSseEvent(res, {
          type: "response.output_text.delta",
          item_id: outputItemId,
          output_index: 0,
          content_index: 0,
          delta: content,
        });
      }
    } catch (err) {
      logWarn(`openresponses: streaming response failed: ${String(err)}`);
      if (closed) {
        return;
      }
      finalUsage = finalUsage ?? createEmptyUsage();
      const errorResponse = createResponseResource({
        id: responseId,
        model,
        status: "failed",
        output: [],
        error: { code: "api_error", message: "internal error" },
        usage: finalUsage,
      });
      writeSseEvent(res, { type: "response.failed", response: errorResponse });
      emitAgentEvent({
        runId: responseId,
        stream: "lifecycle",
        data: { phase: "error" },
      });
    } finally {
      if (!closed) {
        emitAgentEvent({
          runId: responseId,
          stream: "lifecycle",
          data: { phase: "end" },
        });
      }
    }
  })();
  return true;
}
