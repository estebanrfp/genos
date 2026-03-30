import { toggleCronJob } from "./cron.js";

const STORAGE_KEY = "genosos-board-manual";

/**
 * Build auto-generated cards from live gateway data.
 * @param {object} host - GenosOSApp instance
 * @returns {{ pending: Array, inProgress: Array, completed: Array, reviewed: Array }}
 */
const buildLiveCards = (host) => {
  const pending = [];
  const inProgress = [];
  const completed = [];
  const reviewed = [];

  // Sessions → In Progress (active) or Completed (stale)
  const sessions = host.sessionsResult?.sessions ?? [];
  for (const s of sessions) {
    if (s.kind === "global") {
      continue;
    }
    const card = {
      id: `session:${s.key}`,
      title: s.label || s.key,
      description: `Session \u00b7 ${s.kind ?? "standard"}`,
      createdAt: s.updatedAt ?? Date.now(),
      source: "session",
      sourceId: s.key,
    };
    const tenMin = 10 * 60 * 1000;
    if (s.updatedAt && Date.now() - s.updatedAt < tenMin) {
      inProgress.push(card);
    } else {
      completed.push(card);
    }
  }

  // Cron jobs → Pending (disabled) or In Progress (enabled)
  const jobs = host.cronJobs ?? [];
  for (const job of jobs) {
    const card = {
      id: `cron:${job.id}`,
      title: job.name || `Cron ${job.id}`,
      description: `Cron \u00b7 ${job.agentId ?? "default"} \u00b7 ${job.sessionTarget ?? ""}`,
      createdAt: Date.now(),
      source: "cron",
      sourceId: job.id,
      draggable: true,
    };
    if (job.enabled) {
      inProgress.push(card);
    } else {
      pending.push(card);
    }
  }

  // Agents → Reviewed (configured and ready)
  const agents = host.agentsList?.agents ?? [];
  for (const agent of agents) {
    reviewed.push({
      id: `agent:${agent.id}`,
      title: agent.id,
      description: `Agent \u00b7 ${agent.model ?? "default model"}`,
      createdAt: Date.now(),
      source: "agent",
      sourceId: agent.id,
    });
  }

  // Channels unhealthy → Pending
  const channelMeta = host.channelsSnapshot?.channelMeta ?? [];
  for (const ch of channelMeta) {
    if (ch.healthy === false) {
      pending.push({
        id: `channel:${ch.id}`,
        title: ch.label || ch.id,
        description: `Channel \u00b7 unhealthy`,
        createdAt: Date.now(),
        source: "channel",
        sourceId: ch.id,
      });
    }
  }

  return { pending, inProgress, completed, reviewed };
};

/**
 * Load manual cards from localStorage.
 * @returns {object}
 */
const loadManualCards = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

/**
 * Save manual cards to localStorage.
 * @param {object} manual
 */
const saveManualCards = (manual) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(manual));
  } catch {
    /* storage full */
  }
};

/**
 * Merge live + manual cards into board columns.
 * @param {object} host - GenosOSApp instance
 */
export const loadBoard = (host) => {
  const live = buildLiveCards(host);
  const manual = loadManualCards();

  host.boardColumns = [
    { id: "pending", label: "Pending", cards: [...live.pending, ...(manual.pending ?? [])] },
    {
      id: "in-progress",
      label: "In Progress",
      cards: [...live.inProgress, ...(manual["in-progress"] ?? [])],
    },
    {
      id: "completed",
      label: "Completed",
      cards: [...live.completed, ...(manual.completed ?? [])],
    },
    { id: "reviewed", label: "Reviewed", cards: [...live.reviewed, ...(manual.reviewed ?? [])] },
  ];
};

/**
 * Add a manual card to a column.
 * @param {object} host
 * @param {string} columnId
 * @param {{ title: string, description?: string }} card
 */
export const addCard = (host, columnId, card) => {
  const manual = loadManualCards();
  if (!manual[columnId]) {
    manual[columnId] = [];
  }
  manual[columnId].push({
    id: crypto.randomUUID(),
    title: card.title,
    description: card.description ?? "",
    createdAt: Date.now(),
    source: "manual",
    draggable: true,
  });
  saveManualCards(manual);
  loadBoard(host);
};

