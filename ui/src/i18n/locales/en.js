export const en = {
  common: {
    health: "Health",
    ok: "OK",
    offline: "Offline",
    connect: "Connect",
    refresh: "Refresh",
    enabled: "Enabled",
    disabled: "Disabled",
    na: "n/a",
  },
  nav: {
    chat: "Chat",
    expand: "Expand sidebar",
    collapse: "Collapse sidebar",
  },
  tabs: {
    chat: "Chat",
  },
  subtitles: {
    chat: "Direct gateway chat session for quick interventions.",
  },
  connection: {
    access: {
      title: "Gateway Access",
      subtitle: "Where the dashboard connects and how it authenticates.",
      wsUrl: "WebSocket URL",
      token: "Gateway Token",
      connectHint: "Click Connect to apply connection changes.",
      trustedProxy: "Authenticated via trusted proxy.",
    },
    auth: {
      required: "This gateway requires auth. Add a token, then click Connect.",
      failed:
        "Auth failed. Re-copy a tokenized URL with {command}, or update the token, then click Connect.",
    },
    insecure: {
      hint: "This page is HTTP, so the browser blocks device identity. Use HTTPS (Tailscale Serve) or open {url} on the gateway host.",
      stayHttp: "If you must stay on HTTP, set {config} (token-only).",
    },
  },
  chat: {
    disconnected: "Disconnected from gateway.",
    refreshTitle: "Refresh chat data",
    thinkingToggle: "Toggle assistant thinking/working output",
    focusToggle: "Toggle focus mode (hide sidebar + page header)",
    onboardingDisabled: "Disabled during onboarding",
  },
};
