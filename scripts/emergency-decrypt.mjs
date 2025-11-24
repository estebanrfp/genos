#!/usr/bin/env bun
// GenosOS — Emergency Memory Decryption (standalone, no src/ imports)
// Usage: bun scripts/emergency-decrypt.mjs <file-or-dir> [passphrase]

import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAGIC = "NYXENC1";
const ITERATIONS = 100_000;
const KEY_BYTES = 32;
const DIGEST = "sha512";

const deriveKey = (passphrase, salt) => pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_BYTES, DIGEST);

const decrypt = (fileContent, passphrase) => {
  const idx = fileContent.indexOf("\n");
  const envelope = JSON.parse(fileContent.slice(idx + 1));
  const salt = Buffer.from(envelope.salt, "hex");
  const iv = Buffer.from(envelope.iv, "hex");
  const tag = Buffer.from(envelope.tag, "hex");
  const data = Buffer.from(envelope.data, "base64");
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf-8");
};

const walkDir = (dir) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
};

const target = process.argv[2];
const passphrase = process.argv[3] || process.env.VAULT_PASSPHRASE;

if (!target) {
  console.error("Usage: bun scripts/emergency-decrypt.mjs <file-or-dir> [passphrase]");
  process.exit(1);
}

if (!passphrase) {
  console.error("Passphrase required: pass as 2nd arg or set VAULT_PASSPHRASE env var.");
  process.exit(1);
}

const stat = fs.statSync(target);
const files = stat.isDirectory() ? walkDir(target) : [target];

for (const filePath of files) {
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.startsWith(`${MAGIC}\n`)) {
    console.log(`SKIP     ${filePath}`);
    continue;
  }
  try {
    const plaintext = decrypt(content, passphrase);
    fs.writeFileSync(filePath, plaintext, "utf-8");
    console.log(`DECRYPTED ${filePath}`);
  } catch (err) {
    console.error(`FAILED   ${filePath}: ${err.message}`);
    process.exitCode = 1;
  }
}
