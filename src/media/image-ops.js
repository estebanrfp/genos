let isBun = function () {
    return typeof process.versions.bun === "string";
  },
  prefersSips = function () {
    return (
      process.env.GENOS_IMAGE_BACKEND === "sips" ||
      (process.env.GENOS_IMAGE_BACKEND !== "sharp" && isBun() && process.platform === "darwin")
    );
  },
  readJpegExifOrientation = function (buffer) {
    if (buffer.length < 2 || buffer[0] !== 255 || buffer[1] !== 216) {
      return null;
    }
    let offset = 2;
    while (offset < buffer.length - 4) {
      if (buffer[offset] !== 255) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 255) {
        offset++;
        continue;
      }
      if (marker === 225) {
        const exifStart = offset + 4;
        if (
          buffer.length > exifStart + 6 &&
          buffer.toString("ascii", exifStart, exifStart + 4) === "Exif" &&
          buffer[exifStart + 4] === 0 &&
          buffer[exifStart + 5] === 0
        ) {
          const tiffStart = exifStart + 6;
          if (buffer.length < tiffStart + 8) {
            return null;
          }
          const byteOrder = buffer.toString("ascii", tiffStart, tiffStart + 2);
          const isLittleEndian = byteOrder === "II";
          const readU16 = (pos) =>
            isLittleEndian ? buffer.readUInt16LE(pos) : buffer.readUInt16BE(pos);
          const readU32 = (pos) =>
            isLittleEndian ? buffer.readUInt32LE(pos) : buffer.readUInt32BE(pos);
          const ifd0Offset = readU32(tiffStart + 4);
          const ifd0Start = tiffStart + ifd0Offset;
          if (buffer.length < ifd0Start + 2) {
            return null;
          }
          const numEntries = readU16(ifd0Start);
          for (let i = 0; i < numEntries; i++) {
            const entryOffset = ifd0Start + 2 + i * 12;
            if (buffer.length < entryOffset + 12) {
              break;
            }
            const tag = readU16(entryOffset);
            if (tag === 274) {
              const value = readU16(entryOffset + 8);
              return value >= 1 && value <= 8 ? value : null;
            }
          }
        }
        return null;
      }
      if (marker >= 224 && marker <= 239) {
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
        continue;
      }
      if (marker === 192 || marker === 218) {
        break;
      }
      offset++;
    }
    return null;
  };
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runExec } from "../process/exec.js";
export const IMAGE_REDUCE_QUALITY_STEPS = [85, 75, 65, 55, 45, 35];
export function buildImageResizeSideGrid(maxSide, sideStart) {
  return [sideStart, 1800, 1600, 1400, 1200, 1000, 800]
    .map((value) => Math.min(maxSide, value))
    .filter((value, idx, arr) => value > 0 && arr.indexOf(value) === idx)
    .toSorted((a, b) => b - a);
}
async function loadSharp() {
  const mod = await import("sharp");
  const sharp = mod.default ?? mod;
  return (buffer) => sharp(buffer, { failOnError: false });
}
async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "genosos-img-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
async function sipsMetadataFromBuffer(buffer) {
  return await withTempDir(async (dir) => {
    const input = path.join(dir, "in.img");
    await fs.writeFile(input, buffer);
    const { stdout } = await runExec(
      "/usr/bin/sips",
      ["-g", "pixelWidth", "-g", "pixelHeight", input],
      {
        timeoutMs: 1e4,
        maxBuffer: 524288,
      },
    );
    const w = stdout.match(/pixelWidth:\s*([0-9]+)/);
    const h = stdout.match(/pixelHeight:\s*([0-9]+)/);
    if (!w?.[1] || !h?.[1]) {
      return null;
    }
    const width = Number.parseInt(w[1], 10);
    const height = Number.parseInt(h[1], 10);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  });
}
async function sipsResizeToJpeg(params) {
  return await withTempDir(async (dir) => {
    const input = path.join(dir, "in.img");
    const output = path.join(dir, "out.jpg");
    await fs.writeFile(input, params.buffer);
    await runExec(
      "/usr/bin/sips",
      [
        "-Z",
        String(Math.max(1, Math.round(params.maxSide))),
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        String(Math.max(1, Math.min(100, Math.round(params.quality)))),
        input,
        "--out",
        output,
      ],
      { timeoutMs: 20000, maxBuffer: 1048576 },
    );
    return await fs.readFile(output);
  });
}
async function sipsConvertToJpeg(buffer) {
  return await withTempDir(async (dir) => {
    const input = path.join(dir, "in.heic");
    const output = path.join(dir, "out.jpg");
    await fs.writeFile(input, buffer);
    await runExec("/usr/bin/sips", ["-s", "format", "jpeg", input, "--out", output], {
      timeoutMs: 20000,
      maxBuffer: 1048576,
    });
    return await fs.readFile(output);
  });
}
export async function getImageMetadata(buffer) {
  if (prefersSips()) {
    return await sipsMetadataFromBuffer(buffer).catch(() => null);
  }
  try {
    const sharp = await loadSharp();
    const meta = await sharp(buffer).metadata();
    const width = Number(meta.width ?? 0);
    const height = Number(meta.height ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}
async function sipsApplyOrientation(buffer, orientation) {
  const ops = [];
  switch (orientation) {
    case 2:
      ops.push("-f", "horizontal");
      break;
    case 3:
      ops.push("-r", "180");
      break;
    case 4:
      ops.push("-f", "vertical");
      break;
    case 5:
      ops.push("-r", "270", "-f", "horizontal");
      break;
    case 6:
      ops.push("-r", "90");
      break;
    case 7:
      ops.push("-r", "90", "-f", "horizontal");
      break;
    case 8:
      ops.push("-r", "270");
      break;
    default:
      return buffer;
  }
  return await withTempDir(async (dir) => {
    const input = path.join(dir, "in.jpg");
    const output = path.join(dir, "out.jpg");
    await fs.writeFile(input, buffer);
    await runExec("/usr/bin/sips", [...ops, input, "--out", output], {
      timeoutMs: 20000,
      maxBuffer: 1048576,
    });
    return await fs.readFile(output);
  });
}
export async function normalizeExifOrientation(buffer) {
  if (prefersSips()) {
    try {
      const orientation = readJpegExifOrientation(buffer);
      if (!orientation || orientation === 1) {
        return buffer;
      }
      return await sipsApplyOrientation(buffer, orientation);
    } catch {
      return buffer;
    }
  }
  try {
    const sharp = await loadSharp();
    return await sharp(buffer).rotate().toBuffer();
  } catch {
    return buffer;
  }
}
export async function resizeToJpeg(params) {
  if (prefersSips()) {
    const normalized = await normalizeExifOrientationSips(params.buffer);
    if (params.withoutEnlargement !== false) {
      const meta = await getImageMetadata(normalized);
      if (meta) {
        const maxDim = Math.max(meta.width, meta.height);
        if (maxDim > 0 && maxDim <= params.maxSide) {
          return await sipsResizeToJpeg({
            buffer: normalized,
            maxSide: maxDim,
            quality: params.quality,
          });
        }
      }
    }
    return await sipsResizeToJpeg({
      buffer: normalized,
      maxSide: params.maxSide,
      quality: params.quality,
    });
  }
  const sharp = await loadSharp();
  return await sharp(params.buffer)
    .rotate()
    .resize({
      width: params.maxSide,
      height: params.maxSide,
      fit: "inside",
      withoutEnlargement: params.withoutEnlargement !== false,
    })
    .jpeg({ quality: params.quality, mozjpeg: true })
    .toBuffer();
}
export async function convertHeicToJpeg(buffer) {
  if (prefersSips()) {
    return await sipsConvertToJpeg(buffer);
  }
  const sharp = await loadSharp();
  return await sharp(buffer).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
export async function hasAlphaChannel(buffer) {
  try {
    const sharp = await loadSharp();
    const meta = await sharp(buffer).metadata();
    return meta.hasAlpha || meta.channels === 4;
  } catch {
    return false;
  }
}
export async function resizeToPng(params) {
  const sharp = await loadSharp();
  const compressionLevel = params.compressionLevel ?? 6;
  return await sharp(params.buffer)
    .rotate()
    .resize({
      width: params.maxSide,
      height: params.maxSide,
      fit: "inside",
      withoutEnlargement: params.withoutEnlargement !== false,
    })
    .png({ compressionLevel })
    .toBuffer();
}
export async function optimizeImageToPng(buffer, maxBytes) {
  const sides = [2048, 1536, 1280, 1024, 800];
  const compressionLevels = [6, 7, 8, 9];
  let smallest = null;
  for (const side of sides) {
    for (const compressionLevel of compressionLevels) {
      try {
        const out = await resizeToPng({
          buffer,
          maxSide: side,
          compressionLevel,
          withoutEnlargement: true,
        });
        const size = out.length;
        if (!smallest || size < smallest.size) {
          smallest = { buffer: out, size, resizeSide: side, compressionLevel };
        }
        if (size <= maxBytes) {
          return {
            buffer: out,
            optimizedSize: size,
            resizeSide: side,
            compressionLevel,
          };
        }
      } catch {}
    }
  }
  if (smallest) {
    return {
      buffer: smallest.buffer,
      optimizedSize: smallest.size,
      resizeSide: smallest.resizeSide,
      compressionLevel: smallest.compressionLevel,
    };
  }
  throw new Error("Failed to optimize PNG image");
}
async function normalizeExifOrientationSips(buffer) {
  try {
    const orientation = readJpegExifOrientation(buffer);
    if (!orientation || orientation === 1) {
      return buffer;
    }
    return await sipsApplyOrientation(buffer, orientation);
  } catch {
    return buffer;
  }
}
