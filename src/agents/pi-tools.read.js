let clamp = function (value, min, max) {
    return Math.max(min, Math.min(max, value));
  },
  resolveAdaptiveReadMaxBytes = function (options) {
    const contextWindowTokens = options?.modelContextWindowTokens;
    if (
      typeof contextWindowTokens !== "number" ||
      !Number.isFinite(contextWindowTokens) ||
      contextWindowTokens <= 0
    ) {
      return DEFAULT_READ_PAGE_MAX_BYTES;
    }
    const fromContext = Math.floor(
      contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * ADAPTIVE_READ_CONTEXT_SHARE,
    );
    return clamp(fromContext, DEFAULT_READ_PAGE_MAX_BYTES, MAX_ADAPTIVE_READ_MAX_BYTES);
  },
  formatBytes = function (bytes) {
    if (bytes >= 1048576) {
      return `${(bytes / 1048576).toFixed(1)}MB`;
    }
    if (bytes >= 1024) {
      return `${Math.round(bytes / 1024)}KB`;
    }
    return `${bytes}B`;
  },
  getToolResultText = function (result) {
    const content = Array.isArray(result.content) ? result.content : [];
    const textBlocks = content
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          block.type === "text" &&
          typeof block.text === "string"
        ) {
          return block.text;
        }
        return;
      })
      .filter((value) => typeof value === "string");
    if (textBlocks.length === 0) {
      return;
    }
    return textBlocks.join("\n");
  },
  withToolResultText = function (result, text) {
    const content = Array.isArray(result.content) ? result.content : [];
    let replaced = false;
    const nextContent = content.map((block) => {
      if (!replaced && block && typeof block === "object" && block.type === "text") {
        replaced = true;
        return {
          ...block,
          text,
        };
      }
      return block;
    });
    if (replaced) {
      return {
        ...result,
        content: nextContent,
      };
    }
    const textBlock = { type: "text", text };
    return {
      ...result,
      content: [textBlock],
    };
  },
  extractReadTruncationDetails = function (result) {
    const details = result.details;
    if (!details || typeof details !== "object") {
      return null;
    }
    const truncation = details.truncation;
    if (!truncation || typeof truncation !== "object") {
      return null;
    }
    const record = truncation;
    if (record.truncated !== true) {
      return null;
    }
    const outputLinesRaw = record.outputLines;
    const outputLines =
      typeof outputLinesRaw === "number" && Number.isFinite(outputLinesRaw)
        ? Math.max(0, Math.floor(outputLinesRaw))
        : 0;
    return {
      truncated: true,
      outputLines,
      firstLineExceedsLimit: record.firstLineExceedsLimit === true,
    };
  },
  stripReadContinuationNotice = function (text) {
    return text.replace(READ_CONTINUATION_NOTICE_RE, "");
  },
  stripReadTruncationContentDetails = function (result) {
    const details = result.details;
    if (!details || typeof details !== "object") {
      return result;
    }
    const detailsRecord = details;
    const truncationRaw = detailsRecord.truncation;
    if (!truncationRaw || typeof truncationRaw !== "object") {
      return result;
    }
    const truncation = truncationRaw;
    if (!Object.prototype.hasOwnProperty.call(truncation, "content")) {
      return result;
    }
    const { content: _content, ...restTruncation } = truncation;
    return {
      ...result,
      details: {
        ...detailsRecord,
        truncation: restTruncation,
      },
    };
  },
  rewriteReadImageHeader = function (text, mimeType) {
    if (text.startsWith("Read image file [") && text.endsWith("]")) {
      return `Read image file [${mimeType}]`;
    }
    return text;
  },
  parameterValidationError = function (message) {
    return new Error(`${message}.${RETRY_GUIDANCE_SUFFIX}`);
  },
  extractStructuredText = function (value, depth = 0) {
    if (depth > 6) {
      return;
    }
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((entry) => extractStructuredText(entry, depth + 1))
        .filter((entry) => typeof entry === "string");
      return parts.length > 0 ? parts.join("") : undefined;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (Array.isArray(record.content)) {
      return extractStructuredText(record.content, depth + 1);
    }
    if (Array.isArray(record.parts)) {
      return extractStructuredText(record.parts, depth + 1);
    }
    if (typeof record.value === "string" && record.value.length > 0) {
      const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
      const kind = typeof record.kind === "string" ? record.kind.toLowerCase() : "";
      if (type.includes("text") || kind === "text") {
        return record.value;
      }
    }
    return;
  },
  normalizeTextLikeParam = function (record, key) {
    const value = record[key];
    if (typeof value === "string") {
      return;
    }
    const extracted = extractStructuredText(value);
    if (typeof extracted === "string") {
      record[key] = extracted;
    }
  };
