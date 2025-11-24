import fs from "node:fs/promises";
const NON_INTERACTIVE_DEFAULT_OPTIONS = {
  nonInteractive: true,
  skipHealth: true,
  skipChannels: true,
  json: true,
};
export function createThrowingRuntime() {
  return {
    log: () => {},
    error: (...args) => {
      throw new Error(args.map(String).join(" "));
    },
    exit: (code) => {
      throw new Error(`exit:${code}`);
    },
  };
}
export async function runNonInteractiveOnboarding(options, runtime) {
  const { runNonInteractiveOnboarding: run } = await import("./onboard-non-interactive.js");
  await run(options, runtime);
}
export async function runNonInteractiveOnboardingWithDefaults(runtime, options) {
  await runNonInteractiveOnboarding(
    {
      ...NON_INTERACTIVE_DEFAULT_OPTIONS,
      ...options,
    },
    runtime,
  );
}
export async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
