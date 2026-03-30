import { vi } from "vitest";
vi.mock("chokidar", () => ({
  default: {
    watch: () => ({ on: () => {}, close: async () => {} }),
  },
  watch: () => ({ on: () => {}, close: async () => {} }),
}));
vi.mock("./sqlite-vec.js", () => ({
  loadSqliteVecExtension: async () => ({ ok: false, error: "sqlite-vec disabled in tests" }),
}));
