let unwrapMessage = function (message) {
    const normalized = normalizeMessageContent(message);
    return normalized;
  },
  resolveMediaMimetype = function (message) {
    const explicit =
      message.imageMessage?.mimetype ??
      message.videoMessage?.mimetype ??
      message.documentMessage?.mimetype ??
      message.audioMessage?.mimetype ??
      message.stickerMessage?.mimetype ??
      undefined;
    if (explicit) {
      return explicit;
    }
    if (message.audioMessage) {
      return "audio/ogg; codecs=opus";
    }
    if (message.imageMessage) {
      return "image/jpeg";
    }
    if (message.videoMessage) {
      return "video/mp4";
    }
    if (message.stickerMessage) {
      return "image/webp";
    }
    return;
  };
import { downloadMediaMessage, normalizeMessageContent } from "@whiskeysockets/baileys";
import { logVerbose } from "../../globals.js";
export async function downloadInboundMedia(msg, sock) {
  const message = unwrapMessage(msg.message);
  if (!message) {
    return;
  }
  const mimetype = resolveMediaMimetype(message);
  const fileName = message.documentMessage?.fileName ?? undefined;
  if (
    !message.imageMessage &&
    !message.videoMessage &&
    !message.documentMessage &&
    !message.audioMessage &&
    !message.stickerMessage
  ) {
    return;
  }
  try {
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      {
        reuploadRequest: sock.updateMediaMessage,
        logger: sock.logger,
      },
    );
    return { buffer, mimetype, fileName };
  } catch (err) {
    logVerbose(`downloadMediaMessage failed: ${String(err)}`);
    return;
  }
}
