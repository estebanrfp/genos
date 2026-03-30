import { isTruthyEnvValue } from "../infra/env.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
const debugEmbeddings = isTruthyEnvValue(process.env.GENOS_DEBUG_MEMORY_EMBEDDINGS);
const log = createSubsystemLogger("memory/embeddings");
export function debugEmbeddingsLog(message, meta) {
  if (!debugEmbeddings) {
    return;
  }
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  log.raw(`${message}${suffix}`);
}
