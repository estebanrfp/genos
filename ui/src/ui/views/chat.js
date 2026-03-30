let adjustTextareaHeight = function (el) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  },
  _renderCompactionIndicator = function (status) {
    if (!status) {
      return nothing;
    }
    if (status.active) {
      return html`
      <div class="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
        ${icons.loader} Compacting context...
      </div>
    `;
    }
    if (status.completedAt) {
      const elapsed = Date.now() - status.completedAt;
      if (elapsed < COMPACTION_TOAST_DURATION_MS) {
        return html`
        <div class="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          ${icons.check} Context compacted
        </div>
      `;
      }
    }
    return nothing;
  },
  handleInteractiveClick = function (e, props) {
    const btn = e.target.closest("[data-action]");
    if (!btn) {
      return;
    }
    const action = btn.dataset.action;
    const value = btn.dataset.value ?? "";
    if (action === "chat") {
      props.onDraftChange(value);
      requestAnimationFrame(() => {
        const textarea = document.querySelector(".chat-compose__field textarea");
        textarea?.focus();
      });
    } else if (action === "rpc" && props.client) {
      const rpc = btn.dataset.rpc;
      if (!rpc) {
        return;
      }
      try {
        props.client.request(rpc, JSON.parse(value || "{}")).catch(() => {});
      } catch {
        /* invalid JSON — ignore */
      }
    }
  },
  generateAttachmentId = function () {
    return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  },
  handlePaste = function (e, props) {
    const items = e.clipboardData?.items;
    if (!items || !props.onAttachmentsChange) {
      return;
    }
    const imageItems = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        imageItems.push(item);
      }
    }
    if (imageItems.length === 0) {
      return;
    }
    e.preventDefault();
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) {
        continue;
      }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const dataUrl = reader.result;
        const newAttachment = {
          id: generateAttachmentId(),
          dataUrl,
          mimeType: file.type,
        };
        const current = props.attachments ?? [];
        props.onAttachmentsChange?.([...current, newAttachment]);
      });
      reader.readAsDataURL(file);
    }
  },
  renderAttachmentPreview = function (props) {
    const attachments = props.attachments ?? [];
    if (attachments.length === 0) {
      return nothing;
    }
    return html`
    <div class="chat-attachments">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment">
            <img
              src=${att.dataUrl}
              alt="Attachment preview"
              class="chat-attachment__img"
            />
            <button
              class="chat-attachment__remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.attachments ?? []).filter((a) => a.id !== att.id);
                props.onAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `,
      )}
    </div>
  `;
  },
  groupMessages = function (items) {
    const result = [];
    let currentGroup = null;
    for (const item of items) {
      if (item.kind !== "message") {
        if (currentGroup) {
          result.push(currentGroup);
          currentGroup = null;
        }
        result.push(item);
        continue;
      }
      const normalized = normalizeMessage(item.message);
      const role = normalizeRoleForGrouping(normalized.role);
      const timestamp = normalized.timestamp || Date.now();
      // Merge tool messages into the preceding assistant group so [TOOL] headers
      // never appear — tools render as compact inline lines within the assistant flow.
      const shouldContinueGroup =
        currentGroup &&
        (currentGroup.role === role || (role === "tool" && currentGroup.role === "assistant"));
      if (!shouldContinueGroup) {
        if (currentGroup) {
          result.push(currentGroup);
        }
        currentGroup = {
          kind: "group",
          key: `group:${role}:${item.key}`,
          role,
          messages: [{ message: item.message, key: item.key }],
          timestamp,
          isStreaming: false,
        };
      } else {
        currentGroup.messages.push({ message: item.message, key: item.key });
      }
    }
    if (currentGroup) {
      result.push(currentGroup);
    }
    return result;
  },
  buildChatItems = function (props) {
    const items = [];
    const history = Array.isArray(props.messages) ? props.messages : [];
    const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
    const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
    if (historyStart > 0) {
      items.push({
        kind: "message",
        key: "chat:history:notice",
        message: {
          role: "system",
          content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
          timestamp: Date.now(),
        },
      });
    }
    for (let i = historyStart; i < history.length; i++) {
      const msg = history[i];
      const normalized = normalizeMessage(msg);
      const raw = msg;
      const marker = raw.__genosos;
      if (marker?.kind === "compaction") {
        // Peek at next message — if it's the compaction summary from the assistant, absorb it into the divider
        let compactionLabel = "Compaction";
        const next = i + 1 < history.length ? history[i + 1] : null;
        const nextNorm = next ? normalizeMessage(next) : null;
        const nextText = nextNorm?.content?.[0]?.text;
        if (nextNorm?.role === "assistant" && typeof nextText === "string") {
          const t = nextText.replace(/^⚙️\s*/, "").trim();
          if (t.startsWith("Compaction") || t.startsWith("Compacted")) {
            compactionLabel = t.replace(/^Compact(?:ion|ed)\s*/i, "");
            i++; // skip the assistant message
          }
        }
        items.push({
          kind: "divider",
          key:
            typeof marker.id === "string"
              ? `divider:compaction:${marker.id}`
              : `divider:compaction:${normalized.timestamp}:${i}`,
          label: compactionLabel,
          timestamp: normalized.timestamp ?? Date.now(),
        });
        continue;
      }
      if (marker?.kind === "system-instruction") {
        items.push({
          kind: "divider",
          key: `divider:system-instruction:${normalized.timestamp}:${i}`,
          label: "New session",
          timestamp: normalized.timestamp ?? Date.now(),
        });
        continue;
      }
      if (!props.showThinking && normalized.role.toLowerCase() === "toolresult") {
        continue;
      }
      items.push({
        kind: "message",
        key: messageKey(msg, i),
        message: msg,
      });
      // Inject [SYSTEM] notice when A2A conversation ends via stop token
      if (normalized.role === "assistant" || normalized.role === "user") {
        const rawText =
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .filter((p) => p?.type === "text")
                  .map((p) => p.text)
                  .join("")
              : (msg.text ?? "");
        if (containsA2AStopToken(rawText)) {
          items.push({
            kind: "message",
            key: `a2a-end:${i}`,
            message: {
              role: "system",
              content: "Agent-to-agent conversation ended.",
              timestamp: normalized.timestamp ?? Date.now(),
            },
          });
        }
      }
    }
    if (props.showThinking) {
      for (let i = 0; i < tools.length; i++) {
        items.push({
          kind: "message",
          key: messageKey(tools[i], i + history.length),
          message: tools[i],
        });
      }
    }
    if (props.compactionStatus?.active) {
      const compactSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
      items.push({
        kind: "reading-indicator",
        key: "compaction:active",
        activityHint: "Compacting context\u2026",
        startedAt: props.compactionStatus.startedAt,
        compactionTokens: compactSession?.totalTokens,
      });
    }
    if (!props.compactionStatus?.active && props.stream !== null) {
      const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
      const runStart = props.streamStartedAt ?? Date.now();
      if (props.stream.trim().length > 10) {
        items.push({
          kind: "stream",
          key,
          text: props.stream,
          startedAt: runStart,
        });
        // Show activity indicator below partial text when tools are running
        if (props.activeTool?.name) {
          items.push({
            kind: "reading-indicator",
            key: `${key}:tool`,
            activeTool: props.activeTool,
            startedAt: runStart,
          });
        }
      } else {
        items.push({
          kind: "reading-indicator",
          key,
          activeTool: props.activeTool,
          ...(isResetInFlight() && { activityHint: "Resetting context\u2026" }),
          startedAt: runStart,
        });
      }
    }
    if (props.stream === null) {
      const activeSubs = (props.sessions?.sessions ?? []).filter(
        (s) => s.running && s.key?.includes(":subagent:"),
      );
      if (activeSubs.length > 0) {
        items.push({ kind: "subagent-waiting", key: "waiting:subagent", sessions: activeSubs });
      }
    }
    const groups = groupMessages(items);
    if (props.lastRunStats) {
      for (let i = groups.length - 1; i >= 0; i--) {
        if (groups[i].kind === "group" && groups[i].role === "assistant") {
          groups[i].stats = props.lastRunStats;
          groups[i].model = props.activeModel ?? null;
          break;
        }
      }
    }
    return groups;
  },
  messageKey = function (message, index) {
    const m = message;
    const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
    if (toolCallId) {
      return `tool:${toolCallId}`;
    }
    const id = typeof m.id === "string" ? m.id : "";
    if (id) {
      return `msg:${id}`;
    }
    const messageId = typeof m.messageId === "string" ? m.messageId : "";
    if (messageId) {
      return `msg:${messageId}`;
    }
    const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
    const role = typeof m.role === "string" ? m.role : "unknown";
    if (timestamp != null) {
      return `msg:${role}:${timestamp}:${index}`;
    }
    return `msg:${role}:${index}`;
  };
import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import { isResetInFlight } from "../app-render.helpers.js";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
  renderSubagentWaitingGroup,
} from "../chat/grouped-render.js";
import { containsA2AStopToken } from "../chat/message-extract.js";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.js";
import { icons } from "../icons.js";
import { detectTextDirection } from "../text-direction.js";
import { renderMarkdownSidebar } from "./markdown-sidebar.js";
import "../components/resizable-divider.js";
const COMPACTION_TOAST_DURATION_MS = 5000;
export function renderChat(props) {
  const canCompose = props.connected;
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar: props.assistantAvatar ?? props.assistantAvatarUrl ?? null,
  };
  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const tokenHint = (() => {
    const total = activeSession?.totalTokens;
    const ctx = activeSession?.contextTokens;
    if (typeof total === "number" && total > 0 && typeof ctx === "number" && ctx > 0) {
      const fmtK = (n) => {
        if (n < 1000) {
          return String(n);
        }
        const k = n / 1000;
        return k < 10 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
      };
      const pct = Math.round((total / ctx) * 100);
      return ` \u00b7 ${fmtK(total)}/${fmtK(ctx)} (${pct}%)`;
    }
    return "";
  })();
  const composePlaceholder = props.connected
    ? hasAttachments
      ? "Add a message or paste more images..."
      : `Message${tokenHint}`
    : "Connect to the gateway to start chatting\u2026";
  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);
  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
      @click=${(e) => handleInteractiveClick(e, props)}
    >
      ${
        props.loading
          ? html`
              <div class="muted">Loading chat…</div>
            `
          : nothing
      }
      ${(() => {
        const chatItems = buildChatItems(props);
        return repeat(
          chatItems,
          (item) => item.key,
          (item, idx) => {
            if (item.kind === "divider") {
              const isCompaction = item.key?.startsWith("divider:compaction:");
              return html`
                <div class="chat-divider ${isCompaction ? "chat-divider--clickable" : ""}" role="separator" data-ts=${String(item.timestamp)}
                  @click=${
                    isCompaction
                      ? async () => {
                          if (!props.client || !props.sessionKey) {
                            return;
                          }
                          const res = await props.client.request("sessions.compactionSummary", {
                            key: props.sessionKey,
                          });
                          if (res?.summary) {
                            props.onOpenSidebar?.(res.summary);
                          }
                        }
                      : nothing
                  }>
                  <span class="chat-divider__line"></span>
                  <span class="chat-divider__label">${item.label}</span>
                  <span class="chat-divider__line"></span>
                </div>
              `;
            }
            if (item.kind === "reading-indicator") {
              return renderReadingIndicatorGroup(
                assistantIdentity,
                item.activeTool,
                item.activityHint,
                item.startedAt,
                item.compactionTokens,
                props.isBoosted,
              );
            }
            if (item.kind === "subagent-waiting") {
              return renderSubagentWaitingGroup(item.sessions);
            }
            if (item.kind === "stream") {
              return renderStreamingGroup(
                item.text,
                item.startedAt,
                props.onOpenSidebar,
                assistantIdentity,
              );
            }
            if (item.kind === "group") {
              const prev = chatItems[idx - 1];
              const showName = !prev || prev.kind !== "group" || prev.role !== item.role;
              return renderMessageGroup(item, {
                onOpenSidebar: props.onOpenSidebar,
                showReasoning,
                assistantName: props.assistantName,
                assistantAvatar: assistantIdentity.avatar,
                showName,
                agentNames: props.agentNames,
                ownerDisplayName: props.ownerDisplayName,
              });
            }
            return nothing;
          },
        );
      })()}
    </div>
  `;
  return html`
    <section class="card chat">
      ${
        props.disabledReason || props.error
          ? html`
        <div class="chat-group system">
          <div class="chat-group-header">
            <span class="cli-prompt cli-prompt--error">\u25CF</span>
            <span class="chat-sender-name">[SYSTEM]</span>
          </div>
          <div class="chat-group-messages">
            <div class="chat-bubble">
              <div class="chat-text">${props.disabledReason ?? ""}${
                props.disabledReason && props.error
                  ? html`
                      <br />
                    `
                  : nothing
              }${props.error ?? ""}</div>
            </div>
          </div>
        </div>
      `
          : nothing
      }


      <div
        class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}"
      >
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${
          sidebarOpen
            ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <aside class="chat-sidebar">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </aside>
            `
            : nothing
        }
      </div>

      ${
        props.queue.length
          ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__header">
                <span class="chat-queue__title">Queued (${props.queue.length})</span>
                <button class="chat-queue__interrupt" type="button" @click=${props.onQueueInterrupt}>Interrupt</button>
              </div>
              ${props.queue.map(
                (item) => html`
                  <div class="chat-queue__item">
                    <button class="chat-queue__remove" type="button" aria-label="Remove queued message" @click=${() => props.onQueueRemove(item.id)}>${icons.x}</button>
                    <span class="chat-queue__text">${item.text || (item.attachments?.length ? `Image (${item.attachments.length})` : "")}</span>
                  </div>
                `,
              )}
            </div>
          `
          : nothing
      }

      ${"" /* compaction indicator handled via reading-indicator in buildChatItems */}

      ${
        props.showNewMessages
          ? html`
            <button
              class="btn chat-new-messages"
              type="button"
              @click=${props.onScrollToBottom}
            >
              New messages ${icons.arrowDown}
            </button>
          `
          : nothing
      }

      <div class="chat-compose">
        ${renderAttachmentPreview(props)}
        <div class="chat-compose__row">
          <span class="cli-compose-prompt">\u276F</span>
          <label class="field chat-compose__field">
            <span>Message</span>
            <textarea
              ${ref((el) => el && adjustTextareaHeight(el))}
              .value=${props.draft}
              dir=${detectTextDirection(props.draft)}
              ?disabled=${!props.connected}
              @keydown=${(e) => {
                if (e.key === "Escape" && props.canAbort) {
                  e.preventDefault();
                  props.onAbort();
                  return;
                }
                if (e.key !== "Enter") {
                  return;
                }
                if (e.isComposing || e.keyCode === 229) {
                  return;
                }
                if (e.shiftKey) {
                  return;
                }
                if (!props.connected) {
                  return;
                }
                e.preventDefault();
                if (canCompose) {
                  props.onSend();
                }
              }}
              @input=${(e) => {
                const target = e.target;
                adjustTextareaHeight(target);
                props.onDraftChange(target.value);
              }}
              @paste=${(e) => handlePaste(e, props)}
              placeholder=${composePlaceholder}
            ></textarea>
          </label>
          <button
            class="btn btn--sm btn--icon chat-compose__voice ${props.voiceMode ? "active" : ""}"
            aria-pressed=${props.voiceMode}
            title=${props.voiceMode ? "Voice mode on — click to mute" : "Voice mode off — click to enable TTS"}
            @click=${() => props.onToggleVoiceMode?.()}
            .innerHTML=${`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${props.voiceMode ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>' : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>'}</svg>`}
          ></button>
        </div>
      </div>
    </section>
  `;
}
const CHAT_HISTORY_RENDER_LIMIT = 200;
