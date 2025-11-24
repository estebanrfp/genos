import fs from "node:fs/promises";
import path from "node:path";
export function setTempStateDir(workspaceDir) {
  const stateDir = path.join(workspaceDir, "state");
  process.env.GENOS_STATE_DIR = stateDir;
  return stateDir;
}
export async function writeDownloadSkill(params) {
  const skillDir = path.join(params.workspaceDir, "skills", params.name);
  await fs.mkdir(skillDir, { recursive: true });
  const meta = {
    genosos: {
      install: [
        {
          id: params.installId,
          kind: "download",
          url: params.url,
          archive: params.archive,
          extract: true,
          stripComponents: params.stripComponents,
          targetDir: params.targetDir,
        },
      ],
    },
  };
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${params.name}
description: test skill
metadata: ${JSON.stringify(meta)}
---

# ${params.name}
`,
    "utf-8",
  );
  await fs.writeFile(path.join(skillDir, "runner.js"), "export {};\n", "utf-8");
  return skillDir;
}
