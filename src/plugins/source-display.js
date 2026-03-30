let tryRelative = function (root, filePath) {
  const rel = path.relative(root, filePath);
  if (!rel || rel === ".") {
    return null;
  }
  if (rel === "..") {
    return null;
  }
  if (rel.startsWith(`..${path.sep}`) || rel.startsWith("../") || rel.startsWith("..\\")) {
    return null;
  }
  if (path.isAbsolute(rel)) {
    return null;
  }
  return rel.replaceAll("\\", "/");
};
import path from "node:path";
import { resolveConfigDir, shortenHomeInString } from "../utils.js";
import { resolveBundledPluginsDir } from "./bundled-dir.js";
export function resolvePluginSourceRoots(params) {
  const stock = resolveBundledPluginsDir();
  const global = path.join(resolveConfigDir(), "extensions");
  const workspace = params.workspaceDir
    ? path.join(params.workspaceDir, ".genosv1", "extensions")
    : undefined;
  return { stock, global, workspace };
}
export function formatPluginSourceForTable(plugin, roots) {
  const raw = plugin.source;
  if (plugin.origin === "bundled" && roots.stock) {
    const rel = tryRelative(roots.stock, raw);
    if (rel) {
      return { value: `stock:${rel}`, rootKey: "stock" };
    }
  }
  if (plugin.origin === "workspace" && roots.workspace) {
    const rel = tryRelative(roots.workspace, raw);
    if (rel) {
      return { value: `workspace:${rel}`, rootKey: "workspace" };
    }
  }
  if (plugin.origin === "global" && roots.global) {
    const rel = tryRelative(roots.global, raw);
    if (rel) {
      return { value: `global:${rel}`, rootKey: "global" };
    }
  }
  return { value: shortenHomeInString(raw) };
}