import { constants } from "node:fs";
import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  mkdir as fsMkdir,
  access as fsAccess,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { logSuccess } from "../logger.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import { sanitizeToolResultImages } from "./tool-images.js";

/**
 * Create secure write operations that transparently encrypt workspace files with NYXENC1.
 * @param {string} workspaceRoot
 * @returns {{ writeFile: Function, mkdir: Function }}
 */
export function createSecureWriteOperations(workspaceRoot) {
  return {
    writeFile: async (absPath, content) => {
      const inWorkspace = absPath.startsWith(workspaceRoot + sep) || absPath === workspaceRoot;
      if (inWorkspace) {
        try {
          const { secureWriteFile } = await import("../infra/secure-io.js");
          await secureWriteFile(absPath, content);
          return;
        } catch {}
      }
      await fsWriteFile(absPath, content, "utf-8");
    },
    mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
  };
}

/**
 * Create secure edit operations that transparently decrypt/encrypt workspace files with NYXENC1.
 * @param {string} workspaceRoot
 * @returns {{ readFile: Function, writeFile: Function, access: Function }}
 */
export function createSecureEditOperations(workspaceRoot) {
  return {
    readFile: async (absPath) => {
      const raw = await fsReadFile(absPath);
      const text = raw.toString("utf-8");
      const inWorkspace = absPath.startsWith(workspaceRoot + sep) || absPath === workspaceRoot;
      if (inWorkspace && text.startsWith("NYXENC1\n")) {
        try {
          const { decryptContent } = await import("../infra/memory-encryption.js");
          const { resolvePassphrase } = await import("../infra/crypto-utils.js");
          const passphrase = resolvePassphrase();
          if (passphrase) {
            return Buffer.from(decryptContent(text, passphrase), "utf-8");
          }
        } catch {}
      }
      return raw;
    },
    writeFile: async (absPath, content) => {
      const inWorkspace = absPath.startsWith(workspaceRoot + sep) || absPath === workspaceRoot;
      if (inWorkspace) {
        try {
          const { secureWriteFile } = await import("../infra/secure-io.js");
          await secureWriteFile(absPath, content);
          return;
        } catch {}
      }
      await fsWriteFile(absPath, content, "utf-8");
    },
    access: (absPath) => fsAccess(absPath, constants.R_OK | constants.W_OK),
  };
}
const DEFAULT_READ_PAGE_MAX_BYTES = 51200;
const MAX_ADAPTIVE_READ_MAX_BYTES = 524288;
const ADAPTIVE_READ_CONTEXT_SHARE = 0.2;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_ADAPTIVE_READ_PAGES = 8;
const READ_CONTINUATION_NOTICE_RE =
  /\n\n\[(?:Showing lines [^\]]*?Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\]\s*$/;
