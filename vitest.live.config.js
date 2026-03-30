import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

const base = baseConfig;
const baseTest = baseConfig.test ?? {};
const exclude = (baseTest.exclude ?? []).filter((p) => p !== "**/*.live.test.js");

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    maxWorkers: 1,
    include: ["src/**/*.live.test.js"],
    exclude,
  },
});
