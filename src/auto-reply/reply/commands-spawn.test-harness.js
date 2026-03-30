import { buildCommandTestParams as buildBaseCommandTestParams } from "./commands.test-harness.js";
export function buildCommandTestParams(commandBody, cfg, ctxOverrides) {
  return buildBaseCommandTestParams(commandBody, cfg, ctxOverrides);
}
