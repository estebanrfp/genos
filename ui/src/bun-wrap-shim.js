/**
 * Shim for `bun:wrap` — replaces Bun's internal decorator helper so
 * Vite / Rollup can bundle files that were originally transpiled by Bun
 * from TypeScript decorator syntax.
 */
export function __decorateClass(decorators, target, key, kind) {
  if (kind === 2) {
    for (const d of decorators) {
      d(target, key);
    }
    return;
  }
  let result = target;
  for (const d of decorators) {
    result = d(result) || result;
  }
  return result;
}