async function executeReadWithAdaptivePaging(params) {
  const userLimit = params.args.limit;
  const hasExplicitLimit =
    typeof userLimit === "number" && Number.isFinite(userLimit) && userLimit > 0;
  if (hasExplicitLimit) {
    return await params.base.execute(params.toolCallId, params.args, params.signal);
  }
  const offsetRaw = params.args.offset;
  let nextOffset =
    typeof offsetRaw === "number" && Number.isFinite(offsetRaw) && offsetRaw > 0
      ? Math.floor(offsetRaw)
      : 1;
  let firstResult = null;
  let aggregatedText = "";
  let aggregatedBytes = 0;
  let capped = false;
  let continuationOffset;
  for (let page = 0; page < MAX_ADAPTIVE_READ_PAGES; page += 1) {
    const pageArgs = { ...params.args, offset: nextOffset };
    const pageResult = await params.base.execute(params.toolCallId, pageArgs, params.signal);
    firstResult ??= pageResult;
    const rawText = getToolResultText(pageResult);
    if (typeof rawText !== "string") {
      return pageResult;
    }
    const truncation = extractReadTruncationDetails(pageResult);
    const canContinue =
      Boolean(truncation?.truncated) &&
      !truncation?.firstLineExceedsLimit &&
      (truncation?.outputLines ?? 0) > 0 &&
      page < MAX_ADAPTIVE_READ_PAGES - 1;
    const pageText = canContinue ? stripReadContinuationNotice(rawText) : rawText;
    const delimiter = aggregatedText ? "\n\n" : "";
    const nextBytes = Buffer.byteLength(`${delimiter}${pageText}`, "utf-8");
    if (aggregatedText && aggregatedBytes + nextBytes > params.maxBytes) {
      capped = true;
      continuationOffset = nextOffset;
      break;
    }
    aggregatedText += `${delimiter}${pageText}`;
    aggregatedBytes += nextBytes;
    if (!canContinue || !truncation) {
      return withToolResultText(pageResult, aggregatedText);
    }
    nextOffset += truncation.outputLines;
    continuationOffset = nextOffset;
    if (aggregatedBytes >= params.maxBytes) {
      capped = true;
      break;
    }
  }
  if (!firstResult) {
    return await params.base.execute(params.toolCallId, params.args, params.signal);
  }
  let finalText = aggregatedText;
  if (capped && continuationOffset) {
    finalText += `\n\n[Read output capped at ${formatBytes(params.maxBytes)} for this call. Use offset=${continuationOffset} to continue.]`;
  }
  return withToolResultText(firstResult, finalText);
}
async function normalizeReadImageResult(result, filePath) {
  const content = Array.isArray(result.content) ? result.content : [];
  const image = content.find(
    (b) =>
      !!b &&
      typeof b === "object" &&
      b.type === "image" &&
      typeof b.data === "string" &&
      typeof b.mimeType === "string",
  );
  if (!image) {
    return result;
  }
  if (!image.data.trim()) {
    throw new Error(`read: image payload is empty (${filePath})`);
  }
  const sniffed = await sniffMimeFromBase64(image.data);
  if (!sniffed) {
    return result;
  }
  if (!sniffed.startsWith("image/")) {
    throw new Error(
      `read: file looks like ${sniffed} but was treated as ${image.mimeType} (${filePath})`,
    );
  }
  if (sniffed === image.mimeType) {
    return result;
  }
  const nextContent = content.map((block) => {
    if (block && typeof block === "object" && block.type === "image") {
      const b = block;
      return { ...b, mimeType: sniffed };
    }
    if (
      block &&
      typeof block === "object" &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      const b = block;
      return {
        ...b,
        text: rewriteReadImageHeader(b.text, sniffed),
      };
    }
    return block;
  });
  return { ...result, content: nextContent };
}
const RETRY_GUIDANCE_SUFFIX = " Supply correct parameters before retrying.";
export const CLAUDE_PARAM_GROUPS = {
  read: [{ keys: ["path", "file_path"], label: "path (path or file_path)" }],
  write: [
    { keys: ["path", "file_path"], label: "path (path or file_path)" },
    { keys: ["content"], label: "content" },
  ],
  edit: [
    { keys: ["path", "file_path"], label: "path (path or file_path)" },
    {
      keys: ["oldText", "old_string"],
      label: "oldText (oldText or old_string)",
    },
    {
      keys: ["newText", "new_string"],
      label: "newText (newText or new_string)",
    },
  ],
};
export function normalizeToolParams(params) {
  if (!params || typeof params !== "object") {
    return;
  }
  const record = params;
  const normalized = { ...record };
  if ("file_path" in normalized && !("path" in normalized)) {
    normalized.path = normalized.file_path;
    delete normalized.file_path;
  }
  if ("old_string" in normalized && !("oldText" in normalized)) {
    normalized.oldText = normalized.old_string;
    delete normalized.old_string;
  }
  if ("new_string" in normalized && !("newText" in normalized)) {
    normalized.newText = normalized.new_string;
    delete normalized.new_string;
  }
  normalizeTextLikeParam(normalized, "content");
  normalizeTextLikeParam(normalized, "oldText");
  normalizeTextLikeParam(normalized, "newText");
  return normalized;
}
export function patchToolSchemaForClaudeCompatibility(tool) {
  const schema =
    tool.parameters && typeof tool.parameters === "object" ? tool.parameters : undefined;
  if (!schema || !schema.properties || typeof schema.properties !== "object") {
    return tool;
  }
  const properties = { ...schema.properties };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key) => typeof key === "string")
    : [];
  let changed = false;
  const aliasPairs = [
    { original: "path", alias: "file_path" },
    { original: "oldText", alias: "old_string" },
    { original: "newText", alias: "new_string" },
  ];
  for (const { original, alias } of aliasPairs) {
    if (!(original in properties)) {
      continue;
    }
    if (!(alias in properties)) {
      properties[alias] = properties[original];
      changed = true;
    }
    const idx = required.indexOf(original);
    if (idx !== -1) {
      required.splice(idx, 1);
      changed = true;
    }
  }
  if (!changed) {
    return tool;
  }
  return {
    ...tool,
    parameters: {
      ...schema,
      properties,
      required,
    },
  };
}
export function assertRequiredParams(record, groups, toolName) {
  if (!record || typeof record !== "object") {
    throw parameterValidationError(`Missing parameters for ${toolName}`);
  }
  const missingLabels = [];
  for (const group of groups) {
    const satisfied = group.keys.some((key) => {
      if (!(key in record)) {
        return false;
      }
      const value = record[key];
      if (typeof value !== "string") {
        return false;
      }
      if (group.allowEmpty) {
        return true;
      }
      return value.trim().length > 0;
    });
    if (!satisfied) {
      const label = group.label ?? group.keys.join(" or ");
      missingLabels.push(label);
    }
  }
  if (missingLabels.length > 0) {
    const joined = missingLabels.join(", ");
    const noun = missingLabels.length === 1 ? "parameter" : "parameters";
    throw parameterValidationError(`Missing required ${noun}: ${joined}`);
  }
}
export function wrapToolParamNormalization(tool, requiredParamGroups) {
  const patched = patchToolSchemaForClaudeCompatibility(tool);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record = normalized ?? (params && typeof params === "object" ? params : undefined);
      if (requiredParamGroups?.length) {
        assertRequiredParams(record, requiredParamGroups, tool.name);
      }
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}
export function createGenosOSReadTool(base, options) {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return {
    ...patched,
    execute: async (toolCallId, params, signal) => {
      const normalized = normalizeToolParams(params);
      const record = normalized ?? (params && typeof params === "object" ? params : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.read, base.name);
      const rawReadPath = normalizeWorkspacePath(
        typeof record?.path === "string" ? record.path.trim() : null,
        options?.workspaceRoot,
      );
      if (rawReadPath && record) {
        record.path = rawReadPath;
      }
      const result = await executeReadWithAdaptivePaging({
        base,
        toolCallId,
        args: normalized ?? params ?? {},
        signal,
        maxBytes: resolveAdaptiveReadMaxBytes(options),
      });
      const filePath = typeof record?.path === "string" ? String(record.path) : "<unknown>";
      const strippedDetailsResult = stripReadTruncationContentDetails(result);
      const normalizedResult = await normalizeReadImageResult(strippedDetailsResult, filePath);
      // Transparently decrypt NYXENC1-encrypted files so the agent receives plaintext
      const rawText = getToolResultText(normalizedResult);
      if (typeof rawText === "string" && rawText.trimStart().startsWith("NYXENC1\n")) {
        try {
          const { decryptContent } = await import("../infra/memory-encryption.js");
          const { resolvePassphrase } = await import("../infra/crypto-utils.js");
          const passphrase = resolvePassphrase();
          if (passphrase) {
            const decrypted = decryptContent(rawText.trimStart(), passphrase);
            logSuccess(`[tools/read] transparently decrypted NYXENC1 file: ${filePath}`);
            return sanitizeToolResultImages(
              withToolResultText(normalizedResult, decrypted),
              `read:${filePath}`,
              options?.imageSanitization,
            );
          }
        } catch {
          // Decryption failed — fall through and return raw result
        }
      }
      return sanitizeToolResultImages(
        normalizedResult,
        `read:${filePath}`,
        options?.imageSanitization,
      );
    },
  };
}

