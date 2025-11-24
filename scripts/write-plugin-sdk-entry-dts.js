import fs from "node:fs";
import path from "node:path";
const entrypoints = ["index", "account-id"];
for (const entry of entrypoints) {
  const out = path.join(process.cwd(), `dist/plugin-sdk/${entry}.d.ts`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `export * from "./plugin-sdk/${entry}.js";\n`, "utf8");
}
