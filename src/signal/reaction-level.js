import { resolveReactionLevel } from "../utils/reaction-level.js";
import { resolveSignalAccount } from "./accounts.js";
export function resolveSignalReactionLevel(params) {
  const account = resolveSignalAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolveReactionLevel({
    value: account.config.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "minimal",
  });
}
