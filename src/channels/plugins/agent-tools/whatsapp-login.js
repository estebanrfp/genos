import { Type } from "@sinclair/typebox";
export function createWhatsAppLoginTool() {
  return {
    label: "WhatsApp Login",
    name: "whatsapp_login",
    description: "Generate a WhatsApp QR code for linking, or wait for the scan to complete.",
    parameters: Type.Object({
      action: Type.Unsafe({
        type: "string",
        enum: ["start", "wait"],
      }),
      timeoutMs: Type.Optional(Type.Number()),
      force: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, args) => {
      const { startWebLoginWithQr, waitForWebLogin } = await import("../../../web/login-qr.js");
      const action = args?.action ?? "start";
      if (action === "wait") {
        const result = await waitForWebLogin({
          timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        });
        return {
          content: [{ type: "text", text: result.message }],
          details: { connected: result.connected },
        };
      }
      const result = await startWebLoginWithQr({
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
        force: typeof args.force === "boolean" ? args.force : false,
      });
      if (!result.qrDataUrl) {
        return {
          content: [
            {
              type: "text",
              text: result.message,
            },
          ],
          details: { qr: false },
        };
      }
      const text = [
        result.message,
        "",
        "Open WhatsApp \u2192 Linked Devices and scan:",
        "",
        `![whatsapp-qr](${result.qrDataUrl})`,
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        details: { qr: true },
      };
    },
  };
}
