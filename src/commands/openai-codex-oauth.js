import { loginOpenAICodex } from "@mariozechner/pi-ai";
import { createVpsAwareOAuthHandlers } from "./oauth-flow.js";
export async function loginOpenAICodexOAuth(params) {
  const { prompter, runtime, isRemote, openUrl, localBrowserMessage } = params;
  await prompter.note(
    isRemote
      ? [
          "You are running in a remote/VPS environment.",
          "A URL will be shown for you to open in your LOCAL browser.",
          "After signing in, paste the redirect URL back here.",
        ].join("\n")
      : [
          "Browser will open for OpenAI authentication.",
          "If the callback doesn't auto-complete, paste the redirect URL.",
          "OpenAI OAuth uses localhost:1455 for the callback.",
        ].join("\n"),
    "OpenAI Codex OAuth",
  );
  const spin = prompter.progress("Starting OAuth flow\u2026");
  try {
    const { onAuth, onPrompt } = createVpsAwareOAuthHandlers({
      isRemote,
      prompter,
      runtime,
      spin,
      openUrl,
      localBrowserMessage: localBrowserMessage ?? "Complete sign-in in browser\u2026",
    });
    const creds = await loginOpenAICodex({
      onAuth,
      onPrompt,
      onProgress: (msg) => spin.update(msg),
    });
    spin.stop("OpenAI OAuth complete");
    return creds ?? null;
  } catch (err) {
    spin.stop("OpenAI OAuth failed");
    runtime.error(String(err));
    await prompter.note("Trouble with OAuth? See https://docs.genos.ai/start/faq", "OAuth help");
    throw err;
  }
}
