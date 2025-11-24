// GenosOS — Esteban & Nyx 🦀🌙
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { STATE_DIR } from "../config/paths.js";
import { resolvePassphrase, KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT } from "../infra/crypto-utils.js";
import { isGatewayRunning } from "../infra/gateway-lock.js";
import { keychainGet, keychainSet, keychainDelete } from "../infra/keychain.js";
import { encryptFile, decryptFile, isEncrypted } from "../infra/memory-encryption.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatHelpExamples } from "./help-format.js";

/**
 * Prompt for vault passphrase via stdin (masked).
 * @returns {Promise<string>}
 */
const promptPassphrase = () =>
  new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write("Vault passphrase: ");
    rl.question("", (answer) => {
      rl.close();
      process.stderr.write("\n");
      if (answer?.trim()) {
        resolve(answer.trim());
      } else {
        reject(new Error("Empty passphrase"));
      }
    });
  });

/**
 * Resolve passphrase: env → .env → interactive prompt.
 * @returns {Promise<string | undefined>}
 */
const getPassphrase = async () => {
  if (process.env.VAULT_PASSPHRASE) {
    return undefined;
  } // let vault.js resolve it
  try {
    // Attempt without explicit — vault.js will try env + .env
    const { initVault } = await import("../infra/vault.js");
    initVault(); // throws if no passphrase found
    return undefined;
  } catch {
    return promptPassphrase();
  }
};

/**
 * Register vault CLI subcommands.
 * @param {import("commander").Command} program
 */
