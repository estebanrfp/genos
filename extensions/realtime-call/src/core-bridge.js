let findPackageRoot = function (startDir, name) {
    let dir = startDir;
    for (;;) {
      const pkgPath = path.join(dir, "package.json");
      try {
        if (fs.existsSync(pkgPath)) {
          const raw = fs.readFileSync(pkgPath, "utf8");
          const pkg = JSON.parse(raw);
          if (pkg.name === name) {
            return dir;
          }
        }
      } catch {}
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  },
  resolveGenosOSRoot = function () {
    if (coreRootCache) {
      return coreRootCache;
    }
    const override = process.env.GENOS_ROOT?.trim();
    if (override) {
      coreRootCache = override;
      return override;
    }
    const candidates = new Set();
    if (process.argv[1]) {
      candidates.add(path.dirname(process.argv[1]));
    }
    candidates.add(process.cwd());
    try {
      const urlPath = fileURLToPath(import.meta.url);
      candidates.add(path.dirname(urlPath));
    } catch {}
    for (const start of candidates) {
      for (const name of ["genosos"]) {
        const found = findPackageRoot(start, name);
        if (found) {
          coreRootCache = found;
          return found;
        }
      }
    }
    throw new Error("Unable to resolve core root. Set GENOS_ROOT to the package root.");
  };
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
let coreRootCache = null;
let coreDepsPromise = null;
async function importCoreExtensionAPI() {
  const distPath = path.join(resolveGenosOSRoot(), "dist", "extensionAPI.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Missing core module at ${distPath}. Run \`pnpm build\` or install the official package.`,
    );
  }
  return await import(pathToFileURL(distPath).href);
}
export async function loadCoreAgentDeps() {
  if (coreDepsPromise) {
    return coreDepsPromise;
  }
  coreDepsPromise = (async () => {
    return await importCoreExtensionAPI();
  })();
  return coreDepsPromise;
}