/** Protected workspace filenames — writes require biometric approval via the gateway. */
const PROTECTED_TOOL_WRITE_NAMES = new Set(["AGENTS.md", "SECURITY.md"]);

/** Approval timeout sent to the gateway handler (ms). */
const FILE_APPROVAL_CALL_TIMEOUT_MS = 125000;
const FILE_APPROVAL_INNER_TIMEOUT_MS = 120000;

/**
 * Check if the given absolute path is a protected file inside the workspace root.
 * @param {string} absPath
 * @param {string|undefined} workspaceRoot
 * @returns {string|null} filename if protected, null otherwise
 */
function resolveProtectedName(absPath, workspaceRoot) {
  if (!workspaceRoot) {
    return null;
  }
  const inWorkspace = absPath.startsWith(workspaceRoot + sep) || absPath === workspaceRoot;
  if (!inWorkspace) {
    return null;
  }
  const name = basename(absPath);
  return PROTECTED_TOOL_WRITE_NAMES.has(name) ? name : null;
}

/**
 * Request biometric approval from the gateway for a protected workspace file write.
 * Blocks for up to FILE_APPROVAL_INNER_TIMEOUT_MS waiting for the workspace owner.
 * Throws if denied or timed out.
 * @param {{ agentId: string|null, name: string, operation: string, preview: string|null }} opts
 */
