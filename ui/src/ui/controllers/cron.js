import { toNumber } from "../format.js";
export function supportsAnnounceDelivery(form) {
  return form.sessionTarget === "isolated" && form.payloadKind === "agentTurn";
}
export function normalizeCronFormState(form) {
  if (form.deliveryMode !== "announce") {
    return form;
  }
  if (supportsAnnounceDelivery(form)) {
    return form;
  }
  return {
    ...form,
    deliveryMode: "none",
  };
}
export async function loadCronStatus(state) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request("cron.status", {});
    state.cronStatus = res;
  } catch (err) {
    state.cronError = String(err);
  }
}
export async function loadCronJobs(state) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.cronLoading) {
    return;
  }
  state.cronLoading = true;
  state.cronError = null;
  try {
    const res = await state.client.request("cron.list", {
      includeDisabled: true,
    });
    state.cronJobs = Array.isArray(res.jobs) ? res.jobs : [];
  } catch (err) {
    state.cronError = String(err);
  } finally {
    state.cronLoading = false;
  }
}
export function buildCronSchedule(form) {
  if (form.scheduleKind === "at") {
    const ms = Date.parse(form.scheduleAt);
    if (!Number.isFinite(ms)) {
      throw new Error("Invalid run time.");
    }
    return { kind: "at", at: new Date(ms).toISOString() };
  }
  if (form.scheduleKind === "every") {
    const amount = toNumber(form.everyAmount, 0);
    if (amount <= 0) {
      throw new Error("Invalid interval amount.");
    }
    const unit = form.everyUnit;
    const mult = unit === "minutes" ? 60000 : unit === "hours" ? 3600000 : 86400000;
    return { kind: "every", everyMs: amount * mult };
  }
  const expr = form.cronExpr.trim();
  if (!expr) {
    throw new Error("Cron expression required.");
  }
  return { kind: "cron", expr, tz: form.cronTz.trim() || undefined };
}
export function buildCronPayload(form) {
  if (form.payloadKind === "systemEvent") {
    const text = form.payloadText.trim();
    if (!text) {
      throw new Error("System event text required.");
    }
    return { kind: "systemEvent", text };
  }
  const message = form.payloadText.trim();
  if (!message) {
    throw new Error("Agent message required.");
  }
  const payload = { kind: "agentTurn", message };
  const timeoutSeconds = toNumber(form.timeoutSeconds, 0);
  if (timeoutSeconds > 0) {
    payload.timeoutSeconds = timeoutSeconds;
  }
  return payload;
}
export async function addCronJob(state) {
  if (!state.client || !state.connected || state.cronBusy) {
    return;
  }
  state.cronBusy = true;
  state.cronError = null;
  try {
    const form = normalizeCronFormState(state.cronForm);
    if (form !== state.cronForm) {
      state.cronForm = form;
    }
    const schedule = buildCronSchedule(form);
    const payload = buildCronPayload(form);
    const selectedDeliveryMode = form.deliveryMode;
    const delivery =
      selectedDeliveryMode && selectedDeliveryMode !== "none"
        ? {
            mode: selectedDeliveryMode,
            channel:
              selectedDeliveryMode === "announce"
                ? form.deliveryChannel.trim() || "last"
                : undefined,
            to: form.deliveryTo.trim() || undefined,
          }
        : undefined;
    const agentId = form.agentId.trim();
    const job = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      agentId: agentId || undefined,
      enabled: form.enabled,
      schedule,
      sessionTarget: form.sessionTarget,
      wakeMode: form.wakeMode,
      payload,
      delivery,
    };
    if (!job.name) {
      throw new Error("Name required.");
    }
    await state.client.request("cron.add", job);
    state.cronForm = {
      ...state.cronForm,
      name: "",
      description: "",
      payloadText: "",
    };
    await loadCronJobs(state);
    await loadCronStatus(state);
  } catch (err) {
    state.cronError = String(err);
  } finally {
    state.cronBusy = false;
  }
}
export async function toggleCronJob(state, job, enabled) {
  if (!state.client || !state.connected || state.cronBusy) {
    return;
  }
  state.cronBusy = true;
  state.cronError = null;
  try {
    await state.client.request("cron.update", { id: job.id, patch: { enabled } });
    await loadCronJobs(state);
    await loadCronStatus(state);
  } catch (err) {
    state.cronError = String(err);
  } finally {
    state.cronBusy = false;
  }
}
export async function runCronJob(state, job) {
  if (!state.client || !state.connected || state.cronBusy) {
    return;
  }
  state.cronBusy = true;
  state.cronError = null;
  try {
    await state.client.request("cron.run", { id: job.id, mode: "force" });
    await loadCronRuns(state, job.id);
  } catch (err) {
    state.cronError = String(err);
  } finally {
    state.cronBusy = false;
  }
}
export async function removeCronJob(state, job) {
  if (!state.client || !state.connected || state.cronBusy) {
    return;
  }
  state.cronBusy = true;
  state.cronError = null;
  try {
    await state.client.request("cron.remove", { id: job.id });
    if (state.cronRunsJobId === job.id) {
      state.cronRunsJobId = null;
      state.cronRuns = [];
    }
    await loadCronJobs(state);
    await loadCronStatus(state);
  } catch (err) {
    state.cronError = String(err);
  } finally {
    state.cronBusy = false;
  }
}
export async function loadCronRuns(state, jobId) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request("cron.runs", {
      id: jobId,
      limit: 50,
    });
    state.cronRunsJobId = jobId;
    state.cronRuns = Array.isArray(res.entries) ? res.entries : [];
  } catch (err) {
    state.cronError = String(err);
  }
}
