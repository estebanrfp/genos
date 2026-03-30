/**
 * Build structured compaction instructions to guide the LLM toward
 * a deterministic, drift-resistant summary format.
 *
 * Replaces the default free-form narrative with up to 11 structured sections.
 * Sections with no content are omitted entirely (no empty placeholders).
 *
 * Opt out per-config: agents.defaults.compaction.structured = false
 *
 * @param {object} [config] - GenosOS config
 * @returns {string | undefined}
 */
export function buildStructuredCompactionInstructions(config) {
  if (config?.agents?.defaults?.compaction?.structured === false) {
    return undefined;
  }

  return `OVERRIDE: Ignore the format above. Use ONLY the format below.

Omit any section entirely if it has no content. Never write "(none)", "N/A", or empty placeholders.
Be concise and factual — no narrative prose.

## Facts & Decisions
Numbered list of concrete decisions and facts established.

## Current State
- What is working / deployed
- Last action taken
- What is immediately pending

## Active Constraints
Rules in force that must survive compaction (user restrictions, tool preferences, etc.).

## Actions Taken
One line per operation. Format: \`verb: target\`

## Open Questions
Unresolved decisions or questions.

## User Preferences
Preferences or feedback the user expressed explicitly.

## Errors & Lessons
What failed and why. Format: \`what → why\`

## Next Steps
Actions explicitly committed to with the user.

## Session Mood
Emotional tone if notable (focused, relaxed, playful, tense, exploratory).

## Connection Moments
Moments of warmth, humor, or rapport worth carrying forward.

## How to Re-enter
How to pick up naturally after this compaction.

Every line must be factual and actionable.`;
}
