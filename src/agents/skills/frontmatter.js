let parseInstallSpec = function (input) {
  const parsed = parseGenosOSManifestInstallBase(input, ["brew", "node", "go", "uv", "download"]);
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
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) {
    spec.os = osList;
  }
  if (typeof raw.formula === "string") {
    spec.formula = raw.formula;
  }
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.module === "string") {
    spec.module = raw.module;
  }
  if (typeof raw.url === "string") {
    spec.url = raw.url;
  }
  if (typeof raw.archive === "string") {
    spec.archive = raw.archive;
  }
  if (typeof raw.extract === "boolean") {
    spec.extract = raw.extract;
  }
  if (typeof raw.stripComponents === "number") {
    spec.stripComponents = raw.stripComponents;
  }
  if (typeof raw.targetDir === "string") {
    spec.targetDir = raw.targetDir;
  }
  return spec;
};
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import {
  getFrontmatterString,
  normalizeStringList,
  parseGenosOSManifestInstallBase,
  parseFrontmatterBool,
  resolveGenosOSManifestBlock,
  resolveGenosOSManifestInstall,
  resolveGenosOSManifestOs,
  resolveGenosOSManifestRequires,
} from "../../shared/frontmatter.js";
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
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    skillKey: typeof metadataObj.skillKey === "string" ? metadataObj.skillKey : undefined,
    primaryEnv: typeof metadataObj.primaryEnv === "string" ? metadataObj.primaryEnv : undefined,
    os: osRaw.length > 0 ? osRaw : undefined,
    requires,
    install: install.length > 0 ? install : undefined,
  };
}
export function resolveSkillInvocationPolicy(frontmatter) {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterString(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterString(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}
export function resolveSkillKey(skill, entry) {
  return entry?.metadata?.skillKey ?? skill.name;
}
