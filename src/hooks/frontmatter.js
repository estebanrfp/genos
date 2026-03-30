let parseInstallSpec = function (input) {
  const parsed = parseGenosOSManifestInstallBase(input, ["bundled", "npm", "git"]);
  if (!parsed) {
    return;
  }
  const { raw } = parsed;
  const spec = {
    kind: parsed.kind,
  };
  if (parsed.id) {
    spec.id = parsed.id;
  }
  if (parsed.label) {
    spec.label = parsed.label;
  }
  if (parsed.bins) {
    spec.bins = parsed.bins;
  }
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.repository === "string") {
    spec.repository = raw.repository;
  }
  return spec;
};
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import {
  getFrontmatterString,
  normalizeStringList,
  parseGenosOSManifestInstallBase,
  parseFrontmatterBool,
  resolveGenosOSManifestBlock,
  resolveGenosOSManifestInstall,
  resolveGenosOSManifestOs,
  resolveGenosOSManifestRequires,
} from "../shared/frontmatter.js";
export function parseFrontmatter(content) {
  return parseFrontmatterBlock(content);
}
export function resolveGenosOSMetadata(frontmatter) {
  const metadataObj = resolveGenosOSManifestBlock({ frontmatter });
  if (!metadataObj) {
    return;
  }
  const requires = resolveGenosOSManifestRequires(metadataObj);
  const install = resolveGenosOSManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveGenosOSManifestOs(metadataObj);
  const eventsRaw = normalizeStringList(metadataObj.events);
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    hookKey: typeof metadataObj.hookKey === "string" ? metadataObj.hookKey : undefined,
    export: typeof metadataObj.export === "string" ? metadataObj.export : undefined,
    os: osRaw.length > 0 ? osRaw : undefined,
    events: eventsRaw.length > 0 ? eventsRaw : [],
    requires,
    install: install.length > 0 ? install : undefined,
  };
}
export function resolveHookInvocationPolicy(frontmatter) {
  return {
    enabled: parseFrontmatterBool(getFrontmatterString(frontmatter, "enabled"), true),
  };
}
export function resolveHookKey(hookName, entry) {
  return entry?.metadata?.hookKey ?? hookName;
}
