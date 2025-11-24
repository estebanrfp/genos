let isImageBlock = function (block) {
    if (!block || typeof block !== "object") {
      return false;
    }
    const rec = block;
    return rec.type === "image" && typeof rec.data === "string" && typeof rec.mimeType === "string";
  },
  isTextBlock = function (block) {
    if (!block || typeof block !== "object") {
      return false;
    }
    const rec = block;
    return rec.type === "text" && typeof rec.text === "string";
  },
  inferMimeTypeFromBase64 = function (base64) {
    const trimmed = base64.trim();
    if (!trimmed) {
      return;
    }
    if (trimmed.startsWith("/9j/")) {
      return "image/jpeg";
    }
    if (trimmed.startsWith("iVBOR")) {
      return "image/png";
    }
    if (trimmed.startsWith("R0lGOD")) {
      return "image/gif";
    }
    return;
  },
  formatBytesShort = function (bytes) {
    if (!Number.isFinite(bytes) || bytes < 1024) {
      return `${Math.max(0, Math.round(bytes))}B`;
    }
    if (bytes < 1048576) {
      return `${(bytes / 1024).toFixed(1)}KB`;
    }
    return `${(bytes / 1048576).toFixed(2)}MB`;
  };
import { createHash } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildImageResizeSideGrid,
  getImageMetadata,
  IMAGE_REDUCE_QUALITY_STEPS,
  resizeToJpeg,
} from "../media/image-ops.js";
import { DEFAULT_IMAGE_MAX_BYTES, DEFAULT_IMAGE_MAX_DIMENSION_PX } from "./image-sanitization.js";
const MAX_IMAGE_DIMENSION_PX = DEFAULT_IMAGE_MAX_DIMENSION_PX;
const MAX_IMAGE_BYTES = DEFAULT_IMAGE_MAX_BYTES;
const log = createSubsystemLogger("agents/tool-images");
const RESIZE_CACHE = new Map();
const RESIZE_CACHE_MAX = 64;
const RESIZE_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * Build a fast cache key from image content hash + resize parameters.
 * @param {string} base64
 * @param {number} maxBytes
 * @param {number} maxDimensionPx
 * @returns {string}
 */
const buildResizeCacheKey = (base64, maxBytes, maxDimensionPx) => {
  const hash = createHash("sha256")
    .update(base64.slice(0, 4096))
    .update(String(base64.length))
    .digest("hex")
    .slice(0, 16);
  return `${hash}:${maxBytes}:${maxDimensionPx}`;
};
/**
 * Evict expired entries from the resize cache.
 */
