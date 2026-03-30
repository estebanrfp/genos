let extractImages = function (message) {
    const m = message;
    const content = m.content;
    const images = [];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block !== "object" || block === null) {
          continue;
        }
        const b = block;
        if (b.type === "image") {
          const source = b.source;
          if (source?.type === "base64" && typeof source.data === "string") {
            const data = source.data;
            const mediaType = source.media_type || "image/png";
            const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
            images.push({ url });
          } else if (typeof b.url === "string") {
            images.push({ url: b.url });
          }
        } else if (b.type === "image_url") {
          const imageUrl = b.image_url;
          if (typeof imageUrl?.url === "string") {
            images.push({ url: imageUrl.url });
          }
        }
      }
    }
    return images;
  },
  /**
   * Render a CLI prompt symbol for the given role.
   * @param {string} role
   * @returns {import("lit").TemplateResult}
   */
  renderPromptSymbol = function (role) {
    const normalized = normalizeRoleForGrouping(role);
    if (normalized === "user") {
      return html`
        <span class="cli-prompt cli-prompt--user">\u276F</span>
      `;
    }
    if (normalized === "tool") {
      return html`
        <span class="cli-prompt cli-prompt--tool">\u25CF</span>
      `;
    }
    return html`
      <span class="cli-prompt cli-prompt--assistant">\u25CF</span>
    `;
  },
  renderMessageImages = function (images) {
    if (images.length === 0) {
      return nothing;
    }
    return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => window.open(img.url, "_blank")}
          />
        `,
      )}
    </div>
  `;
  },
  AUDIO_FILE_RE = /^(voice-\d+\.(mp3|opus|ogg|wav|m4a))(,\s*voice-\d+\.\w+)*$/,
  /**
   * Extract audio filenames from message text (transcript stores basenames like "voice-123.mp3").
   * @param {string|null} text
   * @returns {string[]}
   */
  extractAudioFiles = function (text) {
    if (!text?.trim()) {
      return [];
    }
    const trimmed = text.trim();
    if (!AUDIO_FILE_RE.test(trimmed)) {
      return [];
    }
    return trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },
  /**
   * Render audio player with delete button.
   * @param {string[]} files
   * @returns {import("lit").TemplateResult|typeof nothing}
   */
  formatAudioTime = function (s) {
    if (!s || !Number.isFinite(s)) {
      return "0:00";
    }
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + String(sec).padStart(2, "0");
  },
  initAudioPlayer = function (container) {
    const audio = container.querySelector("audio");
    if (!audio || container._init) {
      return;
    }
    container._init = true;
    const time = container.querySelector(".chat-audio-player__time");
    const fill = container.querySelector(".chat-audio-player__fill");
    const thumb = container.querySelector(".chat-audio-player__thumb");
    const bar = container.querySelector(".chat-audio-player__bar");
    audio.addEventListener("timeupdate", () => {
      if (container._seeking) {
        return;
      }
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      if (fill) {
        fill.style.width = pct + "%";
      }
      if (thumb) {
        thumb.style.left = pct + "%";
      }
      if (time) {
        time.textContent =
          formatAudioTime(audio.currentTime) + " / " + formatAudioTime(audio.duration);
      }
    });
    audio.addEventListener("ended", () => {
      container.classList.remove("playing");
      if (fill) {
        fill.style.width = "0%";
      }
      if (thumb) {
        thumb.style.left = "0%";
      }
    });
    bar?.addEventListener("mousedown", (e) => {
      e.preventDefault();
      container._seeking = true;
      const update = (ev) => {
        const r = bar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        if (fill) {
          fill.style.width = pct * 100 + "%";
        }
        if (thumb) {
          thumb.style.left = pct * 100 + "%";
        }
        if (time && audio.duration) {
          time.textContent =
            formatAudioTime(pct * audio.duration) + " / " + formatAudioTime(audio.duration);
        }
        container._seekPct = pct;
      };
      update(e);
      const onMove = (ev) => update(ev);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (audio.duration && container._seekPct != null) {
          audio.currentTime = container._seekPct * audio.duration;
        }
        container._seeking = false;
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  },
  handlePlayPause = function (e) {
    const container = e.currentTarget.closest(".chat-audio-player");
    if (!container) {
      return;
    }
    initAudioPlayer(container);
    const audio = container.querySelector("audio");
    if (!audio) {
      return;
    }
    if (audio.paused) {
      audio.play();
      container.classList.add("playing");
    } else {
      audio.pause();
      container.classList.remove("playing");
    }
  },
  downloadAudioFile = function (file) {
    const a = document.createElement("a");
    a.href = "/_media/" + file;
    a.download = file;
    a.click();
  },
  deleteAudioFile = async function (file, e) {
    try {
      await fetch("/_media/" + file, { method: "DELETE" });
      e.target.closest(".chat-audio-player")?.remove();
    } catch {}
  },
  renderAudioPlayers = function (files) {
    if (files.length === 0) {
      return nothing;
    }
    return html`${files.map((file) =>
      guard(
        [file],
        () => html`
        <div class="chat-audio-player">
          <audio preload="metadata" src=${"/_media/" + file}
            @loadedmetadata=${(e) => {
              const c = e.target.closest(".chat-audio-player");
              if (c) {
                initAudioPlayer(c);
                const t = c.querySelector(".chat-audio-player__time");
                if (t) {
                  t.textContent = "0:00 / " + formatAudioTime(e.target.duration);
                }
              }
            }}
            @error=${(e) => e.target.closest(".chat-audio-player")?.remove()}></audio>
          <button class="chat-audio-player__play" @click=${handlePlayPause}>
            <svg class="chat-audio-player__icon-play" viewBox="0 0 16 16"><path d="M4 2.5l10 5.5-10 5.5z"/></svg>
            <svg class="chat-audio-player__icon-pause" viewBox="0 0 16 16"><rect x="2.5" y="2" width="4" height="12" rx="1"/><rect x="9.5" y="2" width="4" height="12" rx="1"/></svg>
          </button>
          <div class="chat-audio-player__bar"><div class="chat-audio-player__fill"></div><div class="chat-audio-player__thumb"></div></div>
          <span class="chat-audio-player__time">0:00 / 0:00</span>
          <button class="chat-audio-player__download" title="Download" @click=${() => downloadAudioFile(file)}>\u2913</button>
          <button class="chat-audio-player__delete" title="Delete" @click=${(e) => deleteAudioFile(file, e)}>${icons.x}</button>
        </div>
      `,
      ),
    )}`;
  },
  renderGroupedMessage = function (
    message,
    opts,
    onOpenSidebar,
    pendingCallArgs,
    toolState,
    groupResultNames,
  ) {
    const m = message;
    const role = typeof m.role === "string" ? m.role : "unknown";
    const isToolResult =
      isToolResultMessage(message) ||
      role.toLowerCase() === "toolresult" ||
      role.toLowerCase() === "tool_result" ||
      typeof m.toolCallId === "string" ||
      typeof m.tool_call_id === "string";
    const rawCards = extractToolCards(message);
    // Collect call args into the shared queue; enrich results with matching call args.
    if (pendingCallArgs) {
      for (const card of rawCards) {
        if (card.kind === "call" && card.args) {
          pendingCallArgs.push({ name: card.name, args: card.args });
        }
      }
      for (const card of rawCards) {
        if (card.kind === "result" && !card.args) {
          const idx = pendingCallArgs.findIndex((c) => c.name === card.name);
          if (idx >= 0) {
            card.args = pendingCallArgs[idx].args;
            pendingCallArgs.splice(idx, 1);
          }
        }
      }
    }
    // Show result cards; also show unmatched calls (no result yet) so the group is never empty.
    // Merge per-message results with group-wide results to suppress call cards across messages.
    const resultNames = new Set(rawCards.filter((c) => c.kind === "result").map((c) => c.name));
    const allResultNames = groupResultNames?.size
      ? new Set([...resultNames, ...groupResultNames])
      : resultNames;
    const toolCards = rawCards.filter(
      (c) => c.kind === "result" || (c.kind === "call" && !allResultNames.has(c.name)),
    );
    const hasToolCards = toolCards.length > 0;
    const systemNotifs = extractSystemNotifications(message);
    const images = extractImages(message);
    const hasImages = images.length > 0;
    const extractedText = extractTextCached(message);
    const audioFiles = extractAudioFiles(extractedText);
    const hasAudio = audioFiles.length > 0;
    const extractedThinking =
      opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
    // Suppress short/truncated text when tool cards are present (e.g. "Deleg" before sessions_send)
    const markdownBase =
      extractedText?.trim() && !hasAudio && !(hasToolCards && extractedText.trim().length < 80)
        ? extractedText
        : null;
    const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
    const markdown = markdownBase;
    const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());
    const bubbleClasses = [
      "chat-bubble",
      canCopyMarkdown ? "has-copy" : "",
      opts.isStreaming ? "streaming" : "fade-in",
    ]
      .filter(Boolean)
      .join(" ");
    if (isToolResult) {
      if (hasToolCards) {
        return html`${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar, toolState))}`;
      }
      if (markdown) {
        const toolName =
          typeof m.toolName === "string"
            ? m.toolName
            : typeof m.tool_name === "string"
              ? m.tool_name
              : "tool";
        return html`${renderToolCardSidebar({ kind: "result", name: toolName, text: markdown }, onOpenSidebar, toolState)}`;
      }
      return nothing;
    }
    if (!markdown && !hasToolCards && !hasImages && !hasAudio && systemNotifs.length === 0) {
      return nothing;
    }
    return html`
    <div class="${bubbleClasses}">
      ${canCopyMarkdown ? renderCopyAsMarkdownButton(markdown) : nothing}
      ${systemNotifs.length > 0 ? renderSystemNotificationLines(systemNotifs) : nothing}
      ${renderMessageImages(images)}
      ${hasAudio ? renderAudioPlayers(audioFiles) : nothing}
      ${reasoningMarkdown ? html`<div class="chat-thinking">${unsafeHTML(toSanitizedMarkdownHtml(reasoningMarkdown))}</div>` : nothing}
      ${markdown ? html`<div class="chat-text" dir="${detectTextDirection(markdown)}">${unsafeHTML(toSanitizedMarkdownHtml(markdown))}</div>` : nothing}
      ${toolCards.map((card) => renderToolCardSidebar(card, onOpenSidebar, toolState))}
    </div>
  `;
  };
import { html, nothing } from "lit";
import { guard } from "lit/directives/guard.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { icons } from "../icons.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";
import { detectTextDirection } from "../text-direction.js";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.js";
import {
  extractSystemNotifications,
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.js";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.js";
import { renderStatsBar } from "./stats-bar.js";
import { extractToolCards, renderToolCardSidebar } from "./tool-cards.js";

/**
 * Render system notification lines as tool-card-style lines.
 * @param {string[]} lines
 */
const renderSystemNotificationLines = (lines) =>
  lines.map(
    (line) => html`
      <div class="chat-tool-line">
        <span class="chat-tool-line__icon">${icons.radio}</span>
        <span class="chat-tool-line__detail">${line}</span>
      </div>
    `,
  );

/** @param {{ name?: string, args?: object }} [activeTool] */
const resolveActivityHint = (assistantName, activeTool) => {
  if (!activeTool?.name) {
    return `${assistantName} is thinking\u2026`;
  }
  const t = activeTool.name;
  const a = activeTool.args ?? {};
  const file = (a.path ?? a.file_path ?? "").split("/").pop();
  if (t === "sessions_send") {
    return `Talking to ${(a.agentId ?? a.label ?? "agent").toUpperCase()}\u2026`;
  }
  if (t === "sessions_spawn") {
    return `Spawning ${a.label ?? "subagent"}\u2026`;
  }
  if (t === "memory_search") {
    return "Searching memory\u2026";
  }
  if (t === "read") {
    return file ? `Reading ${file}\u2026` : "Reading file\u2026";
  }
  if (t === "write") {
    return file ? `Writing ${file}\u2026` : "Writing file\u2026";
  }
  if (t === "edit") {
    return file ? `Editing ${file}\u2026` : "Editing file\u2026";
  }
  if (t === "bash" || t === "exec") {
    return "Running command\u2026";
  }
  if (t === "browser") {
    return "Browsing\u2026";
  }
  if (t === "config_manage") {
    const act = a.action ?? "";
    const sub = a.sub_action ?? "";
    const configHints = {
      channels:
        sub === "list" || sub === "status"
          ? "Checking channels\u2026"
          : "Configuring channel\u2026",
      usage: "Checking usage\u2026",
      tools: "Checking tools\u2026",
      security: sub === "harden" ? "Hardening security\u2026" : "Checking security\u2026",
      sessions:
        sub === "delete" || sub === "reset" ? "Resetting session\u2026" : "Checking sessions\u2026",
      cron: sub === "add" || sub === "delete" ? "Updating cron\u2026" : "Checking cron\u2026",
      logs: "Reading logs\u2026",
      nodes: "Checking nodes\u2026",
      devices: "Checking devices\u2026",
      approvals: "Checking approvals\u2026",
      backup:
        sub === "create"
          ? "Creating backup\u2026"
          : sub === "restore"
            ? "Restoring backup\u2026"
            : sub === "verify"
              ? "Verifying backup\u2026"
              : "Checking backups\u2026",
      files: "Browsing files\u2026",
      skills: sub === "install" ? "Installing skill\u2026" : "Checking skills\u2026",
      agents:
        sub === "create"
          ? "Creating agent\u2026"
          : sub === "delete"
            ? "Deleting agent\u2026"
            : sub === "rename"
              ? "Renaming agent\u2026"
              : "Checking agents\u2026",
      providers: "Checking providers\u2026",
      models: "Checking models\u2026",
      tts: "Checking TTS\u2026",
      memory: "Searching memory\u2026",
      doctor: "Running diagnostics\u2026",
      sections: "Reading config\u2026",
      view: "Reading config\u2026",
      get: "Reading config\u2026",
      set: "Updating config\u2026",
      remove: "Removing config\u2026",
      describe: "Describing config\u2026",
      status: "Checking status\u2026",
      webauthn: "Checking WebAuthn\u2026",
    };
    return configHints[act] ?? "Updating config\u2026";
  }
  if (t === "web_search") {
    return "Searching the web\u2026";
  }
  if (t === "web_fetch") {
    return "Fetching page\u2026";
  }
  if (t === "message") {
    return "Sending message\u2026";
  }
  if (t === "tts") {
    return "Generating speech\u2026";
  }
  if (t === "cron") {
    return "Managing schedule\u2026";
  }
  if (t === "image") {
    return "Generating image\u2026";
  }
  if (t === "canvas") {
    return "Updating canvas\u2026";
  }
  if (t === "nodes") {
    return "Managing device\u2026";
  }
  if (t === "gateway") {
    return "Gateway operation\u2026";
  }
  return `${assistantName} is working\u2026`;
};
const ACTIVITY_TIPS = {
  thinking: [
    "Press Escape to abort the current process",
    "Say 'enable TTS' to hear responses aloud",
    "Say 'connect WhatsApp' to pair via QR code",
    "Say 'connect OpenAI' to add a new provider",
    "Say 'show usage' to see costs and tokens",
    "Say 'show security' to review the full security status",
    "Say 'show skills' to discover available extensions",
    "Say 'make a backup' or 'list backups' to manage state snapshots",
    "Type /reset to start a fresh conversation",
  ],
  memory: ["Say 'remember that…' to store something for future sessions"],
  delegation: [
    "Say 'list my agents' to see all specialists and their status",
    "Say 'create an agent from a template' to use a preset",
  ],
  config: [
    "Say 'show providers' to see all AI providers at a glance",
    "Say 'show security' to audit, harden, or review policies",
  ],
  web: [],
  compaction: ["Type /compact to compress context at any time"],
  file: ["Say 'show my files' to browse the encrypted workspace"],
};
const resolveActivityTipCategory = (activeTool, hintOverride) => {
  if (hintOverride?.includes("Compact")) {
    return "compaction";
  }
  const t = activeTool?.name;
  if (!t) {
    return "thinking";
  }
  if (t === "memory_search") {
    return "memory";
  }
  if (t === "sessions_send" || t === "sessions_spawn") {
    return "delegation";
  }
  if (t === "config_manage") {
    return "config";
  }
  if (t === "web_search" || t === "web_fetch") {
    return "web";
  }
  if (t === "read" || t === "write" || t === "edit") {
    return "file";
  }
  return "thinking";
};
let _tipRandomOffset = 0;
const resolveRotatingTip = (category, startedAt) => {
  const raw = ACTIVITY_TIPS[category];
  const tips = raw?.length ? raw : ACTIVITY_TIPS.thinking;
  if (!_tipRandomOffset) {
    _tipRandomOffset = Math.floor(Math.random() * tips.length);
  }
  const idx =
    (_tipRandomOffset + Math.floor((Date.now() - (startedAt ?? Date.now())) / 8000)) % tips.length;
  return `Tip: ${tips[idx]}`;
};
/**
 * Format elapsed milliseconds as compact duration (e.g. "1m 23s", "45s").
 * @param {number} ms
 * @returns {string}
 */
const formatElapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};
/**
 * Format token count compact (e.g. 12400 → "12.4K").
 * @param {number} n
 * @returns {string}
 */
const formatTokensCompact = (n) => {
  if (!n || n <= 0) {
    return "0";
  }
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
};
export function renderReadingIndicatorGroup(
  assistant,
  activeTool,
  hintOverride,
  startedAt,
  compactionTokens,
  isBoosted,
) {
  const name = assistant?.name ?? "Assistant";
  const hint = hintOverride ?? resolveActivityHint(name, activeTool);
  const category = resolveActivityTipCategory(activeTool, hintOverride);
  const tip = startedAt ? resolveRotatingTip(category, startedAt) : null;
  const parts = [];
  if (startedAt) {
    parts.push(formatElapsed(Date.now() - startedAt));
  }
  if (typeof compactionTokens === "number" && compactionTokens > 0) {
    parts.push(`\u2191 ${formatTokensCompact(compactionTokens)} tokens`);
  }
  const elapsed = parts.length > 0 ? ` (${parts.join(" \u00b7 ")})` : "";
  return html`
    <div class="chat-group assistant">
      <div class="chat-group-header">
        <span class="cli-thinking-spinner ${isBoosted ? "boosted" : ""}">\u2726</span>
        <span class="cli-thinking-text">${hint}<span class="cli-thinking-stats">${elapsed}</span></span>
      </div>
      ${tip ? html`<div class="cli-thinking-tip">\u23BF ${tip}</div>` : nothing}
    </div>
  `;
}
export function renderSubagentWaitingGroup(sessions) {
  const active = sessions.filter((s) => s.running && s.key?.includes(":subagent:"));
  if (!active.length) {
    return nothing;
  }
  const label = active[0].label ?? active[0].displayName ?? "subagent";
  const count = active.length;
  const text = count > 1 ? `Waiting for ${count} subagents\u2026` : `Waiting for ${label}\u2026`;
  return html`
    <div class="chat-group assistant">
      <div class="chat-group-header">
        <span class="cli-thinking-spinner">\u2726</span>
        <span class="cli-thinking-text">${text}</span>
      </div>
    </div>
  `;
}
export function renderStreamingGroup(text, startedAt, onOpenSidebar, assistant) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? "Assistant";
  return html`
    <div class="chat-group assistant">
      <div class="chat-group-header">
        ${renderPromptSymbol("assistant")}
        <span class="chat-sender-name">[${name}]</span>
        <span class="chat-group-timestamp">${timestamp}</span>
      </div>
      <div class="chat-group-messages">
        ${renderGroupedMessage(
          {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: startedAt,
          },
          { isStreaming: true, showReasoning: false },
          onOpenSidebar,
        )}
      </div>
    </div>
  `;
}
/**
 * Extract sender agent name from inter-session provenance.
 * @param {object} group
 * @param {Map<string, string>} [agentNames]
 * @returns {string|undefined}
 */
