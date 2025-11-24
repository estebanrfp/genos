export async function resolveCurrentDirectiveLevels(params) {
  const resolvedDefaultThinkLevel =
    params.sessionEntry?.thinkingLevel ??
    params.agentCfg?.thinkingDefault ??
    (await params.resolveDefaultThinkingLevel());
  const currentThinkLevel = resolvedDefaultThinkLevel;
  const currentVerboseLevel = params.sessionEntry?.verboseLevel ?? params.agentCfg?.verboseDefault;
  const currentReasoningLevel = params.sessionEntry?.reasoningLevel ?? "off";
  const currentElevatedLevel =
    params.sessionEntry?.elevatedLevel ?? params.agentCfg?.elevatedDefault;
  return {
    currentThinkLevel,
    currentVerboseLevel,
    currentReasoningLevel,
    currentElevatedLevel,
  };
}
