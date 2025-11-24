import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMediaUnderstanding } from "../src/media-understanding/apply.js";
import { clearMediaUnderstandingBinaryCacheForTests } from "../src/media-understanding/runner.js";
const makeTempDir = async (prefix) => await fs.mkdtemp(path.join(os.tmpdir(), prefix));
const writeExecutable = async (dir, name, content) => {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content, { mode: 493 });
  return filePath;
};
const makeTempMedia = async (ext) => {
  const dir = await makeTempDir("genosos-media-e2e-");
  const filePath = path.join(dir, `sample${ext}`);
  await fs.writeFile(filePath, "audio");
  return { dir, filePath };
};
const envSnapshot = () => ({
  PATH: process.env.PATH,
  SHERPA_ONNX_MODEL_DIR: process.env.SHERPA_ONNX_MODEL_DIR,
  WHISPER_CPP_MODEL: process.env.WHISPER_CPP_MODEL,
});
const restoreEnv = (snapshot) => {
  process.env.PATH = snapshot.PATH;
  process.env.SHERPA_ONNX_MODEL_DIR = snapshot.SHERPA_ONNX_MODEL_DIR;
  process.env.WHISPER_CPP_MODEL = snapshot.WHISPER_CPP_MODEL;
};
describe("media understanding auto-detect (e2e)", () => {
  let tempPaths = [];
  beforeEach(() => {
    clearMediaUnderstandingBinaryCacheForTests();
  });
  afterEach(async () => {
    for (const p of tempPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
    tempPaths = [];
  });
  it("uses sherpa-onnx-offline when available", async () => {
    const snapshot = envSnapshot();
    try {
      const binDir = await makeTempDir("genosos-bin-sherpa-");
      const modelDir = await makeTempDir("genosos-sherpa-model-");
      tempPaths.push(binDir, modelDir);
      await fs.writeFile(path.join(modelDir, "tokens.txt"), "a");
      await fs.writeFile(path.join(modelDir, "encoder.onnx"), "a");
      await fs.writeFile(path.join(modelDir, "decoder.onnx"), "a");
      await fs.writeFile(path.join(modelDir, "joiner.onnx"), "a");
      await writeExecutable(
        binDir,
        "sherpa-onnx-offline",
        `#!/usr/bin/env bash\necho "{\\"text\\":\\"sherpa ok\\"}"\n`,
      );
      process.env.PATH = `${binDir}:/usr/bin:/bin`;
      process.env.SHERPA_ONNX_MODEL_DIR = modelDir;
      const { filePath } = await makeTempMedia(".wav");
      tempPaths.push(path.dirname(filePath));
      const ctx = {
        Body: "<media:audio>",
        MediaPath: filePath,
        MediaType: "audio/wav",
      };
      const cfg = { tools: { media: { audio: {} } } };
      await applyMediaUnderstanding({ ctx, cfg });
      expect(ctx.Transcript).toBe("sherpa ok");
    } finally {
      restoreEnv(snapshot);
    }
  });
  it("uses whisper-cli when sherpa is missing", async () => {
    const snapshot = envSnapshot();
    try {
      const binDir = await makeTempDir("genosos-bin-whispercpp-");
      const modelDir = await makeTempDir("genosos-whispercpp-model-");
      tempPaths.push(binDir, modelDir);
      const modelPath = path.join(modelDir, "tiny.bin");
      await fs.writeFile(modelPath, "model");
      await writeExecutable(
        binDir,
        "whisper-cli",
        '#!/usr/bin/env bash\nout=""\nprev=""\nfor arg in "$@"; do\n  if [ "$prev" = "-of" ]; then out="$arg"; break; fi\n  prev="$arg"\ndone\nif [ -n "$out" ]; then echo \'whisper cpp ok\' > "${out}.txt"; fi\n',
      );
      process.env.PATH = `${binDir}:/usr/bin:/bin`;
      process.env.WHISPER_CPP_MODEL = modelPath;
      const { filePath } = await makeTempMedia(".wav");
      tempPaths.push(path.dirname(filePath));
      const ctx = {
        Body: "<media:audio>",
        MediaPath: filePath,
        MediaType: "audio/wav",
      };
      const cfg = { tools: { media: { audio: {} } } };
      await applyMediaUnderstanding({ ctx, cfg });
      expect(ctx.Transcript).toBe("whisper cpp ok");
    } finally {
      restoreEnv(snapshot);
    }
  });
  it("uses gemini CLI for images when available", async () => {
    const snapshot = envSnapshot();
    try {
      const binDir = await makeTempDir("genosos-bin-gemini-");
      tempPaths.push(binDir);
      await writeExecutable(
        binDir,
        "gemini",
        `#!/usr/bin/env bash\necho '{"response":"gemini ok"}'\n`,
      );
      process.env.PATH = `${binDir}:/usr/bin:/bin`;
      const { filePath } = await makeTempMedia(".png");
      tempPaths.push(path.dirname(filePath));
      const ctx = {
        Body: "<media:image>",
        MediaPath: filePath,
        MediaType: "image/png",
      };
      const cfg = { tools: { media: { image: {} } } };
      await applyMediaUnderstanding({ ctx, cfg });
      expect(ctx.Body).toContain("gemini ok");
    } finally {
      restoreEnv(snapshot);
    }
  });
});
