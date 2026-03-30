import JSON5 from "json5";
import { LEGACY_MANIFEST_KEYS, MANIFEST_KEY } from "../compat/legacy-names.js";
import { parseBooleanValue } from "../utils/boolean.js";
export function normalizeStringList(input) {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}
export function getFrontmatterString(frontmatter, key) {
  const raw = frontmatter[key];
  return typeof raw === "string" ? raw : undefined;
}
export function parseFrontmatterBool(value, fallback) {
  const parsed = parseBooleanValue(value);
  return parsed === undefined ? fallback : parsed;
}
export function resolveGenosOSManifestBlock(params) {
  const raw = getFrontmatterString(params.frontmatter, params.key ?? "metadata");
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON5.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    const manifestKeys = [MANIFEST_KEY, ...LEGACY_MANIFEST_KEYS];
    for (const key of manifestKeys) {
      const candidate = parsed[key];
      if (candidate && typeof candidate === "object") {
        return candidate;
      }
    }
    return;
  } catch {
    return;
  }
}
export function resolveGenosOSManifestRequires(metadataObj) {
  const requiresRaw =
    typeof metadataObj.requires === "object" && metadataObj.requires !== null
      ? metadataObj.requires
      : undefined;
  if (!requiresRaw) {
    return;
  }
  return {
    bins: normalizeStringList(requiresRaw.bins),
    anyBins: normalizeStringList(requiresRaw.anyBins),
    env: normalizeStringList(requiresRaw.env),
    config: normalizeStringList(requiresRaw.config),
  };
}
export function resolveGenosOSManifestInstall(metadataObj, parseInstallSpec) {
  const installRaw = Array.isArray(metadataObj.install) ? metadataObj.install : [];
  return installRaw.map((entry) => parseInstallSpec(entry)).filter((entry) => Boolean(entry));
}
export function resolveGenosOSManifestOs(metadataObj) {
  return normalizeStringList(metadataObj.os);
}
export function parseGenosOSManifestInstallBase(input, allowedKinds) {
  if (!input || typeof input !== "object") {
    return;
  }
  const raw = input;
  const kindRaw =
    typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
  const kind = kindRaw.trim().toLowerCase();
  if (!allowedKinds.includes(kind)) {
    return;
  }
  const spec = {
    raw,
    kind,
  };
  if (typeof raw.id === "string") {
    spec.id = raw.id;
  }
  if (typeof raw.label === "string") {
    spec.label = raw.label;
  }
  const bins = normalizeStringList(raw.bins);
  if (bins.length > 0) {
    spec.bins = bins;
  }
  return spec;
}
