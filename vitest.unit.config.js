import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

const base = baseConfig;
const baseTest = baseConfig.test ?? {};
const include = (
  baseTest.include ?? ["src/**/*.test.js", "extensions/**/*.test.js", "test/format-error.test.js"]
).filter((pattern) => !pattern.includes("extensions/"));
const exclude = baseTest.exclude ?? [];

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    include,
    exclude: [...exclude, "src/gateway/**", "extensions/**"],
  },
});
