let isPathLikeToken = function (value) {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed === "-") {
      return false;
    }
    if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("~")) {
      return true;
    }
    if (trimmed.startsWith("/")) {
      return true;
    }
    return /^[A-Za-z]:[\\/]/.test(trimmed);
  },
  defaultFileExists = function (filePath) {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  },
  hasGlobToken = function (value) {
    return /[*?[\]]/.test(value);
  },
  evaluateSegments = function (segments, params) {
    const matches = [];
    const allowSkills = params.autoAllowSkills === true && (params.skillBins?.size ?? 0) > 0;
    const segmentSatisfiedBy = [];
    const satisfied = segments.every((segment) => {
      const candidatePath = resolveAllowlistCandidatePath(segment.resolution, params.cwd);
      const candidateResolution =
        candidatePath && segment.resolution
          ? { ...segment.resolution, resolvedPath: candidatePath }
          : segment.resolution;
      const match = matchAllowlist(params.allowlist, candidateResolution);
      if (match) {
        matches.push(match);
      }
      const safe = isSafeBinUsage({
        argv: segment.argv,
        resolution: segment.resolution,
        safeBins: params.safeBins,
        cwd: params.cwd,
      });
      const skillAllow =
        allowSkills && segment.resolution?.executableName
          ? params.skillBins?.has(segment.resolution.executableName)
          : false;
      const by = match ? "allowlist" : safe ? "safeBins" : skillAllow ? "skills" : null;
      segmentSatisfiedBy.push(by);
      return Boolean(by);
    });
    return { satisfied, matches, segmentSatisfiedBy };
  };
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_DENY_BINS,
  DEFAULT_SAFE_BINS,
  analyzeShellCommand,
  isWindowsPlatform,
  matchAllowlist,
  resolveAllowlistCandidatePath,
  splitCommandChain,
} from "./exec-approvals-analysis.js";
import { isTrustedSafeBinPath } from "./exec-safe-bin-trust.js";
export function normalizeSafeBins(entries) {
  if (!Array.isArray(entries)) {
    return new Set();
  }
  const normalized = entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(normalized);
}
export function resolveSafeBins(entries) {
  if (entries === undefined) {
    return normalizeSafeBins(DEFAULT_SAFE_BINS);
  }
  return normalizeSafeBins(entries ?? []);
}
/**
 * Resolve deny bins from config entries. Returns DEFAULT_DENY_BINS when undefined.
 * @param {string[]|undefined} entries - custom deny list or undefined for defaults
 * @returns {Set<string>}
 */
export function resolveDenyBins(entries) {
  if (entries === undefined) {
    return new Set(DEFAULT_DENY_BINS);
  }
  return normalizeSafeBins(entries ?? []);
}
export function isSafeBinUsage(params) {
  if (isWindowsPlatform(process.platform)) {
    return false;
  }
  if (params.safeBins.size === 0) {
    return false;
  }
  const resolution = params.resolution;
  const execName = resolution?.executableName?.toLowerCase();
  if (!execName) {
    return false;
  }
  const matchesSafeBin =
    params.safeBins.has(execName) ||
    (process.platform === "win32" && params.safeBins.has(path.parse(execName).name));
  if (!matchesSafeBin) {
    return false;
  }
  if (!resolution?.resolvedPath) {
    return false;
  }
  if (
    !isTrustedSafeBinPath({
      resolvedPath: resolution.resolvedPath,
      trustedDirs: params.trustedSafeBinDirs,
    })
  ) {
    return false;
  }
  const cwd = params.cwd ?? process.cwd();
  const exists = params.fileExists ?? defaultFileExists;
  const argv = params.argv.slice(1);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    if (token === "-") {
      continue;
    }
    if (token.startsWith("-")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex > 0) {
        const value = token.slice(eqIndex + 1);
        if (value && hasGlobToken(value)) {
          return false;
        }
        if (value && (isPathLikeToken(value) || exists(path.resolve(cwd, value)))) {
          return false;
        }
      }
      continue;
    }
    if (hasGlobToken(token)) {
      return false;
    }
    if (isPathLikeToken(token)) {
      return false;
    }
    if (exists(path.resolve(cwd, token))) {
      return false;
    }
  }
  return true;
}
export function evaluateExecAllowlist(params) {
  const allowlistMatches = [];
  const segmentSatisfiedBy = [];
  if (!params.analysis.ok || params.analysis.segments.length === 0) {
    return { allowlistSatisfied: false, allowlistMatches, segmentSatisfiedBy };
  }
  if (params.analysis.chains) {
    for (const chainSegments of params.analysis.chains) {
      const result = evaluateSegments(chainSegments, {
        allowlist: params.allowlist,
        safeBins: params.safeBins,
        cwd: params.cwd,
        skillBins: params.skillBins,
        autoAllowSkills: params.autoAllowSkills,
      });
      if (!result.satisfied) {
        return { allowlistSatisfied: false, allowlistMatches: [], segmentSatisfiedBy: [] };
      }
      allowlistMatches.push(...result.matches);
      segmentSatisfiedBy.push(...result.segmentSatisfiedBy);
    }
    return { allowlistSatisfied: true, allowlistMatches, segmentSatisfiedBy };
  }
  const result = evaluateSegments(params.analysis.segments, {
    allowlist: params.allowlist,
    safeBins: params.safeBins,
    cwd: params.cwd,
    skillBins: params.skillBins,
    autoAllowSkills: params.autoAllowSkills,
  });
  return {
    allowlistSatisfied: result.satisfied,
    allowlistMatches: result.matches,
    segmentSatisfiedBy: result.segmentSatisfiedBy,
  };
}
export function evaluateShellAllowlist(params) {
  const analysisFailure = () => ({
    analysisOk: false,
    allowlistSatisfied: false,
    allowlistMatches: [],
    segments: [],
    segmentSatisfiedBy: [],
  });
  const chainParts = isWindowsPlatform(params.platform) ? null : splitCommandChain(params.command);
  if (!chainParts) {
    const analysis = analyzeShellCommand({
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
      return analysisFailure();
    }
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist: params.allowlist,
      safeBins: params.safeBins,
      cwd: params.cwd,
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    return {
      analysisOk: true,
      allowlistSatisfied: evaluation.allowlistSatisfied,
      allowlistMatches: evaluation.allowlistMatches,
      segments: analysis.segments,
      segmentSatisfiedBy: evaluation.segmentSatisfiedBy,
    };
  }
  const allowlistMatches = [];
  const segments = [];
  const segmentSatisfiedBy = [];
  for (const part of chainParts) {
    const analysis = analyzeShellCommand({
      command: part,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
      return analysisFailure();
    }
    segments.push(...analysis.segments);
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist: params.allowlist,
      safeBins: params.safeBins,
      cwd: params.cwd,
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    allowlistMatches.push(...evaluation.allowlistMatches);
    segmentSatisfiedBy.push(...evaluation.segmentSatisfiedBy);
    if (!evaluation.allowlistSatisfied) {
      return {
        analysisOk: true,
        allowlistSatisfied: false,
        allowlistMatches,
        segments,
        segmentSatisfiedBy,
      };
    }
  }
  return {
    analysisOk: true,
    allowlistSatisfied: true,
    allowlistMatches,
    segments,
    segmentSatisfiedBy,
  };
}
