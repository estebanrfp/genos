// GenosOS — Esteban & Nyx 🦀🌙
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { WORKSPACE_ENCRYPT_PATTERNS } from "../infra/memory-encryption.js";
import { listMemoryFiles } from "../memory/internal.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatHelpExamples } from "./help-format.js";

/**
 * List all workspace files matching WORKSPACE_ENCRYPT_PATTERNS.
 * @param {string} workspaceDir
 * @returns {Promise<string[]>}
 */
async function listAllWorkspaceFiles(workspaceDir) {
  const result = [];
  const seen = new Set();
  for (const pattern of WORKSPACE_ENCRYPT_PATTERNS) {
    if (pattern.includes("*") || pattern.includes("?")) {
      try {
        const matches = fs.glob(pattern, { cwd: workspaceDir });
        for await (const m of matches) {
          const abs = path.resolve(workspaceDir, m);
          if (!seen.has(abs)) {
            seen.add(abs);
            result.push(abs);
          }
        }
      } catch {}
    } else {
      const abs = path.join(workspaceDir, pattern);
      try {
        await fs.access(abs);
        if (!seen.has(abs)) {
          seen.add(abs);
          result.push(abs);
        }
      } catch {}
    }
  }
  return result;
}

/**
 * Prompt for passphrase via stdin.
 * @returns {Promise<string>}
 */
const promptPassphrase = () =>
  new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write("Memory encryption passphrase: ");
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
 * Resolve passphrase: env -> .env -> interactive prompt.
 * @returns {Promise<string>}
 */
const getPassphrase = async () => {
  try {
    const { resolvePassphrase } = await import("../infra/crypto-utils.js");
    return resolvePassphrase();
  } catch {
    return promptPassphrase();
  }
};

/**
 * Resolve workspace directory from options or config.
 * @param {{ workspace?: string }} opts
 * @returns {string}
 */
const resolveWorkspace = (opts) => {
  if (opts.workspace) {
    return path.resolve(opts.workspace);
  }
  const cfg = loadConfig();
  return resolveAgentWorkspaceDir(cfg, "main");
};

/**
 * Register memory encryption CLI subcommands.
 * @param {import("commander").Command} memoryCommand
 */
export function registerMemoryEncryptCli(memoryCommand) {
  memoryCommand
    .command("encrypt")
    .description("Encrypt memory files (or all workspace files with --all)")
    .option("--workspace <dir>", "Override workspace directory")
    .option("--dry-run", "Show what would be encrypted without writing")
    .option("--all", "Encrypt all workspace files (SOUL, IDENTITY, USER, etc.)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["genosos memory encrypt", "Encrypt all memory files."],
          ["genosos memory encrypt --all", "Encrypt all workspace files."],
          ["genosos memory encrypt --dry-run", "Preview without writing."],
        ])}\n`,
    )
    .action(async (opts) => {
      try {
        const passphrase = await getPassphrase();
        const workspaceDir = resolveWorkspace(opts);
        const files = opts.all
          ? await listAllWorkspaceFiles(workspaceDir)
          : await listMemoryFiles(workspaceDir);
        const { encryptFile, isEncrypted } = await import("../infra/memory-encryption.js");
        const rich = isRich();
        let encrypted = 0;
        let skipped = 0;

        for (const filePath of files) {
          const label = shortenHomePath(filePath);
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

  memoryCommand
    .command("decrypt")
    .description("Decrypt memory files (or all workspace files with --all)")
    .option("--workspace <dir>", "Override workspace directory")
    .option("--dry-run", "Show what would be decrypted without writing")
    .option("--all", "Decrypt all workspace files (SOUL, IDENTITY, USER, etc.)")
    .action(async (opts) => {
      try {
        const passphrase = await getPassphrase();
        const workspaceDir = resolveWorkspace(opts);
        const files = opts.all
          ? await listAllWorkspaceFiles(workspaceDir)
          : await listMemoryFiles(workspaceDir);
        const { decryptFile, isEncrypted } = await import("../infra/memory-encryption.js");
        const rich = isRich();
        let decrypted = 0;
        let skipped = 0;

        for (const filePath of files) {
          const label = shortenHomePath(filePath);
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

  memoryCommand
    .command("encryption-status")
    .description("Show encryption status of workspace files")
    .option("--workspace <dir>", "Override workspace directory")
    .option("--all", "Include all workspace files (SOUL, IDENTITY, USER, etc.)")
    .option("--json", "Output JSON")
    .action(async (opts) => {
      try {
        const workspaceDir = resolveWorkspace(opts);
        const files = opts.all
          ? await listAllWorkspaceFiles(workspaceDir)
          : await listMemoryFiles(workspaceDir);
        const { isEncrypted } = await import("../infra/memory-encryption.js");
        const results = [];

        for (const filePath of files) {
          const content = await fs.readFile(filePath, "utf-8");
          results.push({
            path: shortenHomePath(filePath),
            encrypted: isEncrypted(content),
          });
        }

        if (opts.json) {
          defaultRuntime.log(JSON.stringify(results, null, 2));
          return;
        }

        const rich = isRich();
        const encCount = results.filter((r) => r.encrypted).length;
        const plainCount = results.length - encCount;

        defaultRuntime.log(
          rich
            ? `${theme.heading("Memory Encryption Status")} (${results.length} files)`
            : `Memory Encryption Status (${results.length} files)`,
        );

        for (const entry of results) {
          const icon = entry.encrypted ? "ENCRYPTED" : "PLAINTEXT";
          const colorFn = entry.encrypted ? theme.success : theme.warn;
          defaultRuntime.log(rich ? `  ${colorFn(icon)} ${entry.path}` : `  ${icon} ${entry.path}`);
        }

        defaultRuntime.log(
          rich
            ? `\n${theme.success(String(encCount))} encrypted, ${theme.warn(String(plainCount))} plaintext`
            : `\n${encCount} encrypted, ${plainCount} plaintext`,
        );
      } catch (err) {
        defaultRuntime.log(isRich() ? theme.error(err.message) : err.message);
        process.exitCode = 1;
      }
    });
}
