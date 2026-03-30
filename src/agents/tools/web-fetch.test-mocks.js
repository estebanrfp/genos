import { vi } from "vitest";
vi.mock("./web-fetch-utils.js", async () => {
  const actual = await vi.importActual("./web-fetch-utils.js");
  return {
    ...actual,
    extractReadableContent: vi.fn().mockResolvedValue({
      title: "HTML Page",
      text: "HTML Page\n\nContent here.",
    }),
  };
});
