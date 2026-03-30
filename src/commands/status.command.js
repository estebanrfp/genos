import { formatCliCommand } from "../cli/command-format.js";
import { withProgress } from "../cli/progress.js";
import { resolveGatewayPort } from "../config/config.js";
import { buildGatewayConnectionDetails, callGateway } from "../gateway/call.js";
import { info } from "../globals.js";
import { formatTimeAgo } from "../infra/format-time/format-relative.js";
import { formatUsageReportLines, loadProviderUsageSummary } from "../infra/provider-usage.js";
import { normalizeUpdateChannel, resolveUpdateChannelDisplay } from "../infra/update-channels.js";
import { formatGitInstallLabel } from "../infra/update-check.js";
import {
  resolveMemoryCacheSummary,
  resolveMemoryFtsState,
  resolveMemoryVectorState,
} from "../memory/status-format.js";
import { runSecurityAudit } from "../security/audit.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatHealthChannelLines } from "./health.js";
import { resolveControlUiLinks } from "./onboard-helpers.js";
import { statusAllCommand } from "./status-all.js";
import { formatGatewayAuthUsed } from "./status-all/format.js";
import { getDaemonStatusSummary, getNodeDaemonStatusSummary } from "./status.daemon.js";
import {
  formatDuration,
  formatKTokens,
  formatTokensCompact,
  shortenText,
} from "./status.format.js";
import { resolveGatewayProbeAuth } from "./status.gateway-probe.js";
import { scanStatus } from "./status.scan.js";
import {
  formatUpdateAvailableHint,
  formatUpdateOneLiner,
  resolveUpdateAvailability,
} from "./status.update.js";
export async function statusCommand(opts, runtime) {
  if (opts.all && !opts.json) {
    await statusAllCommand(runtime, { timeoutMs: opts.timeoutMs });
    return;
  }
  const scan = await scanStatus(
    { json: opts.json, timeoutMs: opts.timeoutMs, all: opts.all },
    runtime,
  );
  const {
    cfg,
    osSummary,
    tailscaleMode,
    tailscaleDns,
    tailscaleHttpsUrl,
    update,
    gatewayConnection,
    remoteUrlMissing,
    gatewayMode,
    gatewayProbe,
    gatewayReachable,
    gatewaySelf,
    channelIssues,
    agentStatus,
    channels,
    summary,
    memory,
    memoryPlugin,
  } = scan;
  const securityAudit = await withProgress(
    {
      label: "Running security audit\u2026",
      indeterminate: true,
      enabled: opts.json !== true,
    },
    async () =>
      await runSecurityAudit({
        config: cfg,
        deep: false,
        includeFilesystem: true,
        includeChannelSecurity: true,
      }),
  );
  const usage = opts.usage
    ? await withProgress(
        {
          label: "Fetching usage snapshot\u2026",
          indeterminate: true,
          enabled: opts.json !== true,
        },
        async () => await loadProviderUsageSummary({ timeoutMs: opts.timeoutMs }),
      )
    : undefined;
  const health = opts.deep
    ? await withProgress(
        {
          label: "Checking gateway health\u2026",
          indeterminate: true,
          enabled: opts.json !== true,
        },
        async () =>
          await callGateway({
            method: "health",
            params: { probe: true },
            timeoutMs: opts.timeoutMs,
          }),
      )
    : undefined;
  const lastHeartbeat =
    opts.deep && gatewayReachable
      ? await callGateway({
          method: "last-heartbeat",
          params: {},
          timeoutMs: opts.timeoutMs,
        }).catch(() => null)
      : null;
  const configChannel = normalizeUpdateChannel(cfg.update?.channel);
  const channelInfo = resolveUpdateChannelDisplay({
    configChannel,
    installKind: update.installKind,
    gitTag: update.git?.tag ?? null,
    gitBranch: update.git?.branch ?? null,
  });
  if (opts.json) {
    const [daemon, nodeDaemon] = await Promise.all([
      getDaemonStatusSummary(),
      getNodeDaemonStatusSummary(),
    ]);
    runtime.log(
      JSON.stringify(
        {
          ...summary,
          os: osSummary,
          update,
          updateChannel: channelInfo.channel,
          updateChannelSource: channelInfo.source,
          memory,
          memoryPlugin,
          gateway: {
            mode: gatewayMode,
            url: gatewayConnection.url,
            urlSource: gatewayConnection.urlSource,
            misconfigured: remoteUrlMissing,
            reachable: gatewayReachable,
            connectLatencyMs: gatewayProbe?.connectLatencyMs ?? null,
            self: gatewaySelf,
            error: gatewayProbe?.error ?? null,
          },
          gatewayService: daemon,
          nodeService: nodeDaemon,
          agents: agentStatus,
          securityAudit,
          ...(health || usage || lastHeartbeat ? { health, usage, lastHeartbeat } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  const rich = true;
  const muted = (value) => (rich ? theme.muted(value) : value);
  const ok = (value) => (rich ? theme.success(value) : value);
  const warn = (value) => (rich ? theme.warn(value) : value);
  if (opts.verbose) {
    const details = buildGatewayConnectionDetails();
    runtime.log(info("Gateway connection:"));
    for (const line of details.message.split("\n")) {
      runtime.log(`  ${line}`);
    }
    runtime.log("");
  }
  const tableWidth = Math.max(60, (process.stdout.columns ?? 120) - 1);
  const dashboard = (() => {
    const controlUiEnabled = cfg.gateway?.controlUi?.enabled ?? true;
    if (!controlUiEnabled) {
      return "disabled";
    }
    const links = resolveControlUiLinks({
      port: resolveGatewayPort(cfg),
      bind: cfg.gateway?.bind,
      customBindHost: cfg.gateway?.customBindHost,
      basePath: cfg.gateway?.controlUi?.basePath,
    });
    return links.httpUrl;
  })();
  const gatewayValue = (() => {
    const target = remoteUrlMissing
      ? `fallback ${gatewayConnection.url}`
      : `${gatewayConnection.url}${gatewayConnection.urlSource ? ` (${gatewayConnection.urlSource})` : ""}`;
    const reach = remoteUrlMissing
      ? warn("misconfigured (remote.url missing)")
      : gatewayReachable
        ? ok(`reachable ${formatDuration(gatewayProbe?.connectLatencyMs)}`)
        : warn(gatewayProbe?.error ? `unreachable (${gatewayProbe.error})` : "unreachable");
    const auth =
      gatewayReachable && !remoteUrlMissing
        ? ` \xB7 auth ${formatGatewayAuthUsed(resolveGatewayProbeAuth(cfg))}`
        : "";
    const self =
      gatewaySelf?.host || gatewaySelf?.version || gatewaySelf?.platform
        ? [
            gatewaySelf?.host ? gatewaySelf.host : null,
            gatewaySelf?.ip ? `(${gatewaySelf.ip})` : null,
            gatewaySelf?.version ? `app ${gatewaySelf.version}` : null,
            gatewaySelf?.platform ? gatewaySelf.platform : null,
          ]
            .filter(Boolean)
            .join(" ")
        : null;
    const suffix = self ? ` \xB7 ${self}` : "";
    return `${gatewayMode} \xB7 ${target} \xB7 ${reach}${auth}${suffix}`;
  })();
  const agentsValue = (() => {
    const pending =
      agentStatus.bootstrapPendingCount > 0
        ? `${agentStatus.bootstrapPendingCount} bootstrapping`
        : "no bootstraps";
    const def = agentStatus.agents.find((a) => a.id === agentStatus.defaultId);
    const defActive = def?.lastActiveAgeMs != null ? formatTimeAgo(def.lastActiveAgeMs) : "unknown";
    const defSuffix = def ? ` \xB7 default ${def.id} active ${defActive}` : "";
    return `${agentStatus.agents.length} \xB7 ${pending} \xB7 sessions ${agentStatus.totalSessions}${defSuffix}`;
  })();
  const [daemon, nodeDaemon] = await Promise.all([
    getDaemonStatusSummary(),
    getNodeDaemonStatusSummary(),
  ]);
  const daemonValue = (() => {
    if (daemon.installed === false) {
      return `${daemon.label} not installed`;
    }
    const installedPrefix = daemon.installed === true ? "installed \xB7 " : "";
    return `${daemon.label} ${installedPrefix}${daemon.loadedText}${daemon.runtimeShort ? ` \xB7 ${daemon.runtimeShort}` : ""}`;
  })();
  const nodeDaemonValue = (() => {
    if (nodeDaemon.installed === false) {
      return `${nodeDaemon.label} not installed`;
    }
    const installedPrefix = nodeDaemon.installed === true ? "installed \xB7 " : "";
    return `${nodeDaemon.label} ${installedPrefix}${nodeDaemon.loadedText}${nodeDaemon.runtimeShort ? ` \xB7 ${nodeDaemon.runtimeShort}` : ""}`;
  })();
  const defaults = summary.sessions.defaults;
  const defaultCtx = defaults.contextTokens
    ? ` (${formatKTokens(defaults.contextTokens)} ctx)`
    : "";
  const eventsValue =
    summary.queuedSystemEvents.length > 0 ? `${summary.queuedSystemEvents.length} queued` : "none";
  const probesValue = health ? ok("enabled") : muted("skipped (use --deep)");
  const heartbeatValue = (() => {
    const parts = summary.heartbeat.agents
      .map((agent) => {
        if (!agent.enabled || !agent.everyMs) {
          return `disabled (${agent.agentId})`;
        }
        const everyLabel = agent.every;
        return `${everyLabel} (${agent.agentId})`;
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "disabled";
  })();
  const lastHeartbeatValue = (() => {
    if (!opts.deep) {
      return null;
    }
    if (!gatewayReachable) {
      return warn("unavailable");
    }
    if (!lastHeartbeat) {
      return muted("none");
    }
    const age = formatTimeAgo(Date.now() - lastHeartbeat.ts);
    const channel = lastHeartbeat.channel ?? "unknown";
    const accountLabel = lastHeartbeat.accountId ? `account ${lastHeartbeat.accountId}` : null;
    return [lastHeartbeat.status, `${age} ago`, channel, accountLabel]
      .filter(Boolean)
      .join(" \xB7 ");
  })();
  const storeLabel =
    summary.sessions.paths.length > 1
      ? `${summary.sessions.paths.length} stores`
      : (summary.sessions.paths[0] ?? "unknown");
  const memoryValue = (() => {
    if (!memoryPlugin.enabled) {
      const suffix = memoryPlugin.reason ? ` (${memoryPlugin.reason})` : "";
      return muted(`disabled${suffix}`);
    }
    if (!memory) {
      const slot = memoryPlugin.slot ? `plugin ${memoryPlugin.slot}` : "plugin";
      if (memoryPlugin.slot && memoryPlugin.slot !== "memory-core") {
        return `enabled (${slot})`;
      }
      return muted(`enabled (${slot}) \xB7 unavailable`);
    }
    const parts = [];
    const dirtySuffix = memory.dirty ? ` \xB7 ${warn("dirty")}` : "";
    parts.push(`${memory.files} files \xB7 ${memory.chunks} chunks${dirtySuffix}`);
    if (memory.sources?.length) {
      parts.push(`sources ${memory.sources.join(", ")}`);
    }
    if (memoryPlugin.slot) {
      parts.push(`plugin ${memoryPlugin.slot}`);
    }
    const colorByTone = (tone, text) =>
      tone === "ok" ? ok(text) : tone === "warn" ? warn(text) : muted(text);
    const vector = memory.vector;
    if (vector) {
      const state = resolveMemoryVectorState(vector);
      const label = state.state === "disabled" ? "vector off" : `vector ${state.state}`;
      parts.push(colorByTone(state.tone, label));
    }
    const fts = memory.fts;
    if (fts) {
      const state = resolveMemoryFtsState(fts);
      const label = state.state === "disabled" ? "fts off" : `fts ${state.state}`;
      parts.push(colorByTone(state.tone, label));
    }
    const cache = memory.cache;
    if (cache) {
      const summary = resolveMemoryCacheSummary(cache);
      parts.push(colorByTone(summary.tone, summary.text));
    }
    return parts.join(" \xB7 ");
  })();
  const updateAvailability = resolveUpdateAvailability(update);
  const updateLine = formatUpdateOneLiner(update).replace(/^Update:\s*/i, "");
  const channelLabel = channelInfo.label;
  const gitLabel = formatGitInstallLabel(update);
  const overviewRows = [
    { Item: "Dashboard", Value: dashboard },
    { Item: "OS", Value: `${osSummary.label} \xB7 node ${process.versions.node}` },
    {
      Item: "Tailscale",
      Value:
        tailscaleMode === "off"
          ? muted("off")
          : tailscaleDns && tailscaleHttpsUrl
            ? `${tailscaleMode} \xB7 ${tailscaleDns} \xB7 ${tailscaleHttpsUrl}`
            : warn(`${tailscaleMode} \xB7 magicdns unknown`),
    },
    { Item: "Channel", Value: channelLabel },
    ...(gitLabel ? [{ Item: "Git", Value: gitLabel }] : []),
    {
      Item: "Update",
      Value: updateAvailability.available ? warn(`available \xB7 ${updateLine}`) : updateLine,
    },
    { Item: "Gateway", Value: gatewayValue },
    { Item: "Gateway service", Value: daemonValue },
    { Item: "Node service", Value: nodeDaemonValue },
    { Item: "Agents", Value: agentsValue },
    { Item: "Memory", Value: memoryValue },
    { Item: "Probes", Value: probesValue },
    { Item: "Events", Value: eventsValue },
    { Item: "Heartbeat", Value: heartbeatValue },
    ...(lastHeartbeatValue ? [{ Item: "Last heartbeat", Value: lastHeartbeatValue }] : []),
    {
      Item: "Sessions",
      Value: `${summary.sessions.count} active \xB7 default ${defaults.model ?? "unknown"}${defaultCtx} \xB7 ${storeLabel}`,
    },
  ];
  runtime.log(theme.heading("GenosOS status"));
  runtime.log("");
  runtime.log(theme.heading("Overview"));
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Item", header: "Item", minWidth: 12 },
        { key: "Value", header: "Value", flex: true, minWidth: 32 },
      ],
      rows: overviewRows,
    }).trimEnd(),
  );
  runtime.log("");
  runtime.log(theme.heading("Security audit"));
  const fmtSummary = (value) => {
    const parts = [
      theme.error(`${value.critical} critical`),
      theme.warn(`${value.warn} warn`),
      theme.muted(`${value.info} info`),
    ];
    return parts.join(" \xB7 ");
  };
  runtime.log(theme.muted(`Summary: ${fmtSummary(securityAudit.summary)}`));
  const importantFindings = securityAudit.findings.filter(
    (f) => f.severity === "critical" || f.severity === "warn",
  );
  if (importantFindings.length === 0) {
    runtime.log(theme.muted("No critical or warn findings detected."));
  } else {
    const severityLabel = (sev) => {
      if (sev === "critical") {
        return theme.error("CRITICAL");
      }
      if (sev === "warn") {
        return theme.warn("WARN");
      }
      return theme.muted("INFO");
    };
    const sevRank = (sev) => (sev === "critical" ? 0 : sev === "warn" ? 1 : 2);
    const sorted = [...importantFindings].toSorted(
      (a, b) => sevRank(a.severity) - sevRank(b.severity),
    );
    const shown = sorted.slice(0, 6);
    for (const f of shown) {
      runtime.log(`  ${severityLabel(f.severity)} ${f.title}`);
      runtime.log(`    ${shortenText(f.detail.replaceAll("\n", " "), 160)}`);
      if (f.remediation?.trim()) {
        runtime.log(`    ${theme.muted(`Fix: ${f.remediation.trim()}`)}`);
      }
    }
    if (sorted.length > shown.length) {
      runtime.log(theme.muted(`\u2026 +${sorted.length - shown.length} more`));
    }
  }
  runtime.log(theme.muted(`Full report: ${formatCliCommand("genosos security audit")}`));
  runtime.log(theme.muted(`Deep probe: ${formatCliCommand("genosos security audit --deep")}`));
  runtime.log("");
  runtime.log(theme.heading("Channels"));
  const channelIssuesByChannel = (() => {
    const map = new Map();
    for (const issue of channelIssues) {
      const key = issue.channel;
      const list = map.get(key);
      if (list) {
        list.push(issue);
      } else {
        map.set(key, [issue]);
      }
    }
    return map;
  })();
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Channel", header: "Channel", minWidth: 10 },
        { key: "Enabled", header: "Enabled", minWidth: 7 },
        { key: "State", header: "State", minWidth: 8 },
        { key: "Detail", header: "Detail", flex: true, minWidth: 24 },
      ],
      rows: channels.rows.map((row) => {
        const issues = channelIssuesByChannel.get(row.id) ?? [];
        const effectiveState = row.state === "off" ? "off" : issues.length > 0 ? "warn" : row.state;
        const issueSuffix =
          issues.length > 0
            ? ` \xB7 ${warn(`gateway: ${shortenText(issues[0]?.message ?? "issue", 84)}`)}`
            : "";
        return {
          Channel: row.label,
          Enabled: row.enabled ? ok("ON") : muted("OFF"),
          State:
            effectiveState === "ok"
              ? ok("OK")
              : effectiveState === "warn"
                ? warn("WARN")
                : effectiveState === "off"
                  ? muted("OFF")
                  : theme.accentDim("SETUP"),
          Detail: `${row.detail}${issueSuffix}`,
        };
      }),
    }).trimEnd(),
  );
  runtime.log("");
  runtime.log(theme.heading("Sessions"));
  runtime.log(
    renderTable({
      width: tableWidth,
      columns: [
        { key: "Key", header: "Key", minWidth: 20, flex: true },
        { key: "Kind", header: "Kind", minWidth: 6 },
        { key: "Age", header: "Age", minWidth: 9 },
        { key: "Model", header: "Model", minWidth: 14 },
        { key: "Tokens", header: "Tokens", minWidth: 16 },
      ],
      rows:
        summary.sessions.recent.length > 0
          ? summary.sessions.recent.map((sess) => ({
              Key: shortenText(sess.key, 32),
              Kind: sess.kind,
              Age: sess.updatedAt ? formatTimeAgo(sess.age) : "no activity",
              Model: sess.model ?? "unknown",
              Tokens: formatTokensCompact(sess),
            }))
          : [
              {
                Key: muted("no sessions yet"),
                Kind: "",
                Age: "",
                Model: "",
                Tokens: "",
              },
            ],
    }).trimEnd(),
  );
  if (summary.queuedSystemEvents.length > 0) {
    runtime.log("");
    runtime.log(theme.heading("System events"));
    runtime.log(
      renderTable({
        width: tableWidth,
        columns: [{ key: "Event", header: "Event", flex: true, minWidth: 24 }],
        rows: summary.queuedSystemEvents.slice(0, 5).map((event) => ({
          Event: event,
        })),
      }).trimEnd(),
    );
    if (summary.queuedSystemEvents.length > 5) {
      runtime.log(muted(`\u2026 +${summary.queuedSystemEvents.length - 5} more`));
    }
  }
  if (health) {
    runtime.log("");
    runtime.log(theme.heading("Health"));
    const rows = [];
    rows.push({
      Item: "Gateway",
      Status: ok("reachable"),
      Detail: `${health.durationMs}ms`,
    });
    for (const line of formatHealthChannelLines(health, { accountMode: "all" })) {
      const colon = line.indexOf(":");
      if (colon === -1) {
        continue;
      }
      const item = line.slice(0, colon).trim();
      const detail = line.slice(colon + 1).trim();
      const normalized = detail.toLowerCase();
      const status = (() => {
        if (normalized.startsWith("ok")) {
          return ok("OK");
        }
        if (normalized.startsWith("failed")) {
          return warn("WARN");
        }
        if (normalized.startsWith("not configured")) {
          return muted("OFF");
        }
        if (normalized.startsWith("configured")) {
          return ok("OK");
        }
        if (normalized.startsWith("linked")) {
          return ok("LINKED");
        }
        if (normalized.startsWith("not linked")) {
          return warn("UNLINKED");
        }
        return warn("WARN");
      })();
      rows.push({ Item: item, Status: status, Detail: detail });
    }
    runtime.log(
      renderTable({
        width: tableWidth,
        columns: [
          { key: "Item", header: "Item", minWidth: 10 },
          { key: "Status", header: "Status", minWidth: 8 },
          { key: "Detail", header: "Detail", flex: true, minWidth: 28 },
        ],
        rows,
      }).trimEnd(),
    );
  }
  if (usage) {
    runtime.log("");
    runtime.log(theme.heading("Usage"));
    for (const line of formatUsageReportLines(usage)) {
      runtime.log(line);
    }
  }
  runtime.log("");
  runtime.log("FAQ: https://docs.genos.ai/faq");
  runtime.log("Troubleshooting: https://docs.genos.ai/troubleshooting");
  runtime.log("");
  const updateHint = formatUpdateAvailableHint(update);
  if (updateHint) {
    runtime.log(theme.warn(updateHint));
    runtime.log("");
  }
  runtime.log("Next steps:");
  runtime.log(`  Need to share?      ${formatCliCommand("genosos status --all")}`);
  runtime.log(`  Need to debug live? ${formatCliCommand("genosos logs --follow")}`);
  if (gatewayReachable) {
    runtime.log(`  Need to test channels? ${formatCliCommand("genosos status --deep")}`);
  } else {
    runtime.log(`  Fix reachability first: ${formatCliCommand("genosos gateway probe")}`);
  }
}
