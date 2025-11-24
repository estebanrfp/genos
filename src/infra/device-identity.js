let resolveDefaultIdentityPath = function () {
    return path.join(resolveStateDir(), "identity", "device.json");
  },
  ensureDir = function (filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  },
  base64UrlEncode = function (buf) {
    return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  },
  base64UrlDecode = function (input) {
    const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, "base64");
  },
  derivePublicKeyRaw = function (publicKeyPem) {
    const key = crypto.createPublicKey(publicKeyPem);
    const spki = key.export({ type: "spki", format: "der" });
    if (
      spki.length === ED25519_SPKI_PREFIX.length + 32 &&
      spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ) {
      return spki.subarray(ED25519_SPKI_PREFIX.length);
    }
    return spki;
  },
  fingerprintPublicKey = function (publicKeyPem) {
    const raw = derivePublicKeyRaw(publicKeyPem);
    return crypto.createHash("sha256").update(raw).digest("hex");
  },
  generateIdentity = function () {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const deviceId = fingerprintPublicKey(publicKeyPem);
    return { deviceId, publicKeyPem, privateKeyPem };
  };
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { secureReadFileSync, secureWriteFileSync } from "./secure-io.js";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export function loadOrCreateDeviceIdentity(filePath = resolveDefaultIdentityPath()) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = secureReadFileSync(filePath);
      const parsed = JSON.parse(raw);
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedId && derivedId !== parsed.deviceId) {
          const updated = {
            ...parsed,
            deviceId: derivedId,
          };
          secureWriteFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`);
          try {
            fs.chmodSync(filePath, 384);
          } catch {}
          return {
            deviceId: derivedId,
            publicKeyPem: parsed.publicKeyPem,
            privateKeyPem: parsed.privateKeyPem,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        };
      }
    }
  } catch {}
  const identity = generateIdentity();
  ensureDir(filePath);
  const stored = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };
  secureWriteFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`);
  try {
    fs.chmodSync(filePath, 384);
  } catch {}
  return identity;
}
export function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}
export function normalizeDevicePublicKeyBase64Url(publicKey) {
  try {
    if (publicKey.includes("BEGIN")) {
      return base64UrlEncode(derivePublicKeyRaw(publicKey));
    }
    const raw = base64UrlDecode(publicKey);
    return base64UrlEncode(raw);
  } catch {
    return null;
  }
}
export function deriveDeviceIdFromPublicKey(publicKey) {
  try {
    const raw = publicKey.includes("BEGIN")
      ? derivePublicKeyRaw(publicKey)
      : base64UrlDecode(publicKey);
    return crypto.createHash("sha256").update(raw).digest("hex");
  } catch {
    return null;
  }
}
export function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}
export function verifyDeviceSignature(publicKey, payload, signatureBase64Url) {
  try {
    const key = publicKey.includes("BEGIN")
      ? crypto.createPublicKey(publicKey)
      : crypto.createPublicKey({
          key: Buffer.concat([ED25519_SPKI_PREFIX, base64UrlDecode(publicKey)]),
          type: "spki",
          format: "der",
        });
    const sig = (() => {
      try {
        return base64UrlDecode(signatureBase64Url);
      } catch {
        return Buffer.from(signatureBase64Url, "base64");
      }
    })();
    return crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);
  } catch {
    return false;
  }
}
