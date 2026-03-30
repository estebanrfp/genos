import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

const base = baseConfig;
const baseTest = baseConfig.test ?? {};
const exclude = baseTest.exclude ?? [];

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    include: ["extensions/**/*.test.js"],
    exclude,
  },
});