const evictExpiredResizeCache = () => {
  const now = Date.now();
  for (const [key, entry] of RESIZE_CACHE) {
    if (now - entry.ts > RESIZE_CACHE_TTL_MS) {
      RESIZE_CACHE.delete(key);
    }
  }
};
async function resizeImageBase64IfNeeded(params) {
  const cacheKey = buildResizeCacheKey(params.base64, params.maxBytes, params.maxDimensionPx);
  const cached = RESIZE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < RESIZE_CACHE_TTL_MS) {
    return cached.result;
  }
  const buf = Buffer.from(params.base64, "base64");
  const meta = await getImageMetadata(buf);
  const width = meta?.width;
  const height = meta?.height;
  const overBytes = buf.byteLength > params.maxBytes;
  const hasDimensions = typeof width === "number" && typeof height === "number";
  const overDimensions =
    hasDimensions && (width > params.maxDimensionPx || height > params.maxDimensionPx);
  if (
    hasDimensions &&
    !overBytes &&
    width <= params.maxDimensionPx &&
    height <= params.maxDimensionPx
  ) {
    const result = {
      base64: params.base64,
      mimeType: params.mimeType,
      resized: false,
      width,
      height,
    };
    RESIZE_CACHE.set(cacheKey, { result, ts: Date.now() });
    return result;
  }
  const maxDim = hasDimensions ? Math.max(width ?? 0, height ?? 0) : params.maxDimensionPx;
  const sideStart = maxDim > 0 ? Math.min(params.maxDimensionPx, maxDim) : params.maxDimensionPx;
  const sideGrid = buildImageResizeSideGrid(params.maxDimensionPx, sideStart);
  let smallest = null;
  for (const side of sideGrid) {
    for (const quality of IMAGE_REDUCE_QUALITY_STEPS) {
      const out = await resizeToJpeg({
        buffer: buf,
        maxSide: side,
        quality,
        withoutEnlargement: true,
      });
      if (!smallest || out.byteLength < smallest.size) {
        smallest = { buffer: out, size: out.byteLength };
      }
      if (out.byteLength <= params.maxBytes) {
        const sourcePixels =
          typeof width === "number" && typeof height === "number"
            ? `${width}x${height}px`
            : "unknown";
        const byteReductionPct =
          buf.byteLength > 0
            ? Number((((buf.byteLength - out.byteLength) / buf.byteLength) * 100).toFixed(1))
            : 0;
        log.info(
          `Image resized to fit limits: ${sourcePixels} ${formatBytesShort(buf.byteLength)} -> ${formatBytesShort(out.byteLength)} (-${byteReductionPct}%)`,
          {
            label: params.label,
            sourceMimeType: params.mimeType,
            sourceWidth: width,
            sourceHeight: height,
            sourceBytes: buf.byteLength,
            maxBytes: params.maxBytes,
            maxDimensionPx: params.maxDimensionPx,
            triggerOverBytes: overBytes,
            triggerOverDimensions: overDimensions,
            outputMimeType: "image/jpeg",
            outputBytes: out.byteLength,
            outputQuality: quality,
            outputMaxSide: side,
            byteReductionPct,
          },
        );
        const result = {
          base64: out.toString("base64"),
          mimeType: "image/jpeg",
          resized: true,
          width,
          height,
        };
        if (RESIZE_CACHE.size >= RESIZE_CACHE_MAX) {
          evictExpiredResizeCache();
        }
        RESIZE_CACHE.set(cacheKey, { result, ts: Date.now() });
        return result;
      }
    }
  }
  const best = smallest?.buffer ?? buf;
  const maxMb = (params.maxBytes / 1048576).toFixed(0);
  const gotMb = (best.byteLength / 1048576).toFixed(2);
  const sourcePixels =
    typeof width === "number" && typeof height === "number" ? `${width}x${height}px` : "unknown";
  log.warn(
    `Image resize failed to fit limits: ${sourcePixels} best=${formatBytesShort(best.byteLength)} limit=${formatBytesShort(params.maxBytes)}`,
    {
      label: params.label,
      sourceMimeType: params.mimeType,
      sourceWidth: width,
      sourceHeight: height,
      sourceBytes: buf.byteLength,
      maxDimensionPx: params.maxDimensionPx,
      maxBytes: params.maxBytes,
      smallestCandidateBytes: best.byteLength,
      triggerOverBytes: overBytes,
      triggerOverDimensions: overDimensions,
    },
  );
  throw new Error(`Image could not be reduced below ${maxMb}MB (got ${gotMb}MB)`);
}
export async function sanitizeContentBlocksImages(blocks, label, opts = {}) {
  const maxDimensionPx = Math.max(opts.maxDimensionPx ?? MAX_IMAGE_DIMENSION_PX, 1);
  const maxBytes = Math.max(opts.maxBytes ?? MAX_IMAGE_BYTES, 1);
  const out = [];
  for (const block of blocks) {
    if (!isImageBlock(block)) {
      out.push(block);
      continue;
    }
    const data = block.data.trim();
    if (!data) {
      out.push({
        type: "text",
        text: `[${label}] omitted empty image payload`,
      });
      continue;
    }
    try {
      const inferredMimeType = inferMimeTypeFromBase64(data);
      const mimeType = inferredMimeType ?? block.mimeType;
      const resized = await resizeImageBase64IfNeeded({
        base64: data,
        mimeType,
        maxDimensionPx,
        maxBytes,
        label,
      });
      out.push({
        ...block,
        data: resized.base64,
        mimeType: resized.resized ? resized.mimeType : mimeType,
      });
    } catch (err) {
      out.push({
        type: "text",
        text: `[${label}] omitted image payload: ${String(err)}`,
      });
    }
  }
  return out;
}
export async function sanitizeImageBlocks(images, label, opts = {}) {
  if (images.length === 0) {
    return { images, dropped: 0 };
  }
  const sanitized = await sanitizeContentBlocksImages(images, label, opts);
  const next = sanitized.filter(isImageBlock);
  return { images: next, dropped: Math.max(0, images.length - next.length) };
}
export async function sanitizeToolResultImages(result, label, opts = {}) {
  const content = Array.isArray(result.content) ? result.content : [];
  if (!content.some((b) => isImageBlock(b) || isTextBlock(b))) {
    return result;
  }
  const next = await sanitizeContentBlocksImages(content, label, opts);
  return { ...result, content: next };
}
