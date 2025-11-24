let formatMb = function (bytes, digits = 2) {
    return (bytes / MB).toFixed(digits);
  },
  formatCapLimit = function (label, cap, size) {
    return `${label} exceeds ${formatMb(cap, 0)}MB limit (got ${formatMb(size)}MB)`;
  },
  formatCapReduce = function (label, cap, size) {
    return `${label} could not be reduced below ${formatMb(cap, 0)}MB (got ${formatMb(size)}MB)`;
  },
  isHeicSource = function (opts) {
    if (opts.contentType && HEIC_MIME_RE.test(opts.contentType.trim())) {
      return true;
    }
    if (opts.fileName && HEIC_EXT_RE.test(opts.fileName.trim())) {
      return true;
    }
    return false;
  },
  toJpegFileName = function (fileName) {
    if (!fileName) {
      return;
    }
    const trimmed = fileName.trim();
    if (!trimmed) {
      return fileName;
    }
    const parsed = path.parse(trimmed);
    if (!parsed.ext || HEIC_EXT_RE.test(parsed.ext)) {
      return path.format({ dir: parsed.dir, name: parsed.name || trimmed, ext: ".jpg" });
    }
    return path.format({ dir: parsed.dir, name: parsed.name, ext: ".jpg" });
  },
  logOptimizedImage = function (params) {
    if (!shouldLogVerbose()) {
      return;
    }
    if (params.optimized.optimizedSize >= params.originalSize) {
      return;
    }
    if (params.optimized.format === "png") {
      logVerbose(
        `Optimized PNG (preserving alpha) from ${formatMb(params.originalSize)}MB to ${formatMb(params.optimized.optimizedSize)}MB (side\u2264${params.optimized.resizeSide}px)`,
      );
      return;
    }
    logVerbose(
      `Optimized media from ${formatMb(params.originalSize)}MB to ${formatMb(params.optimized.optimizedSize)}MB (side\u2264${params.optimized.resizeSide}px, q=${params.optimized.quality})`,
    );
  };
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logVerbose, shouldLogVerbose } from "../globals.js";
import { maxBytesForKind, mediaKindFromMime } from "../media/constants.js";
import { fetchRemoteMedia } from "../media/fetch.js";
import {
  convertHeicToJpeg,
  hasAlphaChannel,
  optimizeImageToPng,
  resizeToJpeg,
} from "../media/image-ops.js";
import { getDefaultMediaLocalRoots } from "../media/local-roots.js";
import { detectMime, extensionForMime } from "../media/mime.js";
import { resolveUserPath } from "../utils.js";
export function getDefaultLocalRoots() {
  return getDefaultMediaLocalRoots();
}
async function assertLocalMediaAllowed(mediaPath, localRoots) {
  if (localRoots === "any") {
    return;
  }
  const roots = localRoots ?? getDefaultLocalRoots();
  let resolved;
  try {
    resolved = await fs.realpath(mediaPath);
  } catch {
    resolved = path.resolve(mediaPath);
  }
  if (localRoots === undefined) {
    const workspaceRoot = roots.find((root) => path.basename(root) === "workspace");
    if (workspaceRoot) {
      const stateDir = path.dirname(workspaceRoot);
      const rel = path.relative(stateDir, resolved);
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        const firstSegment = rel.split(path.sep)[0] ?? "";
        if (firstSegment.startsWith("workspace-")) {
          throw new Error(`Local media path is not under an allowed directory: ${mediaPath}`);
        }
      }
    }
  }
  for (const root of roots) {
    let resolvedRoot;
    try {
      resolvedRoot = await fs.realpath(root);
    } catch {
      resolvedRoot = path.resolve(root);
    }
    if (resolvedRoot === path.parse(resolvedRoot).root) {
      throw new Error(
        `Invalid localRoots entry (refuses filesystem root): ${root}. Pass a narrower directory.`,
      );
    }
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) {
      return;
    }
  }
  throw new Error(`Local media path is not under an allowed directory: ${mediaPath}`);
}
const HEIC_MIME_RE = /^image\/hei[cf]$/i;
const HEIC_EXT_RE = /\.(heic|heif)$/i;
const MB = 1048576;
async function optimizeImageWithFallback(params) {
  const { buffer, cap, meta } = params;
  const isPng = meta?.contentType === "image/png" || meta?.fileName?.toLowerCase().endsWith(".png");
  const hasAlpha = isPng && (await hasAlphaChannel(buffer));
  if (hasAlpha) {
    const optimized = await optimizeImageToPng(buffer, cap);
    if (optimized.buffer.length <= cap) {
      return { ...optimized, format: "png" };
    }
    if (shouldLogVerbose()) {
      logVerbose(
        `PNG with alpha still exceeds ${formatMb(cap, 0)}MB after optimization; falling back to JPEG`,
      );
    }
  }
  const optimized = await optimizeImageToJpeg(buffer, cap, meta);
  return { ...optimized, format: "jpeg" };
}
async function loadWebMediaInternal(mediaUrl, options = {}) {
  const {
    maxBytes,
    optimizeImages = true,
    ssrfPolicy,
    localRoots,
    sandboxValidated = false,
    readFile: readFileOverride,
  } = options;
  mediaUrl = mediaUrl.replace(/^\s*MEDIA\s*:\s*/i, "");
  if (mediaUrl.startsWith("file://")) {
    try {
      mediaUrl = fileURLToPath(mediaUrl);
    } catch {
      throw new Error(`Invalid file:// URL: ${mediaUrl}`);
    }
  }
  const optimizeAndClampImage = async (buffer, cap, meta) => {
    const originalSize = buffer.length;
    const optimized = await optimizeImageWithFallback({ buffer, cap, meta });
    logOptimizedImage({ originalSize, optimized });
    if (optimized.buffer.length > cap) {
      throw new Error(formatCapReduce("Media", cap, optimized.buffer.length));
    }
    const contentType = optimized.format === "png" ? "image/png" : "image/jpeg";
    const fileName =
      optimized.format === "jpeg" && meta && isHeicSource(meta)
        ? toJpegFileName(meta.fileName)
        : meta?.fileName;
    return {
      buffer: optimized.buffer,
      contentType,
      kind: "image",
      fileName,
    };
  };
  const clampAndFinalize = async (params) => {
    const cap = maxBytes !== undefined ? maxBytes : maxBytesForKind(params.kind);
    if (params.kind === "image") {
      const isGif = params.contentType === "image/gif";
      if (isGif || !optimizeImages) {
        if (params.buffer.length > cap) {
          throw new Error(formatCapLimit(isGif ? "GIF" : "Media", cap, params.buffer.length));
        }
        return {
          buffer: params.buffer,
          contentType: params.contentType,
          kind: params.kind,
          fileName: params.fileName,
        };
      }
      return {
        ...(await optimizeAndClampImage(params.buffer, cap, {
          contentType: params.contentType,
          fileName: params.fileName,
        })),
      };
    }
    if (params.buffer.length > cap) {
      throw new Error(formatCapLimit("Media", cap, params.buffer.length));
    }
    return {
      buffer: params.buffer,
      contentType: params.contentType ?? undefined,
      kind: params.kind,
      fileName: params.fileName,
    };
  };
  if (/^https?:\/\//i.test(mediaUrl)) {
    const defaultFetchCap = maxBytesForKind("unknown");
    const fetchCap =
      maxBytes === undefined
        ? defaultFetchCap
        : optimizeImages
          ? Math.max(maxBytes, defaultFetchCap)
          : maxBytes;
    const fetched = await fetchRemoteMedia({ url: mediaUrl, maxBytes: fetchCap, ssrfPolicy });
    const { buffer, contentType, fileName } = fetched;
    const kind = mediaKindFromMime(contentType);
    return await clampAndFinalize({ buffer, contentType, kind, fileName });
  }
  if (mediaUrl.startsWith("~")) {
    mediaUrl = resolveUserPath(mediaUrl);
  }
  if ((sandboxValidated || localRoots === "any") && !readFileOverride) {
    throw new Error(
      "Refusing localRoots bypass without readFile override. Use sandboxValidated with readFile, or pass explicit localRoots.",
    );
  }
  if (!(sandboxValidated || localRoots === "any")) {
    await assertLocalMediaAllowed(mediaUrl, localRoots);
  }
  const data = readFileOverride ? await readFileOverride(mediaUrl) : await fs.readFile(mediaUrl);
  const mime = await detectMime({ buffer: data, filePath: mediaUrl });
  const kind = mediaKindFromMime(mime);
  let fileName = path.basename(mediaUrl) || undefined;
  if (fileName && !path.extname(fileName) && mime) {
    const ext = extensionForMime(mime);
    if (ext) {
      fileName = `${fileName}${ext}`;
    }
  }
  return await clampAndFinalize({
    buffer: data,
    contentType: mime,
    kind,
    fileName,
  });
}
export async function loadWebMedia(mediaUrl, maxBytesOrOptions, options) {
  if (typeof maxBytesOrOptions === "number" || maxBytesOrOptions === undefined) {
    return await loadWebMediaInternal(mediaUrl, {
      maxBytes: maxBytesOrOptions,
      optimizeImages: true,
      ssrfPolicy: options?.ssrfPolicy,
      localRoots: options?.localRoots,
    });
  }
  return await loadWebMediaInternal(mediaUrl, {
    ...maxBytesOrOptions,
    optimizeImages: maxBytesOrOptions.optimizeImages ?? true,
  });
}
export async function loadWebMediaRaw(mediaUrl, maxBytesOrOptions, options) {
  if (typeof maxBytesOrOptions === "number" || maxBytesOrOptions === undefined) {
    return await loadWebMediaInternal(mediaUrl, {
      maxBytes: maxBytesOrOptions,
      optimizeImages: false,
      ssrfPolicy: options?.ssrfPolicy,
      localRoots: options?.localRoots,
    });
  }
  return await loadWebMediaInternal(mediaUrl, {
    ...maxBytesOrOptions,
    optimizeImages: false,
  });
}
export async function optimizeImageToJpeg(buffer, maxBytes, opts = {}) {
  let source = buffer;
  if (isHeicSource(opts)) {
    try {
      source = await convertHeicToJpeg(buffer);
    } catch (err) {
      throw new Error(`HEIC image conversion failed: ${String(err)}`, { cause: err });
    }
  }
  const sides = [2048, 1536, 1280, 1024, 800];
  const qualities = [80, 70, 60, 50, 40];
  let smallest = null;
  for (const side of sides) {
    for (const quality of qualities) {
      try {
        const out = await resizeToJpeg({
          buffer: source,
          maxSide: side,
          quality,
          withoutEnlargement: true,
        });
        const size = out.length;
        if (!smallest || size < smallest.size) {
          smallest = { buffer: out, size, resizeSide: side, quality };
        }
        if (size <= maxBytes) {
          return {
            buffer: out,
            optimizedSize: size,
            resizeSide: side,
            quality,
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
      quality: smallest.quality,
    };
  }
  throw new Error("Failed to optimize image");
}

export { optimizeImageToPng };
