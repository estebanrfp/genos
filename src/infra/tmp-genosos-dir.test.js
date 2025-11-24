let fallbackTmp = function (uid = 501) {
    return path.join("/var/fallback", `genosos-${uid}`);
  },
  resolveWithMocks = function (params) {
    const accessSync = params.accessSync ?? vi.fn();
    const mkdirSync = vi.fn();
    const getuid = vi.fn(() => params.uid ?? 501);
    const tmpdir = vi.fn(() => params.tmpdirPath ?? "/var/fallback");
    const resolved = resolvePreferredGenosOSTmpDir({
      accessSync,
      lstatSync: params.lstatSync,
      mkdirSync,
      getuid,
      tmpdir,
    });
    return { resolved, accessSync, lstatSync: params.lstatSync, mkdirSync, tmpdir };
  };
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { POSIX_GENOS_TMP_DIR, resolvePreferredGenosOSTmpDir } from "./tmp-genosos-dir.js";
describe("resolvePreferredGenosOSTmpDir", () => {
  it("prefers /tmp/genosos when it already exists and is writable", () => {
    const lstatSync = vi.fn(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      uid: 501,
      mode: 16832,
    }));
    const { resolved, accessSync, tmpdir } = resolveWithMocks({ lstatSync });
    expect(lstatSync).toHaveBeenCalledTimes(1);
    expect(accessSync).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(POSIX_GENOS_TMP_DIR);
    expect(tmpdir).not.toHaveBeenCalled();
  });
  it("prefers /tmp/genosos when it does not exist but /tmp is writable", () => {
    const lstatSyncMock = vi.fn(() => {
      const err = new Error("missing");
      err.code = "ENOENT";
      throw err;
    });
    lstatSyncMock.mockImplementationOnce(() => {
      const err = new Error("missing");
      err.code = "ENOENT";
      throw err;
    });
    lstatSyncMock.mockImplementationOnce(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      uid: 501,
      mode: 16832,
    }));
    const { resolved, accessSync, mkdirSync, tmpdir } = resolveWithMocks({
      lstatSync: lstatSyncMock,
    });
    expect(resolved).toBe(POSIX_GENOS_TMP_DIR);
    expect(accessSync).toHaveBeenCalledWith("/tmp", expect.any(Number));
    expect(mkdirSync).toHaveBeenCalledWith(POSIX_GENOS_TMP_DIR, expect.any(Object));
    expect(tmpdir).not.toHaveBeenCalled();
  });
  it("falls back to os.tmpdir()/genosos when /tmp/genosos is not a directory", () => {
    const lstatSync = vi.fn(() => ({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      uid: 501,
      mode: 33188,
    }));
    const { resolved, tmpdir } = resolveWithMocks({ lstatSync });
    expect(resolved).toBe(fallbackTmp());
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });
  it("falls back to os.tmpdir()/genosos when /tmp is not writable", () => {
    const accessSync = vi.fn((target) => {
      if (target === "/tmp") {
        throw new Error("read-only");
      }
    });
    const lstatSync = vi.fn(() => {
      const err = new Error("missing");
      err.code = "ENOENT";
      throw err;
    });
    const { resolved, tmpdir } = resolveWithMocks({
      accessSync,
      lstatSync,
    });
    expect(resolved).toBe(fallbackTmp());
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });
  it("falls back when /tmp/genosos is a symlink", () => {
    const lstatSync = vi.fn(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => true,
      uid: 501,
      mode: 41471,
    }));
    const { resolved, tmpdir } = resolveWithMocks({ lstatSync });
    expect(resolved).toBe(fallbackTmp());
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });
  it("falls back when /tmp/genosos is not owned by the current user", () => {
    const lstatSync = vi.fn(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      uid: 0,
      mode: 16832,
    }));
    const { resolved, tmpdir } = resolveWithMocks({ lstatSync });
    expect(resolved).toBe(fallbackTmp());
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });
  it("falls back when /tmp/genosos is group/other writable", () => {
    const lstatSync = vi.fn(() => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      uid: 501,
      mode: 16895,
    }));
    const { resolved, tmpdir } = resolveWithMocks({ lstatSync });
    expect(resolved).toBe(fallbackTmp());
    expect(tmpdir).toHaveBeenCalledTimes(1);
  });
});
