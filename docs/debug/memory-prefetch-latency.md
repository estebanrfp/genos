---
summary: "Diagnosing and fixing memory prefetch latency with vault active (22s → <5ms)"
read_when:
  - Memory prefetch takes 10–25 seconds per query
  - "[memory/prefetch] no chunks found (22000ms)" in gateway logs
  - "text fallback" appears in gateway logs instead of vector search
  - Slow responses from Nyx, especially for short or generic queries
title: "Memory Prefetch Latency (Vault Active)"
---

# Memory Prefetch Latency — Vault Active

Two compounding bugs caused memory prefetch queries to take 22 seconds when the vault
is active. Both are fixed in 0.7.0.

## Symptom

Gateway logs show text fallback being invoked and taking 12–22 seconds:

```
[memory] FTS disabled: vault encryption active (vector search still operational)
[memory] text fallback search: keywords=[hola] model=text-embedding-3-small
[memory] text fallback: 3 results found
[memory/prefetch] injected 3 chunks (13721ms)
```

The `model=text-embedding-3-small` tag is **not** an OpenAI API call — it is metadata
showing which embedding model indexed the chunks. The slowness comes from two separate bugs.

---

## Bug 1 — Vault Auto-Lock: Keychain Subprocess per Chunk (22s)

### Root cause

GenosOS's vault has a **30-minute auto-lock timer** (`src/infra/vault-state.js`). After
inactivity, `isVaultUnlocked()` returns `false`.

When vault-state is locked, `getPassphraseOrNull()` in `src/infra/secure-io.js` falls
through to `resolvePassphrase()`, which calls `keychainGet()`, which runs:

```
/usr/bin/security find-generic-password -s com.genos.vault -a passphrase -w
```

This **subprocess spawn** happens on every call to `decryptChunkText()`. With 548 memory
chunks in the database, a single prefetch query decrypted the chunk set twice (once during
vector search fallback and once during text fallback), spawning `/usr/bin/security` ~1096 times:

```
548 chunks × 2 passes × ~10ms/spawn ≈ 11–22 seconds
```

### Fix (0.7.0)

`getPassphraseOrNull()` now calls `unlockVault(pp)` after resolving the passphrase from
the fallback chain. This caches the passphrase in vault-state so subsequent calls use the
in-memory fast path, resetting the 30-minute inactivity timer.

File: `src/infra/secure-io.js`

```js
// Before (0.6.x):
try {
  return resolvePassphrase(); // spawns /usr/bin/security per chunk
} catch {
  return null;
}

// After (0.7.0):
try {
  const pp = resolvePassphrase();
  unlockVault(pp); // cache → subsequent calls skip Keychain spawn
  return pp;
} catch {
  return null;
}
```

---

## Bug 2 — Text Fallback: PBKDF2 per Chunk When Vault Active (12s)

### Root cause

Even after Bug 1 was fixed, `searchTextFallbackWrap()` was still invoked for queries
where vector search returned 0 results (e.g. short or generic queries like "hola").

With vault active, `decryptChunkText()` calls `decryptContent()`, which runs **PBKDF2
key derivation (100,000 iterations, SHA-512) per chunk**. Each chunk has its own random
salt, so the key must be re-derived for every chunk:

```
548 chunks × ~22ms/PBKDF2 ≈ 12 seconds
```

