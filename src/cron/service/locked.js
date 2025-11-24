const storeLocks = new Map();
const resolveChain = (promise) =>
  promise.then(
    () => {
      return;
    },
    () => {
      return;
    },
  );
export async function locked(state, fn) {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return await next;
}
