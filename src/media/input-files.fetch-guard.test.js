import { describe, expect, it, vi } from "vitest";
const fetchWithSsrFGuardMock = vi.fn();
vi.mock("../infra/net/fetch-guard.js", () => ({
  fetchWithSsrFGuard: (...args) => fetchWithSsrFGuardMock(...args),
}));
async function waitForMicrotaskTurn() {
  await new Promise((resolve) => queueMicrotask(resolve));
}
describe("fetchWithGuard", () => {
  it("rejects oversized streamed payloads and cancels the stream", async () => {
    let canceled = false;
    let pulls = 0;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array([5, 6, 7, 8]));
        }
      },
      cancel() {
        canceled = true;
      },
    });
    const release = vi.fn(async () => {});
    fetchWithSsrFGuardMock.mockResolvedValueOnce({
      response: new Response(stream, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
      release,
      finalUrl: "https://example.com/file.bin",
    });
    const { fetchWithGuard } = await import("./input-files.js");
    await expect(
      fetchWithGuard({
        url: "https://example.com/file.bin",
        maxBytes: 6,
        timeoutMs: 1000,
        maxRedirects: 0,
      }),
    ).rejects.toThrow("Content too large");
    await waitForMicrotaskTurn();
    expect(canceled).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
describe("base64 size guards", () => {
  it.each([
    {
      kind: "images",
      expectedError: "Image too large",
      run: async (data) => {
        const { extractImageContentFromSource } = await import("./input-files.js");
        return await extractImageContentFromSource(
          { type: "base64", data, mediaType: "image/png" },
          {
            allowUrl: false,
            allowedMimes: new Set(["image/png"]),
            maxBytes: 6,
            maxRedirects: 0,
            timeoutMs: 1,
          },
        );
      },
    },
    {
      kind: "files",
      expectedError: "File too large",
      run: async (data) => {
        const { extractFileContentFromSource } = await import("./input-files.js");
        return await extractFileContentFromSource({
          source: { type: "base64", data, mediaType: "text/plain", filename: "x.txt" },
          limits: {
            allowUrl: false,
            allowedMimes: new Set(["text/plain"]),
            maxBytes: 6,
            maxChars: 100,
            maxRedirects: 0,
            timeoutMs: 1,
            pdf: { maxPages: 1, maxPixels: 1, minTextChars: 1 },
          },
        });
      },
    },
  ])("rejects oversized base64 $kind before decoding", async (testCase) => {
    const data = Buffer.alloc(7).toString("base64");
    const fromSpy = vi.spyOn(Buffer, "from");
    await expect(testCase.run(data)).rejects.toThrow(testCase.expectedError);
    const base64Calls = fromSpy.mock.calls.filter((args) => args[1] === "base64");
    expect(base64Calls).toHaveLength(0);
    fromSpy.mockRestore();
  });
});
