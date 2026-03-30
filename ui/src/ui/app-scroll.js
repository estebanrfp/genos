const NEAR_BOTTOM_THRESHOLD = 450;
const pickScrollTarget = (host) => {
  const container = host.querySelector(".chat-thread");
  if (container && container.scrollHeight - container.clientHeight > 1) {
    return container;
  }
  return document.scrollingElement ?? document.documentElement;
};
export function scheduleChatScroll(host, force = false, smooth = false) {
  if (host.chatScrollFrame) {
    cancelAnimationFrame(host.chatScrollFrame);
  }
  if (host.chatScrollTimeout != null) {
    clearTimeout(host.chatScrollTimeout);
    host.chatScrollTimeout = null;
  }
  host.updateComplete.then(() => {
    const target = pickScrollTarget(host);
    if (!target) {
      return;
    }
    const isStreaming = host.chatStream != null;
    // Fast path: during streaming, scroll immediately (no RAF = no 1-frame jitter)
    if (isStreaming && host.chatUserNearBottom) {
      target.scrollTop = target.scrollHeight;
      host.chatNewMessagesBelow = false;
      return;
    }
    // Standard path: use RAF for non-streaming updates
    host.chatScrollFrame = requestAnimationFrame(() => {
      host.chatScrollFrame = null;
      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      const effectiveForce = force && !host.chatHasAutoScrolled;
      const shouldStick =
        effectiveForce || host.chatUserNearBottom || distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
      if (!shouldStick) {
        host.chatNewMessagesBelow = true;
        return;
      }
      if (effectiveForce) {
        host.chatHasAutoScrolled = true;
      }
      const smoothEnabled =
        smooth &&
        (typeof window === "undefined" ||
          typeof window.matchMedia !== "function" ||
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (typeof target.scrollTo === "function") {
        target.scrollTo({ top: target.scrollHeight, behavior: smoothEnabled ? "smooth" : "auto" });
      } else {
        target.scrollTop = target.scrollHeight;
      }
      host.chatUserNearBottom = true;
      host.chatNewMessagesBelow = false;
      const retryDelay = effectiveForce ? 150 : 120;
      host.chatScrollTimeout = window.setTimeout(() => {
        host.chatScrollTimeout = null;
        const latest = pickScrollTarget(host);
        if (!latest) {
          return;
        }
        const latestDistanceFromBottom =
          latest.scrollHeight - latest.scrollTop - latest.clientHeight;
        const shouldStickRetry =
          effectiveForce ||
          host.chatUserNearBottom ||
          latestDistanceFromBottom < NEAR_BOTTOM_THRESHOLD;
        if (!shouldStickRetry) {
          return;
        }
        latest.scrollTop = latest.scrollHeight;
        host.chatUserNearBottom = true;
      }, retryDelay);
    });
  });
}
export function scheduleLogsScroll(host, force = false) {
  if (host.logsScrollFrame) {
    cancelAnimationFrame(host.logsScrollFrame);
  }
  host.updateComplete.then(() => {
    host.logsScrollFrame = requestAnimationFrame(() => {
      host.logsScrollFrame = null;
      const container = host.querySelector(".log-stream");
      if (!container) {
        return;
      }
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const shouldStick = force || distanceFromBottom < 80;
      if (!shouldStick) {
        return;
      }
      container.scrollTop = container.scrollHeight;
    });
  });
}
export function handleChatScroll(host, event) {
  const container = event.currentTarget;
  if (!container) {
    return;
  }
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  host.chatUserNearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
  if (host.chatUserNearBottom || host.chatStream != null) {
    host.chatNewMessagesBelow = false;
  }
}
export function handleLogsScroll(host, event) {
  const container = event.currentTarget;
  if (!container) {
    return;
  }
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  host.logsAtBottom = distanceFromBottom < 80;
}
export function resetChatScroll(host) {
  host.chatHasAutoScrolled = false;
  host.chatUserNearBottom = true;
  host.chatNewMessagesBelow = false;
}
export function exportLogs(lines, label) {
  if (lines.length === 0) {
    return;
  }
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  anchor.href = url;
  anchor.download = `genosos-logs-${label}-${stamp}.log`;
  anchor.click();
  URL.revokeObjectURL(url);
}
export function observeTopbar(host) {
  if (typeof ResizeObserver === "undefined") {
    return;
  }
  const topbar = host.querySelector(".topbar");
  if (!topbar) {
    return;
  }
  const update = () => {
    const { height } = topbar.getBoundingClientRect();
    host.style.setProperty("--topbar-height", `${height}px`);
  };
  update();
  host.topbarObserver = new ResizeObserver(() => update());
  host.topbarObserver.observe(topbar);
}