export function registerVaultCli(program) {
  const vault = program
    .command("vault")
    .description("Manage the encrypted secret vault")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["genosos vault set <key> <value>", "Store or update a secret."],
          ["genosos vault get <key>", "Retrieve a secret value."],
          ["genosos vault list", "List all stored secret keys."],
          ["genosos vault delete <key>", "Remove a secret."],
          ["genosos vault cat <path>", "Decrypt a file to stdout (pipe-safe, no disk write)."],
          ["genosos vault write <dest> [source]", "Encrypt and write a file (source or stdin)."],
          ["genosos vault lock", "Encrypt all files in the state directory."],
          ["genosos vault unlock", "Decrypt all files in the state directory."],
          ["genosos vault status", "Show encryption status of state directory."],
          ["genosos vault keychain-store", "Migrate passphrase to macOS Keychain."],
        ])}\n`,
    );

  // ── cat — decrypt to stdout (pipe-safe) ───────────────────────────

  vault
    .command("cat <path>")
    .description("Decrypt a NYXENC1 file to stdout without writing plaintext to disk")
    .action(async (filePath) => {
      try {
        const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
        let content;
        try {
          content = await fs.readFile(absPath, "utf-8");
        } catch (err) {
          process.stderr.write(`Error: cannot read ${absPath}: ${err.message}\n`);
          process.exitCode = 1;
          return;
        }

        if (!isEncrypted(content)) {
          // Plaintext — pass through directly
          process.stdout.write(content);
          return;
        }

        let passphrase;
        try {
          passphrase = resolvePassphrase();
        } catch {
          passphrase = await promptPassphrase();
        }

        const { decryptContent } = await import("../infra/memory-encryption.js");
        const plaintext = decryptContent(content, passphrase);
        process.stdout.write(plaintext);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  // ── write — encrypt and write a file ─────────────────────────────

  vault
    .command("write <dest> [source]")
    .description("Encrypt content and write to a NYXENC1 file (reads from <source> or stdin)")
    .action(async (dest, source) => {
      try {
        const absDest = path.isAbsolute(dest) ? dest : path.resolve(dest);
        let content;
        if (source) {
          const absSrc = path.isAbsolute(source) ? source : path.resolve(source);
          try {
            content = await fs.readFile(absSrc, "utf-8");
          } catch (err) {
            process.stderr.write(`Error: cannot read ${absSrc}: ${err.message}\n`);
            process.exitCode = 1;
            return;
          }
        } else {
          // Read from stdin
          const chunks = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          content = Buffer.concat(chunks).toString("utf-8");
        }
        if (!content) {
          process.stderr.write("Error: empty content\n");
          process.exitCode = 1;
          return;
        }
        let passphrase;
        try {
          passphrase = resolvePassphrase();
        } catch {
          passphrase = await promptPassphrase();
        }
        const { encryptContent } = await import("../infra/memory-encryption.js");
        const encrypted = encryptContent(content, passphrase);
        await fs.mkdir(path.dirname(absDest), { recursive: true });
        await fs.writeFile(absDest, encrypted, "utf-8");
        const rich = isRich();
        const label = shortenHomePath(absDest);
        defaultRuntime.log(rich ? theme.success(`Encrypted → ${label}`) : `Encrypted → ${label}`);
      } catch (err) {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      }
    });

  vault
    .command("set <key> <value>")
    .description("Store or update a secret in the vault")
    .action(async (key, value) => {
      try {
        const passphrase = await getPassphrase();
        const { initVault } = await import("../infra/vault.js");
        const v = initVault(passphrase);
        v.setSecret(key, value);
        const rich = isRich();
        defaultRuntime.log(
          rich ? theme.success(`Secret "${key}" stored.`) : `Secret "${key}" stored.`,
        );
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  vault
    .command("get <key>")
    .description("Retrieve a secret value from the vault")
    .action(async (key) => {
      try {
        const passphrase = await getPassphrase();
        const { initVault } = await import("../infra/vault.js");
        const v = initVault(passphrase);
        const entry = v.getSecret(key);
        if (!entry) {
          defaultRuntime.log(
            isRich()
              ? theme.muted(`No secret found for "${key}".`)
              : `No secret found for "${key}".`,
          );
          return;
        }
        defaultRuntime.log(entry.value);
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  vault
    .command("list")
    .description("List all stored secret keys")
    .action(async () => {
      try {
        const passphrase = await getPassphrase();
        const { initVault } = await import("../infra/vault.js");
        const v = initVault(passphrase);
        const keys = v.listSecrets();
        if (keys.length === 0) {
          defaultRuntime.log(isRich() ? theme.muted("Vault is empty.") : "Vault is empty.");
          return;
        }
        const rich = isRich();
        defaultRuntime.log(rich ? theme.heading("Stored secrets:") : "Stored secrets:");
        for (const k of keys) {
          defaultRuntime.log(rich ? `  ${theme.accent(k)}` : `  ${k}`);
        }
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  vault
    .command("delete <key>")
    .description("Remove a secret from the vault")
    .action(async (key) => {
      try {
        const passphrase = await getPassphrase();
        const { initVault } = await import("../infra/vault.js");
        const v = initVault(passphrase);
        const removed = v.deleteSecret(key);
        const rich = isRich();
        defaultRuntime.log(
          removed
            ? rich
              ? theme.success(`Secret "${key}" deleted.`)
              : `Secret "${key}" deleted.`
            : rich
              ? theme.muted(`No secret found for "${key}".`)
              : `No secret found for "${key}".`,
        );
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  // ── lock / unlock / status — Full state directory encryption ──────

  const ENCRYPTABLE_EXTENSIONS = new Set([".json", ".jsonl", ".md", ".txt", ".bak", ".sqlite"]);
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
  const SKIP_FILES = new Set([".env", "webauthn-credentials.json"]);

  /**
   * Recursively collect encryptable files in a directory.
   * @param {string} dir
   * @returns {Promise<string[]>}
   */
  const collectEncryptableFiles = async (dir) => {
    const results = [];
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collectEncryptableFiles(full)));
      } else if (entry.isFile()) {
        if (SKIP_FILES.has(entry.name)) {
          continue;
        }
        const ext = path.extname(entry.name);
        if (ENCRYPTABLE_EXTENSIONS.has(ext) || entry.name.includes(".bak.")) {
          results.push(full);
        }
      }
    }
    return results;
  };

  vault
    .command("lock")
    .description("Encrypt all files in the state directory (~/.genos)")
    .option("--dry-run", "Preview without writing")
    .option("--force", "Proceed even if the gateway is running (risk of data corruption)")
    .action(async (opts) => {
      try {
        if (!opts.force) {
          const gw = await isGatewayRunning();
          if (gw.running) {
            const rich = isRich();
            defaultRuntime.log(
              rich
                ? theme.error(
                    `Gateway is running (pid ${gw.pid}). Encrypting files while the gateway is active can corrupt session data.\nStop the gateway first, or use --force to proceed anyway.`,
                  )
                : `Error: Gateway is running (pid ${gw.pid}). Stop it first or use --force.`,
            );
            process.exitCode = 1;
            return;
          }
        }
        let passphrase;
        try {
          passphrase = resolvePassphrase();
        } catch {
          passphrase = await promptPassphrase();
        }
        const stateDir = STATE_DIR;
        const files = await collectEncryptableFiles(stateDir);
        const rich = isRich();
        let encrypted = 0;
        let skipped = 0;

        for (const filePath of files) {
          const label = shortenHomePath(filePath);
          if (filePath.endsWith(".sqlite")) {
            // SQLite files cannot be directly encrypted as whole files
            defaultRuntime.log(
              rich
                ? theme.muted(`SKIP ${label} (SQLite — chunks encrypted inline)`)
                : `SKIP ${label}`,
            );
            skipped++;
            continue;
          }
          if (opts.dryRun) {
            const content = await fs.readFile(filePath, "utf-8");
            if (isEncrypted(content)) {
              defaultRuntime.log(
                rich ? theme.muted(`SKIP ${label} (already encrypted)`) : `SKIP ${label}`,
              );
              skipped++;
            } else {
              defaultRuntime.log(
                rich ? theme.success(`WOULD ENCRYPT ${label}`) : `WOULD ENCRYPT ${label}`,
              );
              encrypted++;
            }
          } else {
            const result = await encryptFile(filePath, passphrase);
            if (result.wasPlaintext) {
              defaultRuntime.log(rich ? theme.success(`ENCRYPTED ${label}`) : `ENCRYPTED ${label}`);
              encrypted++;
            } else {
              defaultRuntime.log(
                rich ? theme.muted(`SKIP ${label} (already encrypted)`) : `SKIP ${label}`,
              );
              skipped++;
            }
          }
        }

        const summary = `${encrypted} encrypted, ${skipped} skipped`;
        defaultRuntime.log(rich ? `\n${theme.heading("Done:")} ${summary}` : `\nDone: ${summary}`);
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  vault
    .command("unlock")
    .description("Decrypt all files in the state directory (~/.genos)")
    .option("--dry-run", "Preview without writing")
    .option("--force", "Proceed even if the gateway is running (risk of data corruption)")
    .action(async (opts) => {
      try {
        if (!opts.force) {
          const gw = await isGatewayRunning();
          if (gw.running) {
            const rich = isRich();
            defaultRuntime.log(
              rich
                ? theme.error(
                    `Gateway is running (pid ${gw.pid}). Decrypting files while the gateway is active can corrupt session data.\nStop the gateway first, or use --force to proceed anyway.`,
                  )
                : `Error: Gateway is running (pid ${gw.pid}). Stop it first or use --force.`,
            );
            process.exitCode = 1;
            return;
          }
        }
        let passphrase;
        try {
          passphrase = resolvePassphrase();
        } catch {
          passphrase = await promptPassphrase();
        }
        const stateDir = STATE_DIR;
        const files = await collectEncryptableFiles(stateDir);
        const rich = isRich();
        let decrypted = 0;
        let skipped = 0;

        for (const filePath of files) {
          const label = shortenHomePath(filePath);
          if (filePath.endsWith(".sqlite")) {
            defaultRuntime.log(
              rich
                ? theme.muted(`SKIP ${label} (SQLite — use re-index to decrypt chunks)`)
                : `SKIP ${label}`,
            );
            skipped++;
            continue;
          }
          if (opts.dryRun) {
            const content = await fs.readFile(filePath, "utf-8");
            if (isEncrypted(content)) {
              defaultRuntime.log(
                rich ? theme.success(`WOULD DECRYPT ${label}`) : `WOULD DECRYPT ${label}`,
              );
              decrypted++;
            } else {
              defaultRuntime.log(rich ? theme.muted(`SKIP ${label} (plaintext)`) : `SKIP ${label}`);
              skipped++;
            }
          } else {
            const result = await decryptFile(filePath, passphrase);
            if (result.wasEncrypted) {
              defaultRuntime.log(rich ? theme.success(`DECRYPTED ${label}`) : `DECRYPTED ${label}`);
              decrypted++;
            } else {
              defaultRuntime.log(rich ? theme.muted(`SKIP ${label} (plaintext)`) : `SKIP ${label}`);
              skipped++;
            }
          }
        }

        const summary = `${decrypted} decrypted, ${skipped} skipped`;
        defaultRuntime.log(rich ? `\n${theme.heading("Done:")} ${summary}` : `\nDone: ${summary}`);
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  vault
    .command("status")
    .description("Show encryption status of the state directory")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      try {
        const stateDir = STATE_DIR;
        const files = await collectEncryptableFiles(stateDir);
        const categories = {
          config: { encrypted: 0, plaintext: 0, files: [] },
          sessions: { encrypted: 0, plaintext: 0, files: [] },
          memory: { encrypted: 0, plaintext: 0, files: [] },
          credentials: { encrypted: 0, plaintext: 0, files: [] },
          delivery: { encrypted: 0, plaintext: 0, files: [] },
          other: { encrypted: 0, plaintext: 0, files: [] },
        };

        const categorize = (filePath) => {
          const rel = path.relative(stateDir, filePath);
          if (rel.startsWith("agents") && rel.includes("sessions")) {
            return "sessions";
          }
          if (rel.startsWith("agents") && rel.includes("auth-profiles")) {
            return "credentials";
          }
          if (rel.startsWith("memory")) {
            return "memory";
          }
          if (rel.startsWith("delivery-queue")) {
            return "delivery";
          }
          if (rel.startsWith("credentials")) {
            return "credentials";
          }
          if (rel.includes("genosos.json") || rel.includes(".bak")) {
            return "config";
          }
          if (rel.startsWith("identity")) {
            return "credentials";
          }
          return "other";
        };

        for (const filePath of files) {
          if (filePath.endsWith(".sqlite")) {
            continue;
          }
          const cat = categorize(filePath);
          const content = await fs.readFile(filePath, "utf-8");
          const enc = isEncrypted(content);
          categories[cat][enc ? "encrypted" : "plaintext"]++;
          categories[cat].files.push({ path: shortenHomePath(filePath), encrypted: enc });
        }

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(categories, null, 2));
          return;
        }

        const rich = isRich();
        defaultRuntime.log(
          rich ? theme.heading("Vault Encryption Status") : "Vault Encryption Status",
        );
        defaultRuntime.log("");
        for (const [name, cat] of Object.entries(categories)) {
          const total = cat.encrypted + cat.plaintext;
          if (total === 0) {
            continue;
          }
          const allEncrypted = cat.plaintext === 0;
          const icon = allEncrypted ? "LOCKED" : "UNLOCKED";
          const colorFn = allEncrypted ? theme.success : theme.warn;
          defaultRuntime.log(
            rich
              ? `  ${colorFn(icon)} ${name}: ${cat.encrypted} encrypted, ${cat.plaintext} plaintext`
              : `  ${icon} ${name}: ${cat.encrypted} encrypted, ${cat.plaintext} plaintext`,
          );
        }

        const totalEnc = Object.values(categories).reduce((s, c) => s + c.encrypted, 0);
        const totalPlain = Object.values(categories).reduce((s, c) => s + c.plaintext, 0);
        defaultRuntime.log(
          rich
            ? `\n${theme.heading("Total:")} ${theme.success(String(totalEnc))} encrypted, ${theme.warn(String(totalPlain))} plaintext`
            : `\nTotal: ${totalEnc} encrypted, ${totalPlain} plaintext`,
        );
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  // ── Keychain integration ──────────────────────────────────────────

  vault
    .command("keychain-store")
    .description("Store vault passphrase in macOS Keychain and remove from .env")
    .action(async () => {
      if (process.platform !== "darwin") {
        defaultRuntime.log("Keychain storage is only available on macOS.");
        process.exitCode = 1;
        return;
      }
      try {
        const rich = isRich();
        let passphrase;
        try {
          passphrase = resolvePassphrase();
        } catch {
          passphrase = await promptPassphrase();
        }

        keychainSet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, passphrase);
        defaultRuntime.log(
          rich
            ? theme.success("Passphrase stored in macOS Keychain.")
            : "Passphrase stored in macOS Keychain.",
        );

        // Verify Keychain read-back
        const verify = keychainGet(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
        if (verify !== passphrase) {
          defaultRuntime.log(
            rich ? theme.error("Keychain verification failed!") : "Keychain verification failed!",
          );
          process.exitCode = 1;
          return;
        }

        // Remove VAULT_PASSPHRASE from .env file
        const envPath = `${STATE_DIR}/.env`;
        try {
          const content = await fs.readFile(envPath, "utf-8");
          const lines = content
            .split("\n")
            .filter((l) => !l.trim().startsWith("VAULT_PASSPHRASE="));
          const remaining = lines.join("\n").trim();
          if (remaining) {
            await fs.writeFile(envPath, remaining + "\n", "utf-8");
          } else {
            await fs.unlink(envPath);
          }
          defaultRuntime.log(
            rich
              ? theme.success("VAULT_PASSPHRASE removed from .env file.")
              : "VAULT_PASSPHRASE removed from .env file.",
          );
        } catch (err) {
          if (err?.code !== "ENOENT") {
            defaultRuntime.log(
              rich
                ? theme.warn(`Could not clean .env: ${err.message}`)
                : `Could not clean .env: ${err.message}`,
            );
          }
        }

        defaultRuntime.log(
          rich
            ? theme.heading("Done. Passphrase now resolves from Keychain.")
            : "Done. Passphrase now resolves from Keychain.",
        );
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });

  vault
    .command("keychain-remove")
    .description("Remove vault passphrase from macOS Keychain")
    .action(() => {
      if (process.platform !== "darwin") {
        defaultRuntime.log("Keychain storage is only available on macOS.");
        process.exitCode = 1;
        return;
      }
      try {
        keychainDelete(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
        const rich = isRich();
        defaultRuntime.log(
          rich
            ? theme.success("Passphrase removed from macOS Keychain.")
            : "Passphrase removed from macOS Keychain.",
        );
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });
}
