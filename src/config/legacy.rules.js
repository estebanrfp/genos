export const LEGACY_CONFIG_RULES = [
  {
    path: ["whatsapp"],
    message: "whatsapp config moved to channels.whatsapp (auto-migrated on load).",
  },
  {
    path: ["telegram"],
    message: "telegram config moved to channels.telegram (auto-migrated on load).",
  },
  {
    path: ["discord"],
    message: "discord config moved to channels.discord (auto-migrated on load).",
  },
  {
    path: ["slack"],
    message: "slack config moved to channels.slack (auto-migrated on load).",
  },
  {
    path: ["signal"],
    message: "signal config moved to channels.signal (auto-migrated on load).",
  },
  {
    path: ["imessage"],
    message: "imessage config moved to channels.imessage (auto-migrated on load).",
  },
  {
    path: ["msteams"],
    message: "msteams config moved to channels.msteams (auto-migrated on load).",
  },
  {
    path: ["routing", "allowFrom"],
    message:
      "routing.allowFrom was removed; use channels.whatsapp.allowFrom instead (auto-migrated on load).",
  },
  {
    path: ["routing", "bindings"],
    message: "routing.bindings was moved; use top-level bindings instead (auto-migrated on load).",
  },
  {
    path: ["routing", "agents"],
    message: "routing.agents was moved; use agents.list instead (auto-migrated on load).",
  },
  {
    path: ["routing", "defaultAgentId"],
    message:
      "routing.defaultAgentId was moved; use agents.list[].default instead (auto-migrated on load).",
  },
  {
    path: ["routing", "agentToAgent"],
    message:
      "routing.agentToAgent was moved; use tools.agentToAgent instead (auto-migrated on load).",
  },
  {
    path: ["routing", "groupChat", "requireMention"],
    message:
      'routing.groupChat.requireMention was removed; use channels.whatsapp/telegram/imessage groups defaults (e.g. channels.whatsapp.groups."*".requireMention) instead (auto-migrated on load).',
  },
  {
    path: ["routing", "groupChat", "mentionPatterns"],
    message:
      "routing.groupChat.mentionPatterns was moved; use agents.list[].groupChat.mentionPatterns or messages.groupChat.mentionPatterns instead (auto-migrated on load).",
  },
  {
    path: ["routing", "queue"],
    message: "routing.queue was moved; use messages.queue instead (auto-migrated on load).",
  },
  {
    path: ["routing", "transcribeAudio"],
    message:
      "routing.transcribeAudio was moved; use tools.media.audio.models instead (auto-migrated on load).",
  },
  {
    path: ["telegram", "requireMention"],
    message:
      'telegram.requireMention was removed; use channels.telegram.groups."*".requireMention instead (auto-migrated on load).',
  },
  {
    path: ["identity"],
    message: "identity was moved; use agents.list[].identity instead (auto-migrated on load).",
  },
  {
    path: ["agent"],
    message:
      "agent.* was moved; use agents.defaults (and tools.* for tool/elevated/exec settings) instead (auto-migrated on load).",
  },
  {
    path: ["memorySearch"],
    message:
      "top-level memorySearch was moved; use agents.defaults.memorySearch instead (auto-migrated on load).",
  },
  {
    path: ["tools", "bash"],
    message: "tools.bash was removed; use tools.exec instead (auto-migrated on load).",
  },
  {
    path: ["agent", "model"],
    message:
      "agent.model string was replaced by agents.defaults.model.primary/fallbacks and agents.defaults.models (auto-migrated on load).",
    match: (value) => typeof value === "string",
  },
  {
    path: ["agent", "imageModel"],
    message:
      "agent.imageModel string was replaced by agents.defaults.imageModel.primary/fallbacks (auto-migrated on load).",
    match: (value) => typeof value === "string",
  },
  {
    path: ["agent", "allowedModels"],
    message: "agent.allowedModels was replaced by agents.defaults.models (auto-migrated on load).",
  },
  {
    path: ["agent", "modelAliases"],
    message:
      "agent.modelAliases was replaced by agents.defaults.models.*.alias (auto-migrated on load).",
  },
  {
    path: ["agent", "modelFallbacks"],
    message:
      "agent.modelFallbacks was replaced by agents.defaults.model.fallbacks (auto-migrated on load).",
  },
  {
    path: ["agent", "imageModelFallbacks"],
    message:
      "agent.imageModelFallbacks was replaced by agents.defaults.imageModel.fallbacks (auto-migrated on load).",
  },
  {
    path: ["messages", "tts", "enabled"],
    message: "messages.tts.enabled was replaced by messages.tts.auto (auto-migrated on load).",
  },
  {
    path: ["gateway", "token"],
    message: "gateway.token is ignored; use gateway.auth.token instead (auto-migrated on load).",
  },
  {
    path: ["auth", "profiles"],
    message:
      "auth.profiles mode metadata is now inferred from providers[*].credentials; merged into providers on load (auto-migrated on load).",
  },
  {
    path: ["auth", "order"],
    message: "auth.order was moved to providers[*].failover (auto-migrated on load).",
  },
  {
    path: ["models", "providers"],
    message: "models.providers was merged into top-level providers[*] (auto-migrated on load).",
  },
  {
    path: ["env"],
    message:
      "AI provider API keys in env are now stored in providers[*].credentials (auto-migrated on load).",
    match: (value) => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const aiKeys = [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "DEEPGRAM_API_KEY",
        "CEREBRAS_API_KEY",
        "XAI_API_KEY",
        "OPENROUTER_API_KEY",
        "MISTRAL_API_KEY",
        "TOGETHER_API_KEY",
        "VOYAGE_API_KEY",
        "NVIDIA_API_KEY",
        "VLLM_API_KEY",
      ];
      // Check both env.vars.* and env.* (top-level)
      const vars = typeof value.vars === "object" ? value.vars : {};
      return aiKeys.some((key) => key in vars || key in value);
    },
  },
  {
    path: ["models"],
    message:
      "models section only contains default values and can be removed (auto-migrated on load).",
    match: (value) => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const keys = Object.keys(value);
      return keys.length === 0 || (keys.length === 1 && value.mode === "merge");
    },
  },
];
