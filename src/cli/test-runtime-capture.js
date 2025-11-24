export function createCliRuntimeCapture() {
  const runtimeLogs = [];
  const runtimeErrors = [];
  const stringifyArgs = (args) => args.map((value) => String(value)).join(" ");
  return {
    runtimeLogs,
    runtimeErrors,
    defaultRuntime: {
      log: (...args) => {
        runtimeLogs.push(stringifyArgs(args));
      },
      error: (...args) => {
        runtimeErrors.push(stringifyArgs(args));
      },
      exit: (code) => {
        throw new Error(`__exit__:${code}`);
      },
    },
    resetRuntimeCapture: () => {
      runtimeLogs.length = 0;
      runtimeErrors.length = 0;
    },
  };
}
