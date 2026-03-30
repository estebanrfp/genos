import { beforeEach } from "vitest";
import { slackPlugin } from "../../extensions/slack/src/channel.js";
import { setSlackRuntime } from "../../extensions/slack/src/runtime.js";
import { telegramPlugin } from "../../extensions/telegram/src/channel.js";
import { setTelegramRuntime } from "../../extensions/telegram/src/runtime.js";
import { whatsappPlugin } from "../../extensions/whatsapp/src/channel.js";
import { setWhatsAppRuntime } from "../../extensions/whatsapp/src/runtime.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createPluginRuntime } from "../plugins/runtime/index.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
const slackChannelPlugin = slackPlugin;
const telegramChannelPlugin = telegramPlugin;
const whatsappChannelPlugin = whatsappPlugin;
export function installHeartbeatRunnerTestRuntime(params) {
  beforeEach(() => {
    const runtime = createPluginRuntime();
    setTelegramRuntime(runtime);
    setWhatsAppRuntime(runtime);
    if (params?.includeSlack) {
      setSlackRuntime(runtime);
      setActivePluginRegistry(
        createTestRegistry([
          { pluginId: "slack", plugin: slackChannelPlugin, source: "test" },
          { pluginId: "whatsapp", plugin: whatsappChannelPlugin, source: "test" },
          { pluginId: "telegram", plugin: telegramChannelPlugin, source: "test" },
        ]),
      );
      return;
    }
    setActivePluginRegistry(
      createTestRegistry([
        { pluginId: "whatsapp", plugin: whatsappChannelPlugin, source: "test" },
        { pluginId: "telegram", plugin: telegramChannelPlugin, source: "test" },
      ]),
    );
  });
}