FTS is already disabled when vault is active (encrypted text can't be full-text indexed).
The text fallback suffered from the same structural problem: expensive per-chunk work
that can't be amortized.

### Fix (0.7.0)

`searchTextFallbackWrap()` in `src/memory/manager.js` now returns `[]` immediately when
`this.fts.enabled === false` (vault active):

```js
searchTextFallbackWrap(query, maxResults, minScore) {
  // When vault active: FTS disabled → same reason makes text fallback too costly
  // (PBKDF2 × N chunks ≈ 12s). Vector search is the correct path.
  if (!this.fts.enabled) {
    log.debug("text fallback skipped: vault active (FTS disabled, per-chunk PBKDF2 too costly)");
    return [];
  }
  // ... existing keyword matching
}
```

---

---

## Bug 3 — Wasted Embedding Call for Non-Memory Queries

Even with Bugs 1 and 2 fixed, every query still triggered an OpenAI embedding API call
(~150ms) before the vector search could return 0 results for generic messages like "hola".

### Fix (0.7.0)

A fast in-process heuristic (`needsMemoryContext`) classifies queries before the embedding
call. Queries with ≤ 6 words and no memory-seeking signals skip prefetch entirely.

File: `src/agents/pi-embedded-runner/run/memory-prefetch.js`

Memory signals (always run, even when short): `recuerdas`, `dijiste`, `decidimos`, `ayer`,
`antes`, `sigue`, `continúa`, project names (`genosos`, `genosdb`, `ovgrid`, `vault`), and
English equivalents (`remember`, `you said`, `yesterday`, `last week`, etc.).

Config option: `agents.defaults.memorySearch.prefetch.smart: false` to disable (always run).

---

## Combined result (all three fixes)

| Query type                                | Before 0.7.0 | After 0.7.0                                  |
| ----------------------------------------- | ------------ | -------------------------------------------- |
| Short generic ("hola", "ok", "sí")        | 22s          | **< 1ms** (smart skip)                       |
| Short with memory signal ("recuerdas X?") | 22s          | **~750ms** (vector search)                   |
| Long query with vector hits               | ~22s         | **~750ms**                                   |
| Long query, no vector hits                | ~22s         | **~160ms** (embed + instant fallback)        |
| After vault auto-lock (first query)       | 22s          | **~750ms** (one Keychain spawn, then cached) |

## If you're still seeing slow prefetch

### 1. Check if the vault is active

```bash
bun genosos.mjs vault status
```

If `locked: true` and the GenosOS version is < 0.7.0, update and restart the gateway.

### 2. Check how many chunks are in the database

```bash
bun -e "
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
const db = new Database(homedir() + '/.genos/memory/main.sqlite', { readonly: true });
const r = db.query('SELECT model, COUNT(*) as cnt FROM chunks GROUP BY model').all();
console.log(JSON.stringify(r, null, 2));
db.close();
"
```

A large number of chunks (>1000) will still cause noticeable latency even after the fix
if the text fallback path is invoked. The text fallback is triggered when:

- Vector search returns 0 results (model mismatch, empty index)
- Both FTS and vector search are unavailable

### 3. Verify the sqlite-vec index is populated

```bash
bun -e "
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
const db = new Database(homedir() + '/.genos/memory/main.sqlite', { readonly: true });
const r = db.query('SELECT COUNT(*) as cnt FROM chunks_vec_rowids').all();
console.log('Vectors indexed:', r[0].cnt);
db.close();
"
```

If `Vectors indexed` is 0, the sqlite-vec index is empty. Re-index the workspace:

```bash
bun genosos.mjs memory sync --force
```

### 4. Check the embedding provider in config

If the embedding provider changed (e.g., from a local GGUF model to OpenAI), existing
chunks in the database may be indexed under the old model name. The vector search query
filters by `WHERE model = '<current-model>'`, returning 0 results → text fallback.

Verify the configured model matches the chunks in the database:

```bash
# Configured model
bun genosos.mjs config get agents.defaults.memorySearch.model

# Indexed model
bun -e "
import { Database } from 'bun:sqlite';
import { homedir } from 'os';
const db = new Database(homedir() + '/.genos/memory/main.sqlite', { readonly: true });
console.log(db.query('SELECT DISTINCT model FROM chunks').all());
db.close();
"
```

If they differ, re-index: `bun genosos.mjs memory sync --force`.

## Related configuration

Memory embedding config lives under `agents.defaults.memorySearch` in `genosos.json`:

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        provider: "openai", // "openai" | "voyage" | "local"
        model: "text-embedding-3-small",
        vectorWeight: 0.7,
        textWeight: 0.3,
        query: {
          minScore: 0.4,
        },
        prefetch: {
          enabled: true,
          maxChunks: 5,
          minScore: 0.4,
        },
      },
    },
  },
}
```

**Recommended providers by latency:**

| Provider | Model                          | Query latency      | Notes                                                           |
| -------- | ------------------------------ | ------------------ | --------------------------------------------------------------- |
| `local`  | `embeddinggemma-300m-qat-Q8_0` | **~50–200ms warm** | Best for M2 Max+; zero cost; singleton — warm after first query |
| `openai` | `text-embedding-3-small`       | ~150ms             | Requires `OPENAI_API_KEY`; consistent latency; no cold-start    |
| `openai` | `text-embedding-3-large`       | ~200ms             | Higher accuracy, 3× cost                                        |
| `voyage` | `voyage-3-lite`                | ~100ms             | Cheaper than OpenAI; requires Voyage key                        |
| `local`  | GGUF model (cold)              | ~5–20s first query | One-time cost per gateway restart; warm after that              |

> **Note:** The local provider's cold-start (~5–20s) was previously misdiagnosed as the cause of 22s latency.
> The real causes were vault auto-lock (Bug 1) and PBKDF2 text fallback (Bug 2), both fixed in 0.7.0.
> On M2 Max with the model already cached in RAM, local embeddings are as fast as OpenAI remote calls.
