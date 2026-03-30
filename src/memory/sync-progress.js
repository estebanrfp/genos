export function bumpSyncProgressTotal(progress, delta, label) {
  if (!progress) {
    return;
  }
  progress.total += delta;
  progress.report({
    completed: progress.completed,
    total: progress.total,
    label,
  });
}
export function bumpSyncProgressCompleted(progress, delta = 1, label) {
  if (!progress) {
    return;
  }
  progress.completed += delta;
  progress.report({
    completed: progress.completed,
    total: progress.total,
    label,
  });
}
