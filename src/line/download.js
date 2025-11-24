let detectContentType = function (buffer) {
    if (buffer.length >= 2) {
      if (buffer[0] === 255 && buffer[1] === 216) {
        return "image/jpeg";
      }
      if (buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) {
        return "image/png";
      }
      if (buffer[0] === 71 && buffer[1] === 73 && buffer[2] === 70) {
        return "image/gif";
      }
      if (
        buffer[0] === 82 &&
        buffer[1] === 73 &&
        buffer[2] === 70 &&
        buffer[3] === 70 &&
        buffer[8] === 87 &&
        buffer[9] === 69 &&
        buffer[10] === 66 &&
        buffer[11] === 80
      ) {
        return "image/webp";
      }
      if (buffer[4] === 102 && buffer[5] === 116 && buffer[6] === 121 && buffer[7] === 112) {
        return "video/mp4";
      }
      if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 0) {
        if (buffer[4] === 102 && buffer[5] === 116 && buffer[6] === 121 && buffer[7] === 112) {
          return "audio/mp4";
        }
      }
    }
    return "application/octet-stream";
  },
  getExtensionForContentType = function (contentType) {
    switch (contentType) {
      case "image/jpeg":
        return ".jpg";
      case "image/png":
        return ".png";
      case "image/gif":
        return ".gif";
      case "image/webp":
        return ".webp";
      case "video/mp4":
        return ".mp4";
      case "audio/mp4":
        return ".m4a";
      case "audio/mpeg":
        return ".mp3";
      default:
        return ".bin";
    }
  };
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { messagingApi } from "@line/bot-sdk";
import { logVerbose } from "../globals.js";
export async function downloadLineMedia(messageId, channelAccessToken, maxBytes = 10485760) {
  const client = new messagingApi.MessagingApiBlobClient({
    channelAccessToken,
  });
  const response = await client.getMessageContent(messageId);
  const chunks = [];
  let totalSize = 0;
  for await (const chunk of response) {
    totalSize += chunk.length;
    if (totalSize > maxBytes) {
      throw new Error(`Media exceeds ${Math.round(maxBytes / 1048576)}MB limit`);
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const contentType = detectContentType(buffer);
  const ext = getExtensionForContentType(contentType);
  const tempDir = os.tmpdir();
  const fileName = `line-media-${messageId}-${Date.now()}${ext}`;
  const filePath = path.join(tempDir, fileName);
  await fs.promises.writeFile(filePath, buffer);
  logVerbose(`line: downloaded media ${messageId} to ${filePath} (${buffer.length} bytes)`);
  return {
    path: filePath,
    contentType,
    size: buffer.length,
  };
}