/**
 * Resolve the source and ID from a card ID prefix.
 * @param {string} cardId - e.g. "cron:abc123" or a UUID
 * @returns {{ source: string, sourceId: string }}
 */
const parseCardId = (cardId) => {
  const sep = cardId.indexOf(":");
  if (sep < 0) {
    return { source: "manual", sourceId: cardId };
  }
  return { source: cardId.slice(0, sep), sourceId: cardId.slice(sep + 1) };
};

/** Column IDs that mean "active/enabled". */
const ACTIVE_COLUMNS = new Set(["in-progress", "completed", "reviewed"]);

/**
 * Move a card between columns. Executes real gateway actions for live cards.
 * - Cron: drag to in-progress/completed/reviewed = enable, drag to pending = disable
 * - Manual: free move between columns
 * @param {object} host
 * @param {string} cardId
 * @param {string} fromCol
 * @param {string} toCol
 */
export const moveCard = async (host, cardId, fromCol, toCol) => {
  if (fromCol === toCol) {
    return;
  }

  const { source, sourceId } = parseCardId(cardId);

  // Cron job: toggle enabled state via RPC
  if (source === "cron") {
    const job = (host.cronJobs ?? []).find((j) => j.id === sourceId);
    if (!job) {
      return;
    }
    const shouldEnable = ACTIVE_COLUMNS.has(toCol);
    if (job.enabled === shouldEnable) {
      return;
    } // Already in target state
    await toggleCronJob(host, job, shouldEnable);
    loadBoard(host);
    return;
  }

  // Manual cards: move in localStorage
  if (source === "manual") {
    const manual = loadManualCards();
    const src = manual[fromCol] ?? [];
    const idx = src.findIndex((c) => c.id === cardId);
    if (idx < 0) {
      return;
    }
    const [card] = src.splice(idx, 1);
    if (!manual[toCol]) {
      manual[toCol] = [];
    }
    manual[toCol].push(card);
    manual[fromCol] = src;
    saveManualCards(manual);
    loadBoard(host);
    return;
  }

  // Sessions, agents, channels: no action (read-only)
};

/**
 * Remove a manual card from a column.
 * @param {object} host
 * @param {string} cardId
 * @param {string} columnId
 */
export const removeCard = (host, cardId, columnId) => {
  const manual = loadManualCards();
  if (!manual[columnId]) {
    return;
  }
  manual[columnId] = manual[columnId].filter((c) => c.id !== cardId);
  saveManualCards(manual);
  loadBoard(host);
};

/**
 * Search board cards by query string.
 * @param {object} host
 * @param {string} query
 */
export const searchBoard = (host, query) => {
  const q = query.trim().toLowerCase();
  if (!q) {
    host.boardSearchResults = [];
    return;
  }
  const results = [];
  for (const col of host.boardColumns ?? []) {
    for (const card of col.cards) {
      const titleMatch = card.title.toLowerCase().includes(q);
      const descMatch = card.description?.toLowerCase().includes(q);
      if (titleMatch || descMatch) {
        results.push({ ...card, columnId: col.id, columnLabel: col.label });
      }
    }
  }
  host.boardSearchResults = results;
};

/**
 * Filter activity events by type.
 * Events have shape { ts, event, payload }.
 * @param {Array} events
 * @param {string} filter - "all" | "chat" | "agent" | "cron"
 * @returns {Array}
 */
export const filterActivity = (events, filter) => {
  if (filter === "all") {
    return events;
  }
  return events.filter((e) => {
    const ev = (e?.event ?? "").toLowerCase();
    if (filter === "chat") {
      return ev.includes("chat") || ev.includes("message");
    }
    if (filter === "agent") {
      return ev.includes("agent") || ev.includes("run");
    }
    if (filter === "cron") {
      return ev.includes("cron") || ev.includes("schedule");
    }
    return true;
  });
};
