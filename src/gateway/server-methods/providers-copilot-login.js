/**
 * Legacy copilot login RPCs — thin wrappers that delegate to the unified providers.login handler.
 * Kept for backward compatibility. New code should use providers.login with provider: "github-copilot".
 */
import { providersLoginHandlers } from "./providers-login.js";

const handleCopilotLogin = (ctx) =>
  providersLoginHandlers["providers.login"]({
    ...ctx,
    params: { ...ctx.params, provider: "github-copilot" },
  });

const handleCopilotLoginStatus = (ctx) => providersLoginHandlers["providers.login.status"](ctx);

const handleCopilotLoginCancel = (ctx) => providersLoginHandlers["providers.login.cancel"](ctx);

export const copilotLoginHandlers = {
  "providers.copilot.login": handleCopilotLogin,
  "providers.copilot.login.status": handleCopilotLoginStatus,
  "providers.copilot.login.cancel": handleCopilotLoginCancel,
};
