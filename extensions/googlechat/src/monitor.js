let logVerbose = function (core, runtime, message) {
    if (core.logging.shouldLogVerbose()) {
      runtime.log?.(`[googlechat] ${message}`);
    }
  },
  warnDeprecatedUsersEmailEntries = function (core, runtime, entries) {
    const deprecated = entries.map((v) => String(v).trim()).filter((v) => /^users\/.+@.+/i.test(v));
    if (deprecated.length === 0) {
      return;
    }
    const key = deprecated
      .map((v) => v.toLowerCase())
      .sort()
      .join(",");
    if (warnedDeprecatedUsersEmailAllowFrom.has(key)) {
      return;
    }
    warnedDeprecatedUsersEmailAllowFrom.add(key);
    logVerbose(
      core,
      runtime,
      `Deprecated allowFrom entry detected: "users/<email>" is no longer treated as an email allowlist. Use raw email (alice@example.com) or immutable user id (users/<id>). entries=${deprecated.join(", ")}`,
    );
  },
  normalizeAudienceType = function (value) {
    const normalized = value?.trim().toLowerCase();
    if (normalized === "app-url" || normalized === "app_url" || normalized === "app") {
      return "app-url";
    }
    if (
      normalized === "project-number" ||
      normalized === "project_number" ||
      normalized === "project"
    ) {
      return "project-number";
    }
    return;
  },
  normalizeUserId = function (raw) {
    const trimmed = raw?.trim() ?? "";
    if (!trimmed) {
      return "";
    }
    return trimmed.replace(/^users\//i, "").toLowerCase();
  },
  isEmailLike = function (value) {
    return value.includes("@");
  },
  resolveGroupConfig = function (params) {
    const { groupId, groupName, groups } = params;
    const entries = groups ?? {};
    const keys = Object.keys(entries);
    if (keys.length === 0) {
      return { entry: undefined, allowlistConfigured: false };
    }
    const normalizedName = groupName?.trim().toLowerCase();
    const candidates = [groupId, groupName ?? "", normalizedName ?? ""].filter(Boolean);
    let entry = candidates.map((candidate) => entries[candidate]).find(Boolean);
    if (!entry && normalizedName) {
      entry = entries[normalizedName];
    }
    const fallback = entries["*"];
    return { entry: entry ?? fallback, allowlistConfigured: true, fallback };
  },
  extractMentionInfo = function (annotations, botUser) {
    const mentionAnnotations = annotations.filter((entry) => entry.type === "USER_MENTION");
    const hasAnyMention = mentionAnnotations.length > 0;
    const botTargets = new Set(["users/app", botUser?.trim()].filter(Boolean));
    const wasMentioned = mentionAnnotations.some((entry) => {
      const userName = entry.userMention?.user?.name;
      if (!userName) {
        return false;
      }
      if (botTargets.has(userName)) {
        return true;
      }
      return normalizeUserId(userName) === "app";
    });
    return { hasAnyMention, wasMentioned };
  },
  resolveBotDisplayName = function (params) {
    const { accountName, agentId, config } = params;
    if (accountName?.trim()) {
      return accountName.trim();
    }
    const agent = config.agents?.list?.find((a) => a.id === agentId);
    if (agent?.name?.trim()) {
      return agent.name.trim();
    }
    return "GenosOS";
  };
import {
  createReplyPrefixOptions,
  readJsonBodyWithLimit,
  registerWebhookTarget,
  rejectNonPostWebhookRequest,
  resolveWebhookPath,
  resolveWebhookTargets,
  requestBodyErrorToText,
  resolveMentionGatingWithBypass,
} from "genosos/plugin-sdk";
import {
  downloadGoogleChatMedia,
  deleteGoogleChatMessage,
  sendGoogleChatMessage,
  updateGoogleChatMessage,
} from "./api.js";
import { verifyGoogleChatRequest } from "./auth.js";
import { getGoogleChatRuntime } from "./runtime.js";
const webhookTargets = new Map();
const warnedDeprecatedUsersEmailAllowFrom = new Set();
export function registerGoogleChatWebhookTarget(target) {
  return registerWebhookTarget(webhookTargets, target).unregister;
}
export async function handleGoogleChatWebhookRequest(req, res) {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { targets } = resolved;
  if (rejectNonPostWebhookRequest(req, res)) {
    return true;
  }
  const authHeader = String(req.headers.authorization ?? "");
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length)
    : "";
  const body = await readJsonBodyWithLimit(req, {
    maxBytes: 1048576,
    timeoutMs: 30000,
    emptyObjectOnEmpty: false,
  });
  if (!body.ok) {
    res.statusCode =
      body.code === "PAYLOAD_TOO_LARGE" ? 413 : body.code === "REQUEST_BODY_TIMEOUT" ? 408 : 400;
    res.end(
      body.code === "REQUEST_BODY_TIMEOUT"
        ? requestBodyErrorToText("REQUEST_BODY_TIMEOUT")
        : body.error,
    );
    return true;
  }
  let raw = body.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }
  const rawObj = raw;
  if (rawObj.commonEventObject?.hostApp === "CHAT" && rawObj.chat?.messagePayload) {
    const chat = rawObj.chat;
    const messagePayload = chat.messagePayload;
    raw = {
      type: "MESSAGE",
      space: messagePayload?.space,
      message: messagePayload?.message,
      user: chat.user,
      eventTime: chat.eventTime,
    };
    const systemIdToken = rawObj.authorizationEventObject?.systemIdToken;
    if (!bearer && systemIdToken) {
      Object.assign(req.headers, { authorization: `Bearer ${systemIdToken}` });
    }
  }
  const event = raw;
  const eventType = event.type ?? raw.eventType;
  if (typeof eventType !== "string") {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }
  if (!event.space || typeof event.space !== "object" || Array.isArray(event.space)) {
    res.statusCode = 400;
    res.end("invalid payload");
    return true;
  }
  if (eventType === "MESSAGE") {
    if (!event.message || typeof event.message !== "object" || Array.isArray(event.message)) {
      res.statusCode = 400;
      res.end("invalid payload");
      return true;
    }
  }
  const authHeaderNow = String(req.headers.authorization ?? "");
  const effectiveBearer = authHeaderNow.toLowerCase().startsWith("bearer ")
    ? authHeaderNow.slice("bearer ".length)
    : bearer;
  const matchedTargets = [];
  for (const target of targets) {
    const audienceType = target.audienceType;
    const audience = target.audience;
    const verification = await verifyGoogleChatRequest({
      bearer: effectiveBearer,
      audienceType,
      audience,
    });
    if (verification.ok) {
      matchedTargets.push(target);
      if (matchedTargets.length > 1) {
        break;
      }
    }
  }
  if (matchedTargets.length === 0) {
    res.statusCode = 401;
    res.end("unauthorized");
    return true;
  }
  if (matchedTargets.length > 1) {
    res.statusCode = 401;
    res.end("ambiguous webhook target");
    return true;
  }
  const selected = matchedTargets[0];
  selected.statusSink?.({ lastInboundAt: Date.now() });
  processGoogleChatEvent(event, selected).catch((err) => {
    selected?.runtime.error?.(
      `[${selected.account.accountId}] Google Chat webhook failed: ${String(err)}`,
    );
  });
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end("{}");
  return true;
}
async function processGoogleChatEvent(event, target) {
  const eventType = event.type ?? event.eventType;
  if (eventType !== "MESSAGE") {
    return;
  }
  if (!event.message || !event.space) {
    return;
  }
  await processMessageWithPipeline({
    event,
    account: target.account,
    config: target.config,
    runtime: target.runtime,
    core: target.core,
    statusSink: target.statusSink,
    mediaMaxMb: target.mediaMaxMb,
  });
}
export function isSenderAllowed(senderId, senderEmail, allowFrom) {
  if (allowFrom.includes("*")) {
    return true;
  }
  const normalizedSenderId = normalizeUserId(senderId);
  const normalizedEmail = senderEmail?.trim().toLowerCase() ?? "";
  return allowFrom.some((entry) => {
    const normalized = String(entry).trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    const withoutPrefix = normalized.replace(/^(googlechat|google-chat|gchat):/i, "");
    if (withoutPrefix.startsWith("users/")) {
      return normalizeUserId(withoutPrefix) === normalizedSenderId;
    }
    if (normalizedEmail && isEmailLike(withoutPrefix)) {
      return withoutPrefix === normalizedEmail;
    }
    return withoutPrefix.replace(/^users\//i, "") === normalizedSenderId;
  });
}
async function processMessageWithPipeline(params) {
  const { event, account, config, runtime, core, statusSink, mediaMaxMb } = params;
  const space = event.space;
  const message = event.message;
  if (!space || !message) {
    return;
  }
  const spaceId = space.name ?? "";
  if (!spaceId) {
    return;
  }
  const spaceType = (space.type ?? "").toUpperCase();
  const isGroup = spaceType !== "DM";
  const sender = message.sender ?? event.user;
  const senderId = sender?.name ?? "";
  const senderName = sender?.displayName ?? "";
  const senderEmail = sender?.email ?? undefined;
  const allowBots = account.config.allowBots === true;
  if (!allowBots) {
    if (sender?.type?.toUpperCase() === "BOT") {
      logVerbose(core, runtime, `skip bot-authored message (${senderId || "unknown"})`);
      return;
    }
    if (senderId === "users/app") {
      logVerbose(core, runtime, "skip app-authored message");
      return;
    }
  }
  const messageText = (message.argumentText ?? message.text ?? "").trim();
  const attachments = message.attachment ?? [];
  const hasMedia = attachments.length > 0;
  const rawBody = messageText || (hasMedia ? "<media:attachment>" : "");
  if (!rawBody) {
    return;
  }
  const defaultGroupPolicy = config.channels?.defaults?.groupPolicy;
  const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
  const groupConfigResolved = resolveGroupConfig({
    groupId: spaceId,
    groupName: space.displayName ?? null,
    groups: account.config.groups ?? undefined,
  });
  const groupEntry = groupConfigResolved.entry;
  const groupUsers = groupEntry?.users ?? account.config.groupAllowFrom ?? [];
  let effectiveWasMentioned;
  if (isGroup) {
    if (groupPolicy === "disabled") {
      logVerbose(core, runtime, `drop group message (groupPolicy=disabled, space=${spaceId})`);
      return;
    }
    const groupAllowlistConfigured = groupConfigResolved.allowlistConfigured;
    const groupAllowed = Boolean(groupEntry) || Boolean((account.config.groups ?? {})["*"]);
    if (groupPolicy === "allowlist") {
      if (!groupAllowlistConfigured) {
        logVerbose(
          core,
          runtime,
          `drop group message (groupPolicy=allowlist, no allowlist, space=${spaceId})`,
        );
        return;
      }
      if (!groupAllowed) {
        logVerbose(core, runtime, `drop group message (not allowlisted, space=${spaceId})`);
        return;
      }
    }
    if (groupEntry?.enabled === false || groupEntry?.allow === false) {
      logVerbose(core, runtime, `drop group message (space disabled, space=${spaceId})`);
      return;
    }
    if (groupUsers.length > 0) {
      warnDeprecatedUsersEmailEntries(
        core,
        runtime,
        groupUsers.map((v) => String(v)),
      );
      const ok = isSenderAllowed(
        senderId,
        senderEmail,
        groupUsers.map((v) => String(v)),
      );
      if (!ok) {
        logVerbose(core, runtime, `drop group message (sender not allowed, ${senderId})`);
        return;
      }
    }
  }
  const dmPolicy = account.config.dm?.policy ?? "pairing";
  const configAllowFrom = (account.config.dm?.allowFrom ?? []).map((v) => String(v));
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    !isGroup && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("googlechat").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  warnDeprecatedUsersEmailEntries(core, runtime, effectiveAllowFrom);
  const commandAllowFrom = isGroup ? groupUsers.map((v) => String(v)) : effectiveAllowFrom;
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = isSenderAllowed(senderId, senderEmail, commandAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          { configured: commandAllowFrom.length > 0, allowed: senderAllowedForCommands },
        ],
      })
    : undefined;
  if (isGroup) {
    const requireMention = groupEntry?.requireMention ?? account.config.requireMention ?? true;
    const annotations = message.annotations ?? [];
    const mentionInfo = extractMentionInfo(annotations, account.config.botUser);
    const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
      cfg: config,
      surface: "googlechat",
    });
    const mentionGate = resolveMentionGatingWithBypass({
      isGroup: true,
      requireMention,
      canDetectMention: true,
      wasMentioned: mentionInfo.wasMentioned,
      implicitMention: false,
      hasAnyMention: mentionInfo.hasAnyMention,
      allowTextCommands,
      hasControlCommand: core.channel.text.hasControlCommand(rawBody, config),
      commandAuthorized: commandAuthorized === true,
    });
    effectiveWasMentioned = mentionGate.effectiveWasMentioned;
    if (mentionGate.shouldSkip) {
      logVerbose(core, runtime, `drop group message (mention required, space=${spaceId})`);
      return;
    }
  }
  if (!isGroup) {
    if (dmPolicy === "disabled" || account.config.dm?.enabled === false) {
      logVerbose(core, runtime, `Blocked Google Chat DM from ${senderId} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const allowed = senderAllowedForCommands;
      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "googlechat",
            id: senderId,
            meta: { name: senderName || undefined, email: senderEmail },
          });
          if (created) {
            logVerbose(core, runtime, `googlechat pairing request sender=${senderId}`);
            try {
              await sendGoogleChatMessage({
                account,
                space: spaceId,
                text: core.channel.pairing.buildPairingReply({
                  channel: "googlechat",
                  idLine: `Your Google Chat user id: ${senderId}`,
                  code,
                }),
              });
              statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              logVerbose(core, runtime, `pairing reply failed for ${senderId}: ${String(err)}`);
            }
          }
        } else {
          logVerbose(
            core,
            runtime,
            `Blocked unauthorized Google Chat sender ${senderId} (dmPolicy=${dmPolicy})`,
          );
        }
        return;
      }
    }
  }
  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `googlechat: drop control command from ${senderId}`);
    return;
  }
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "googlechat",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: spaceId,
    },
  });
  let mediaPath;
  let mediaType;
  if (attachments.length > 0) {
    const first = attachments[0];
    const attachmentData = await downloadAttachment(first, account, mediaMaxMb, core);
    if (attachmentData) {
      mediaPath = attachmentData.path;
      mediaType = attachmentData.contentType;
    }
  }
  const fromLabel = isGroup
    ? space.displayName || `space:${spaceId}`
    : senderName || `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "Google Chat",
    from: fromLabel,
    timestamp: event.eventTime ? Date.parse(event.eventTime) : undefined,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });
  const groupSystemPrompt = groupConfigResolved.entry?.systemPrompt?.trim() || undefined;
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `googlechat:${senderId}`,
    To: `googlechat:${spaceId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "channel" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName || undefined,
    SenderId: senderId,
    SenderUsername: senderEmail,
    WasMentioned: isGroup ? effectiveWasMentioned : undefined,
    CommandAuthorized: commandAuthorized,
    Provider: "googlechat",
    Surface: "googlechat",
    MessageSid: message.name,
    MessageSidFull: message.name,
    ReplyToId: message.thread?.name,
    ReplyToIdFull: message.thread?.name,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
    GroupSpace: isGroup ? (space.displayName ?? undefined) : undefined,
    GroupSystemPrompt: isGroup ? groupSystemPrompt : undefined,
    OriginatingChannel: "googlechat",
    OriginatingTo: `googlechat:${spaceId}`,
  });
  core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch((err) => {
      runtime.error?.(`googlechat: failed updating session meta: ${String(err)}`);
    });
  let typingIndicator = account.config.typingIndicator ?? "message";
  if (typingIndicator === "reaction") {
    runtime.error?.(
      `[${account.accountId}] typingIndicator="reaction" requires user OAuth (not supported with service account). Falling back to "message" mode.`,
    );
    typingIndicator = "message";
  }
  let typingMessageName;
  if (typingIndicator === "message") {
    try {
      const botName = resolveBotDisplayName({
        accountName: account.config.name,
        agentId: route.agentId,
        config,
      });
      const result = await sendGoogleChatMessage({
        account,
        space: spaceId,
        text: `_${botName} is typing..._`,
        thread: message.thread?.name,
      });
      typingMessageName = result?.messageName;
    } catch (err) {
      runtime.error?.(`Failed sending typing message: ${String(err)}`);
    }
  }
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config,
    agentId: route.agentId,
    channel: "googlechat",
    accountId: route.accountId,
  });
  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: async (payload) => {
        await deliverGoogleChatReply({
          payload,
          account,
          spaceId,
          runtime,
          core,
          config,
          statusSink,
          typingMessageName,
        });
        typingMessageName = undefined;
      },
      onError: (err, info) => {
        runtime.error?.(
          `[${account.accountId}] Google Chat ${info.kind} reply failed: ${String(err)}`,
        );
      },
    },
    replyOptions: {
      onModelSelected,
    },
  });
}
async function downloadAttachment(attachment, account, mediaMaxMb, core) {
  const resourceName = attachment.attachmentDataRef?.resourceName;
  if (!resourceName) {
    return null;
  }
  const maxBytes = Math.max(1, mediaMaxMb) * 1024 * 1024;
  const downloaded = await downloadGoogleChatMedia({ account, resourceName, maxBytes });
  const saved = await core.channel.media.saveMediaBuffer(
    downloaded.buffer,
    downloaded.contentType ?? attachment.contentType,
    "inbound",
    maxBytes,
    attachment.contentName,
  );
  return { path: saved.path, contentType: saved.contentType };
}
async function deliverGoogleChatReply(params) {
  const { payload, account, spaceId, runtime, core, config, statusSink, typingMessageName } =
    params;
  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];
  if (mediaList.length > 0) {
    let suppressCaption = false;
    if (typingMessageName) {
      try {
        await deleteGoogleChatMessage({
          account,
          messageName: typingMessageName,
        });
      } catch (err) {
        runtime.error?.(`Google Chat typing cleanup failed: ${String(err)}`);
        const fallbackText = payload.text?.trim()
          ? payload.text
          : mediaList.length > 1
            ? "Sent attachments."
            : "Sent attachment.";
        try {
          await updateGoogleChatMessage({
            account,
            messageName: typingMessageName,
            text: fallbackText,
          });
          suppressCaption = Boolean(payload.text?.trim());
        } catch (updateErr) {
          runtime.error?.(`Google Chat typing update failed: ${String(updateErr)}`);
        }
      }
    }
    let first = true;
    for (const mediaUrl of mediaList) {
      const caption = first && !suppressCaption ? payload.text : undefined;
      first = false;
      try {
        const loaded = await core.channel.media.fetchRemoteMedia({
          url: mediaUrl,
          maxBytes: (account.config.mediaMaxMb ?? 20) * 1024 * 1024,
        });
        const upload = await uploadAttachmentForReply({
          account,
          spaceId,
          buffer: loaded.buffer,
          contentType: loaded.contentType,
          filename: loaded.fileName ?? "attachment",
        });
        if (!upload.attachmentUploadToken) {
          throw new Error("missing attachment upload token");
        }
        await sendGoogleChatMessage({
          account,
          space: spaceId,
          text: caption,
          thread: payload.replyToId,
          attachments: [
            { attachmentUploadToken: upload.attachmentUploadToken, contentName: loaded.fileName },
          ],
        });
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`Google Chat attachment send failed: ${String(err)}`);
      }
    }
    return;
  }
  if (payload.text) {
    const chunkLimit = account.config.textChunkLimit ?? 4000;
    const chunkMode = core.channel.text.resolveChunkMode(config, "googlechat", account.accountId);
    const chunks = core.channel.text.chunkMarkdownTextWithMode(payload.text, chunkLimit, chunkMode);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        if (i === 0 && typingMessageName) {
          await updateGoogleChatMessage({
            account,
            messageName: typingMessageName,
            text: chunk,
          });
        } else {
          await sendGoogleChatMessage({
            account,
            space: spaceId,
            text: chunk,
            thread: payload.replyToId,
          });
        }
        statusSink?.({ lastOutboundAt: Date.now() });
      } catch (err) {
        runtime.error?.(`Google Chat message send failed: ${String(err)}`);
      }
    }
  }
}
async function uploadAttachmentForReply(params) {
  const { account, spaceId, buffer, contentType, filename } = params;
  const { uploadGoogleChatAttachment } = await import("./api.js");
  return await uploadGoogleChatAttachment({
    account,
    space: spaceId,
    filename,
    buffer,
    contentType,
  });
}
export function monitorGoogleChatProvider(options) {
  const core = getGoogleChatRuntime();
  const webhookPath = resolveWebhookPath({
    webhookPath: options.webhookPath,
    webhookUrl: options.webhookUrl,
    defaultPath: "/googlechat",
  });
  if (!webhookPath) {
    options.runtime.error?.(`[${options.account.accountId}] invalid webhook path`);
    return () => {};
  }
  const audienceType = normalizeAudienceType(options.account.config.audienceType);
  const audience = options.account.config.audience?.trim();
  const mediaMaxMb = options.account.config.mediaMaxMb ?? 20;
  const unregister = registerGoogleChatWebhookTarget({
    account: options.account,
    config: options.config,
    runtime: options.runtime,
    core,
    path: webhookPath,
    audienceType,
    audience,
    statusSink: options.statusSink,
    mediaMaxMb,
  });
  return unregister;
}
export async function startGoogleChatMonitor(params) {
  return monitorGoogleChatProvider(params);
}
export function resolveGoogleChatWebhookPath(params) {
  return (
    resolveWebhookPath({
      webhookPath: params.account.config.webhookPath,
      webhookUrl: params.account.config.webhookUrl,
      defaultPath: "/googlechat",
    }) ?? "/googlechat"
  );
}
export function computeGoogleChatMediaMaxMb(params) {
  return params.account.config.mediaMaxMb ?? 20;
}
