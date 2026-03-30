let createMockHttpExchange = function () {
  const res = Object.assign(new PassThrough(), {
    statusCode: 0,
    headers: {},
  });
  const req = {
    on: (event, handler) => {
      if (event === "error") {
        res.on("error", handler);
      }
      return req;
    },
    end: () => {
      return;
    },
    destroy: () => res.destroy(),
  };
  return { req, res };
};
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinnedLookup } from "../infra/net/ssrf.js";
import { captureEnv } from "../test-utils/env.js";
import { saveMediaSource, setMediaStoreNetworkDepsForTest } from "./store.js";
const HOME = path.join(os.tmpdir(), "genosos-home-redirect");
const mockRequest = vi.fn();
describe("media store redirects", () => {
  let envSnapshot;
  beforeAll(async () => {
    envSnapshot = captureEnv(["GENOS_STATE_DIR"]);
    await fs.rm(HOME, { recursive: true, force: true });
    process.env.GENOS_STATE_DIR = HOME;
  });
  beforeEach(() => {
    mockRequest.mockReset();
    setMediaStoreNetworkDepsForTest({
      httpRequest: (...args) => mockRequest(...args),
      httpsRequest: (...args) => mockRequest(...args),
      resolvePinnedHostname: async (hostname) => ({
        hostname,
        addresses: ["93.184.216.34"],
        lookup: createPinnedLookup({ hostname, addresses: ["93.184.216.34"] }),
      }),
    });
  });
  afterAll(async () => {
    await fs.rm(HOME, { recursive: true, force: true });
    envSnapshot.restore();
    setMediaStoreNetworkDepsForTest();
    vi.clearAllMocks();
  });
  it("follows redirects and keeps detected mime/extension", async () => {
    let call = 0;
    mockRequest.mockImplementation((_url, _opts, cb) => {
      call += 1;
      const { req, res } = createMockHttpExchange();
      if (call === 1) {
        res.statusCode = 302;
        res.headers = { location: "https://example.com/final" };
        setImmediate(() => {
          cb(res);
          res.end();
        });
      } else {
        res.statusCode = 200;
        res.headers = { "content-type": "text/plain" };
        setImmediate(() => {
          cb(res);
          res.write("redirected");
          res.end();
        });
      }
      return req;
    });
    const saved = await saveMediaSource("https://example.com/start");
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(saved.contentType).toBe("text/plain");
    expect(path.extname(saved.path)).toBe(".txt");
    expect(await fs.readFile(saved.path, "utf8")).toBe("redirected");
  });
  it("sniffs xlsx from zip content when headers and url extension are missing", async () => {
    mockRequest.mockImplementationOnce((_url, _opts, cb) => {
      const { req, res } = createMockHttpExchange();
      res.statusCode = 200;
      res.headers = {};
      setImmediate(() => {
        cb(res);
        const zip = new JSZip();
        zip.file(
          "[Content_Types].xml",
          '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
        );
        zip.file("xl/workbook.xml", "<workbook/>");
        zip
          .generateAsync({ type: "nodebuffer" })
          .then((buf) => {
            res.write(buf);
            res.end();
          })
          .catch((err) => {
            res.destroy(err);
          });
      });
      return req;
    });
    const saved = await saveMediaSource("https://example.com/download");
    expect(saved.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(path.extname(saved.path)).toBe(".xlsx");
  });
  it("fails when redirect response omits location header", async () => {
    mockRequest.mockImplementationOnce((_url, _opts, cb) => {
      const { req, res } = createMockHttpExchange();
      res.statusCode = 302;
      res.headers = {};
      setImmediate(() => {
        cb(res);
        res.end();
      });
      return req;
    });
    await expect(saveMediaSource("https://example.com/start")).rejects.toThrow(
      "Redirect loop or missing Location header",
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
