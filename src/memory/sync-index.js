let tickProgress = function (progress) {
  if (!progress) {
    return;
  }
  progress.completed += 1;
  progress.report({
    completed: progress.completed,
    total: progress.total,
  });
};
export async function indexFileEntryIfChanged(params) {
  const record = params.db
    .prepare(`SELECT hash FROM files WHERE path = ? AND source = ?`)
    .get(params.entry.path, params.source);
  if (!params.needsFullReindex && record?.hash === params.entry.hash) {
    tickProgress(params.progress);
    return;
  }
  await params.indexFile(params.entry);
  tickProgress(params.progress);
}
