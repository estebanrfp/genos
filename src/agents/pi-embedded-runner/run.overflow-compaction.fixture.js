export function makeAttemptResult(overrides = {}) {
  return {
    aborted: false,
    timedOut: false,
    timedOutDuringCompaction: false,
    promptError: null,
    sessionIdUsed: "test-session",
    assistantTexts: ["Hello!"],
    toolMetas: [],
    lastAssistant: undefined,
    messagesSnapshot: [],
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
    ...overrides,
  };
}
export function mockOverflowRetrySuccess(params) {
  const overflowError = new Error(
    params.overflowMessage ?? "request_too_large: Request size exceeds model context window",
  );
  params.runEmbeddedAttempt.mockResolvedValueOnce(
    makeAttemptResult({ promptError: overflowError }),
  );
  params.runEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ promptError: null }));
  params.compactDirect.mockResolvedValueOnce({
    ok: true,
    compacted: true,
    result: {
      summary: "Compacted session",
      firstKeptEntryId: "entry-5",
      tokensBefore: 150000,
    },
  });
  return overflowError;
}
