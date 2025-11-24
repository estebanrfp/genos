import { createLlmTaskTool } from "./src/llm-task-tool.js";
export default function register(api) {
  api.registerTool(createLlmTaskTool(api), { optional: true });
}
