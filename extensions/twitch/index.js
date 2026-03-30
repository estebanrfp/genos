import { emptyPluginConfigSchema } from "genosos/plugin-sdk";
import { twitchPlugin } from "./src/plugin.js";
import { setTwitchRuntime } from "./src/runtime.js";
export { monitorTwitchProvider } from "./src/monitor.js";
const plugin = {
  id: "twitch",
  name: "Twitch",
  description: "Twitch channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    setTwitchRuntime(api.runtime);
    api.registerChannel({ plugin: twitchPlugin });
  },
};
export default plugin;