function resolveInterSessionSender(group, agentNames) {
  const firstMsg = group.messages?.[0]?.message;
  const provenance = firstMsg?.provenance;
  if (provenance?.kind !== "inter_session" || !provenance.sourceSessionKey) {
    return;
  }
  const match = provenance.sourceSessionKey.match(/^agent:([^:]+)/);
  const agentId = match?.[1];
  if (!agentId) {
    return;
  }
  const displayName = agentNames?.get(agentId);
  return (displayName || agentId.replaceAll("-", " ")).toUpperCase();
}
/**
 * Resolve user display name from provenance or owner config.
 * @param {object} group
 * @param {object} opts
 * @returns {string|undefined}
 */
function resolveUserSenderName(group, opts) {
  const firstMsg = group.messages?.[0]?.message;
  const provenance = firstMsg?.provenance;
  if (provenance?.kind === "inter_session" && provenance.sourceSessionKey) {
    return resolveInterSessionSender(group, opts.agentNames);
  }
  if (provenance?.kind === "external_user" && provenance.humanName) {
    return provenance.humanName.toUpperCase();
  }
  return opts.ownerDisplayName?.toUpperCase() ?? undefined;
}
export function renderMessageGroup(group, opts) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const userSender = normalizedRole === "user" ? resolveUserSenderName(group, opts) : undefined;
  const who =
    userSender ??
    (normalizedRole === "user"
      ? "You"
      : normalizedRole === "assistant" || normalizedRole === "tool"
        ? assistantName
        : normalizedRole);
  const roleClass =
    normalizedRole === "user"
      ? "user"
      : normalizedRole === "assistant" || normalizedRole === "tool"
        ? "assistant"
        : normalizedRole === "system"
          ? "system"
          : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const showName = opts.showName !== false;
  // Shared queue: tool CALL args flow to their matching RESULT across messages.
  const pendingCallArgs = [];
  // Tool operation counter — sequential index per group.
  const toolState = { index: 0 };
  // Pre-collect tool names that have results across the entire group
  // so call cards are suppressed when a matching result exists in a later message.
  const groupResultNames = new Set();
  for (const item of group.messages) {
    const msg = item.message;
    if (isToolResultMessage(msg)) {
      const name = msg?.toolName ?? msg?.tool_name ?? "tool";
      groupResultNames.add(typeof name === "string" ? name : "tool");
    }
    const blocks = Array.isArray(msg?.content) ? msg.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const kind = (typeof block.type === "string" ? block.type : "").toLowerCase();
      if (kind === "toolresult" || kind === "tool_result") {
        groupResultNames.add(typeof block.name === "string" ? block.name : "tool");
      }
    }
  }
  return html`
    <div class="chat-group ${roleClass}">
      <div class="chat-group-header">
        ${renderPromptSymbol(group.role)}
        ${showName ? html`<span class="chat-sender-name">[${who}]</span>` : nothing}
        <span class="chat-group-timestamp">${timestamp}</span>
      </div>
      <div class="chat-group-messages">
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
            },
            opts.onOpenSidebar,
            pendingCallArgs,
            toolState,
            groupResultNames,
          ),
        )}
        ${group.stats ? renderStatsBar(group.stats, group.model) : nothing}
      </div>
    </div>
  `;
}
