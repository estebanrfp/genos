let runtime = null;
export function setWhatsAppRuntime(next) {
  runtime = next;
}
export function getWhatsAppRuntime() {
  if (!runtime) {
    throw new Error("WhatsApp runtime not initialized");
  }
  return runtime;
}
