export function buildUsageAggregateTail(params) {
  return {
    byChannel: Array.from(params.byChannelMap.entries())
      .map(([channel, totals]) => ({ channel, totals }))
      .toSorted((a, b) => b.totals.totalCost - a.totals.totalCost),
    latency:
      params.latencyTotals.count > 0
        ? {
            count: params.latencyTotals.count,
            avgMs: params.latencyTotals.sum / params.latencyTotals.count,
            minMs:
              params.latencyTotals.min === Number.POSITIVE_INFINITY ? 0 : params.latencyTotals.min,
            maxMs: params.latencyTotals.max,
            p95Ms: params.latencyTotals.p95Max,
          }
        : undefined,
    dailyLatency: Array.from(params.dailyLatencyMap.values())
      .map((entry) => ({
        date: entry.date,
        count: entry.count,
        avgMs: entry.count ? entry.sum / entry.count : 0,
        minMs: entry.min === Number.POSITIVE_INFINITY ? 0 : entry.min,
        maxMs: entry.max,
        p95Ms: entry.p95Max,
      }))
      .toSorted((a, b) => a.date.localeCompare(b.date)),
    modelDaily: Array.from(params.modelDailyMap.values()).toSorted(
      (a, b) => a.date.localeCompare(b.date) || b.cost - a.cost,
    ),
    daily: Array.from(params.dailyMap.values()).toSorted((a, b) => a.date.localeCompare(b.date)),
  };
}
