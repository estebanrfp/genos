let applySkillConfigEnvOverrides = function (params) {
    const { updates, skillConfig, primaryEnv } = params;
    if (skillConfig.env) {
      for (const [envKey, envValue] of Object.entries(skillConfig.env)) {
        if (!envValue || process.env[envKey]) {
          continue;
        }
        updates.push({ key: envKey, prev: process.env[envKey] });
        process.env[envKey] = envValue;
      }
    }
    if (primaryEnv && skillConfig.apiKey && !process.env[primaryEnv]) {
      updates.push({ key: primaryEnv, prev: process.env[primaryEnv] });
      process.env[primaryEnv] = skillConfig.apiKey;
    }
  },
  createEnvReverter = function (updates) {
    return () => {
      for (const update of updates) {
        if (update.prev === undefined) {
          delete process.env[update.key];
        } else {
          process.env[update.key] = update.prev;
        }
      }
    };
  };
import { resolveSkillConfig } from "./config.js";
import { resolveSkillKey } from "./frontmatter.js";
export function applySkillEnvOverrides(params) {
  const { skills, config } = params;
  const updates = [];
  for (const entry of skills) {
    const skillKey = resolveSkillKey(entry.skill, entry);
    const skillConfig = resolveSkillConfig(config, skillKey);
    if (!skillConfig) {
      continue;
    }
    applySkillConfigEnvOverrides({
      updates,
      skillConfig,
      primaryEnv: entry.metadata?.primaryEnv,
    });
  }
  return createEnvReverter(updates);
}
export function applySkillEnvOverridesFromSnapshot(params) {
  const { snapshot, config } = params;
  if (!snapshot) {
    return () => {};
  }
  const updates = [];
  for (const skill of snapshot.skills) {
    const skillConfig = resolveSkillConfig(config, skill.name);
    if (!skillConfig) {
      continue;
    }
    applySkillConfigEnvOverrides({
      updates,
      skillConfig,
      primaryEnv: skill.primaryEnv,
    });
  }
  return createEnvReverter(updates);
}