async function requestToolFileApproval(opts) {
  const { callGatewayTool } = await import("./tools/gateway.js");
  const result = await callGatewayTool(
    "files.approval.request",
    { timeoutMs: FILE_APPROVAL_CALL_TIMEOUT_MS },
    {
      agentId: opts.agentId,
      name: opts.name,
      operation: opts.operation,
      preview: opts.preview,
      timeoutMs: FILE_APPROVAL_INNER_TIMEOUT_MS,
    },
  );
  if (!result || result.decision !== "approve") {
    throw new Error(`Write to protected file '${opts.name}' was denied by the workspace owner.`);
  }
}

/**
 * Redirect stale workspace paths to the agent's current workspace.
 * Prevents LLMs from writing to old workspace dirs (e.g. workspace-amigo-nyx instead of workspace-9073c46a).
 * @param {string|null} rawPath
 * @param {string|undefined} workspaceRoot
 * @returns {string|null}
 */
const normalizeWorkspacePath = (rawPath, workspaceRoot) => {
  if (!rawPath || !workspaceRoot) {
    return rawPath;
  }
  const parentDir = dirname(workspaceRoot);
  const foreignPrefix = parentDir + sep + "workspace-";
  const ownPrefix = workspaceRoot + sep;
  if (
    rawPath.startsWith(foreignPrefix) &&
    !rawPath.startsWith(ownPrefix) &&
    rawPath !== workspaceRoot
  ) {
    const afterParent = rawPath.slice(parentDir.length + 1);
    const slashIdx = afterParent.indexOf(sep);
    if (slashIdx >= 0) {
      return join(workspaceRoot, afterParent.slice(slashIdx + 1));
    }
  }
  return rawPath;
};

/**
 * Wrap the SDK Write tool with a biometric approval gate for protected workspace files.
 * Also handles param normalization (file_path → path alias, required param validation).
 * @param {object} base - createWriteTool(workspaceRoot) result
 * @param {{ workspaceRoot?: string, agentId?: string }} options
 */
export function createGenosOSWriteTool(base, options) {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record = normalized ?? (params && typeof params === "object" ? params : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.write, base.name);
      let rawPath = typeof record?.path === "string" ? record.path.trim() : null;
      rawPath = normalizeWorkspacePath(rawPath, options?.workspaceRoot);
      if (rawPath && record) {
        record.path = rawPath;
      }
      if (rawPath) {
        const absPath = isAbsolute(rawPath)
          ? rawPath
          : resolve(options?.workspaceRoot ?? process.cwd(), rawPath);
        const protectedName = resolveProtectedName(absPath, options?.workspaceRoot);
        if (protectedName) {
          const preview = typeof record?.content === "string" ? record.content.slice(0, 300) : null;
          await requestToolFileApproval({
            agentId: options?.agentId ?? null,
            name: protectedName,
            operation: "write",
            preview,
          });
        }
      }
      return base.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}

/**
 * Wrap the SDK Edit tool with a biometric approval gate for protected workspace files.
 * Also handles param normalization (file_path → path, old_string → oldText aliases).
 * @param {object} base - createEditTool(workspaceRoot) result
 * @param {{ workspaceRoot?: string, agentId?: string }} options
 */
export function createGenosOSEditTool(base, options) {
  const patched = patchToolSchemaForClaudeCompatibility(base);
  return {
    ...patched,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record = normalized ?? (params && typeof params === "object" ? params : undefined);
      assertRequiredParams(record, CLAUDE_PARAM_GROUPS.edit, base.name);
      let rawPath = typeof record?.path === "string" ? record.path.trim() : null;
      rawPath = normalizeWorkspacePath(rawPath, options?.workspaceRoot);
      if (rawPath && record) {
        record.path = rawPath;
      }
      if (rawPath) {
        const absPath = isAbsolute(rawPath)
          ? rawPath
          : resolve(options?.workspaceRoot ?? process.cwd(), rawPath);
        const protectedName = resolveProtectedName(absPath, options?.workspaceRoot);
        if (protectedName) {
          const oldSnip = typeof record?.oldText === "string" ? record.oldText.slice(0, 150) : "";
          const newSnip = typeof record?.newText === "string" ? record.newText.slice(0, 150) : "";
          const preview = `--- ${oldSnip}\n+++ ${newSnip}`;
          await requestToolFileApproval({
            agentId: options?.agentId ?? null,
            name: protectedName,
            operation: "edit",
            preview,
          });
        }
      }
      return base.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}
