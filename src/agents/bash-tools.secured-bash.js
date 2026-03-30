import { createBashTool } from "@mariozechner/pi-coding-agent";
import { resolveDenyBins } from "../infra/exec-approvals-allowlist.js";
import { checkDenyBins } from "../infra/exec-approvals.js";

/**
 * Create a secured "bash" tool that wraps the library's createBashTool
 * with deny bins enforcement. This prevents the library's built-in
 * bash tool from bypassing GenosOS's security pipeline.
 * @param {string} cwd - Working directory for the bash tool
 * @param {{ denyBins?: string[] }} [options] - Optional config overrides
 * @returns {object} Tool definition with name "bash" and deny bins check
 */
export function createSecuredBashTool(cwd, options) {
  const baseTool = createBashTool(cwd);
  const denySet = resolveDenyBins(options?.denyBins);
  return {
    ...baseTool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const command = args?.command ?? "";
      const deny = checkDenyBins(command, denySet);
      if (deny.denied) {
        throw new Error(
          `exec denied: "${deny.bin}" is in the deny list and cannot be executed in any security mode`,
        );
      }
      return baseTool.execute(toolCallId, args, signal, onUpdate);
    },
  };
}
