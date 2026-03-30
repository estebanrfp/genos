export function resolveAssistantStreamDeltaText(evt) {
  const delta = evt.data.delta;
  const text = evt.data.text;
  return typeof delta === "string" ? delta : typeof text === "string" ? text : "";
}
