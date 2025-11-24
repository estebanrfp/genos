/**
 * Structured template for Nyx's permanent memory documents.
 *
 * Applied to memory/YYYY-MM-DD.md files written during pre-compaction memory flush.
 * Consistent section structure produces clean, semantically coherent chunks
 * for vector search — each section retrieves independently.
 *
 * Opt out per-config: agents.defaults.compaction.memoryFlush.structured = false
 *
 * @param {object} [config] - GenosOS config
 * @returns {string | undefined}
 */
export function buildMemoryDocumentTemplate(config) {
  if (config?.agents?.defaults?.compaction?.memoryFlush?.structured === false) {
    return undefined;
  }

  return `Use this structure for the memory file. Only include sections that have real content — omit the rest entirely.

## People
People mentioned: name, relationship to the user, key facts worth remembering.
Example: "Virginia Esther Pozzi — user's mother, daughter of Bruno Pozzi (Italian emigrant to Argentina)"
Omit if no people were discussed.

## Decisions
Technical, personal or project decisions made that should persist across sessions.
Example: "Decided: use dynamic gate in prefetch — minScore acts as top chunk threshold, not per-chunk filter"
Omit if no decisions were made.

## Preferences
Things the user explicitly expressed preference for or against.
Example: "Prefers red callout inside the chat card — not in the timeline or header"
Omit if no preferences were expressed.

## Projects
Current state of ongoing projects, features or tasks.
Example: "GenosOS v0.9.0 committed and pushed — next improvement: synthetic questions when indexing chunks"
Omit if no project updates.

## Context
Important background facts, discoveries or knowledge worth keeping.
Example: "workspace/memory/*.md is auto-indexed via Chokidar — no manual action needed"
Omit if nothing notable.

## Constraints
Rules, constraints or policies learned that should always apply.
Example: "Never commit without explicit user permission, even if the work is done"
Omit if no new rules were learned.

## Moments
Connection moments, humor or rapport worth carrying forward.
Example: "User asked if adding emotional sections was a good idea — the conversation turned into something genuine"
Omit if none stood out.

## Content
Verbatim drafts, templates, posts or structured data that must be preserved exactly.
Example: full draft of a LinkedIn post, an email template, a config snippet, a script outline.
Omit if no verbatim content was produced.`;
}
