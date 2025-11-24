export function createProcessSessionFixture(params) {
  const session = {
    id: params.id,
    command: params.command ?? "test",
    startedAt: params.startedAt ?? Date.now(),
    cwd: params.cwd ?? "/tmp",
    maxOutputChars: params.maxOutputChars ?? 1e4,
    pendingMaxOutputChars: params.pendingMaxOutputChars ?? 30000,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exited: false,
    exitCode: undefined,
    exitSignal: undefined,
    truncated: false,
    backgrounded: params.backgrounded ?? false,
  };
  if (params.pid !== undefined) {
    session.pid = params.pid;
  }
  if (params.child) {
    session.child = params.child;
  }
  return session;
}
