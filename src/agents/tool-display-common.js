let asRecord = function (args) {
    return args && typeof args === "object" ? args : undefined;
  },
  stripOuterQuotes = function (value) {
    if (!value) {
      return value;
    }
    const trimmed = value.trim();
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  },
  splitShellWords = function (input, maxWords = 48) {
    if (!input) {
      return [];
    }
    const words = [];
    let current = "";
    let quote;
    let escaped = false;
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = undefined;
        } else {
          current += char;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (!current) {
          continue;
        }
        words.push(current);
        if (words.length >= maxWords) {
          return words;
        }
        current = "";
        continue;
      }
      current += char;
    }
    if (current) {
      words.push(current);
    }
    return words;
  },
  binaryName = function (token) {
    if (!token) {
      return;
    }
    const cleaned = stripOuterQuotes(token) ?? token;
    const segment = cleaned.split(/[/]/).at(-1) ?? cleaned;
    return segment.trim().toLowerCase();
  },
  optionValue = function (words, names) {
    const lookup = new Set(names);
    for (let i = 0; i < words.length; i += 1) {
      const token = words[i];
      if (!token) {
        continue;
      }
      if (lookup.has(token)) {
        const value = words[i + 1];
        if (value && !value.startsWith("-")) {
          return value;
        }
        continue;
      }
      for (const name of names) {
        if (name.startsWith("--") && token.startsWith(`${name}=`)) {
          return token.slice(name.length + 1);
        }
      }
    }
    return;
  },
  positionalArgs = function (words, from = 1, optionsWithValue = []) {
    const args = [];
    const takesValue = new Set(optionsWithValue);
    for (let i = from; i < words.length; i += 1) {
      const token = words[i];
      if (!token) {
        continue;
      }
      if (token === "--") {
        for (let j = i + 1; j < words.length; j += 1) {
          const candidate = words[j];
          if (candidate) {
            args.push(candidate);
          }
        }
        break;
      }
      if (token.startsWith("--")) {
        if (token.includes("=")) {
          continue;
        }
        if (takesValue.has(token)) {
          i += 1;
        }
        continue;
      }
      if (token.startsWith("-")) {
        if (takesValue.has(token)) {
          i += 1;
        }
        continue;
      }
      args.push(token);
    }
    return args;
  },
  firstPositional = function (words, from = 1, optionsWithValue = []) {
    return positionalArgs(words, from, optionsWithValue)[0];
  },
  trimLeadingEnv = function (words) {
    if (words.length === 0) {
      return words;
    }
    let index = 0;
    if (binaryName(words[0]) === "env") {
      index = 1;
      while (index < words.length) {
        const token = words[index];
        if (!token) {
          break;
        }
        if (token.startsWith("-")) {
          index += 1;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
          index += 1;
          continue;
        }
        break;
      }
      return words.slice(index);
    }
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
      index += 1;
    }
    return words.slice(index);
  },
  unwrapShellWrapper = function (command) {
    const words = splitShellWords(command, 10);
    if (words.length < 3) {
      return command;
    }
    const bin = binaryName(words[0]);
    if (!(bin === "bash" || bin === "sh" || bin === "zsh" || bin === "fish")) {
      return command;
    }
    const flagIndex = words.findIndex(
      (token, index) => index > 0 && (token === "-c" || token === "-lc" || token === "-ic"),
    );
    if (flagIndex === -1) {
      return command;
    }
    const inner = words
      .slice(flagIndex + 1)
      .join(" ")
      .trim();
    return inner ? (stripOuterQuotes(inner) ?? command) : command;
  },
  scanTopLevelChars = function (command, visit) {
    let quote;
    let escaped = false;
    for (let i = 0; i < command.length; i += 1) {
      const char = command[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = undefined;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (visit(char, i) === false) {
        return;
      }
    }
  },
  firstTopLevelStage = function (command) {
    let splitIndex = -1;
    scanTopLevelChars(command, (char, index) => {
      if (char === ";") {
        splitIndex = index;
        return false;
      }
      if ((char === "&" || char === "|") && command[index + 1] === char) {
        splitIndex = index;
        return false;
      }
      return true;
    });
    return splitIndex >= 0 ? command.slice(0, splitIndex) : command;
  },
  splitTopLevelPipes = function (command) {
    const parts = [];
    let start = 0;
    scanTopLevelChars(command, (char, index) => {
      if (char === "|" && command[index - 1] !== "|" && command[index + 1] !== "|") {
        parts.push(command.slice(start, index));
        start = index + 1;
      }
      return true;
    });
    parts.push(command.slice(start));
    return parts.map((part) => part.trim()).filter((part) => part.length > 0);
  },
  stripShellPreamble = function (command) {
    let rest = command.trim();
    for (let i = 0; i < 4; i += 1) {
      const andIndex = rest.indexOf("&&");
      const semicolonIndex = rest.indexOf(";");
      const newlineIndex = rest.indexOf("\n");
      const candidates = [
        { index: andIndex, length: 2 },
        { index: semicolonIndex, length: 1 },
        { index: newlineIndex, length: 1 },
      ]
        .filter((candidate) => candidate.index >= 0)
        .toSorted((a, b) => a.index - b.index);
      const first = candidates[0];
      const head = (first ? rest.slice(0, first.index) : rest).trim();
      const isPreamble =
        head.startsWith("set ") || head.startsWith("export ") || head.startsWith("unset ");
      if (!isPreamble) {
        break;
      }
      rest = first ? rest.slice(first.index + first.length).trimStart() : "";
      if (!rest) {
        break;
      }
    }
    return rest.trim();
  },
  summarizeKnownExec = function (words) {
    if (words.length === 0) {
      return "run command";
    }
    const bin = binaryName(words[0]) ?? "command";
    if (bin === "git") {
      const globalWithValue = new Set([
        "-C",
        "-c",
        "--git-dir",
        "--work-tree",
        "--namespace",
        "--config-env",
      ]);
      const gitCwd = optionValue(words, ["-C"]);
      let sub;
      for (let i = 1; i < words.length; i += 1) {
        const token = words[i];
        if (!token) {
          continue;
        }
        if (token === "--") {
          sub = firstPositional(words, i + 1);
          break;
        }
        if (token.startsWith("--")) {
          if (token.includes("=")) {
            continue;
          }
          if (globalWithValue.has(token)) {
            i += 1;
          }
          continue;
        }
        if (token.startsWith("-")) {
          if (globalWithValue.has(token)) {
            i += 1;
          }
          continue;
        }
        sub = token;
        break;
      }
      const map = {
        status: "check git status",
        diff: "check git diff",
        log: "view git history",
        show: "show git object",
        branch: "list git branches",
        checkout: "switch git branch",
        switch: "switch git branch",
        commit: "create git commit",
        pull: "pull git changes",
        push: "push git changes",
        fetch: "fetch git changes",
        merge: "merge git changes",
        rebase: "rebase git branch",
        add: "stage git changes",
        restore: "restore git files",
        reset: "reset git state",
        stash: "stash git changes",
      };
      if (sub && map[sub]) {
        return map[sub];
      }
      if (!sub || sub.startsWith("/") || sub.startsWith("~") || sub.includes("/")) {
        return gitCwd ? `run git command in ${gitCwd}` : "run git command";
      }
      return `run git ${sub}`;
    }
    if (bin === "grep" || bin === "rg" || bin === "ripgrep") {
      const positional = positionalArgs(words, 1, [
        "-e",
        "--regexp",
        "-f",
        "--file",
        "-m",
        "--max-count",
        "-A",
        "--after-context",
        "-B",
        "--before-context",
        "-C",
        "--context",
      ]);
      const pattern = optionValue(words, ["-e", "--regexp"]) ?? positional[0];
      const target = positional.length > 1 ? positional.at(-1) : undefined;
      if (pattern) {
        return target ? `search "${pattern}" in ${target}` : `search "${pattern}"`;
      }
      return "search text";
    }
    if (bin === "find") {
      const path = words[1] && !words[1].startsWith("-") ? words[1] : ".";
      const name = optionValue(words, ["-name", "-iname"]);
      return name ? `find files named "${name}" in ${path}` : `find files in ${path}`;
    }
    if (bin === "ls") {
      const target = firstPositional(words, 1);
      return target ? `list files in ${target}` : "list files";
    }
    if (bin === "head" || bin === "tail") {
      const lines =
        optionValue(words, ["-n", "--lines"]) ??
        words
          .slice(1)
          .find((token) => /^-\d+$/.test(token))
          ?.slice(1);
      const positional = positionalArgs(words, 1, ["-n", "--lines"]);
      let target = positional.at(-1);
      if (target && /^\d+$/.test(target) && positional.length === 1) {
        target = undefined;
      }
      const side = bin === "head" ? "first" : "last";
      const unit = lines === "1" ? "line" : "lines";
      if (lines && target) {
        return `show ${side} ${lines} ${unit} of ${target}`;
      }
      if (lines) {
        return `show ${side} ${lines} ${unit}`;
      }
      if (target) {
        return `show ${target}`;
      }
      return `show ${bin} output`;
    }
    if (bin === "cat") {
      const target = firstPositional(words, 1);
      return target ? `show ${target}` : "show output";
    }
    if (bin === "sed") {
      const expression = optionValue(words, ["-e", "--expression"]);
      const positional = positionalArgs(words, 1, ["-e", "--expression", "-f", "--file"]);
      const script = expression ?? positional[0];
      const target = expression ? positional[0] : positional[1];
      if (script) {
        const compact = (stripOuterQuotes(script) ?? script).replace(/\s+/g, "");
        const range = compact.match(/^([0-9]+),([0-9]+)p$/);
        if (range) {
          return target
            ? `print lines ${range[1]}-${range[2]} from ${target}`
            : `print lines ${range[1]}-${range[2]}`;
        }
        const single = compact.match(/^([0-9]+)p$/);
        if (single) {
          return target ? `print line ${single[1]} from ${target}` : `print line ${single[1]}`;
        }
      }
      return target ? `run sed on ${target}` : "run sed transform";
    }
    if (bin === "printf" || bin === "echo") {
      return "print text";
    }
    if (bin === "cp" || bin === "mv") {
      const positional = positionalArgs(words, 1, ["-t", "--target-directory", "-S", "--suffix"]);
      const src = positional[0];
      const dst = positional[1];
      const action = bin === "cp" ? "copy" : "move";
      if (src && dst) {
        return `${action} ${src} to ${dst}`;
      }
      if (src) {
        return `${action} ${src}`;
      }
      return `${action} files`;
    }
    if (bin === "rm") {
      const target = firstPositional(words, 1);
      return target ? `remove ${target}` : "remove files";
    }
    if (bin === "mkdir") {
      const target = firstPositional(words, 1);
      return target ? `create folder ${target}` : "create folder";
    }
    if (bin === "touch") {
      const target = firstPositional(words, 1);
      return target ? `create file ${target}` : "create file";
    }
    if (bin === "curl" || bin === "wget") {
      const url = words.find((token) => /^https?:\/\//i.test(token));
      return url ? `fetch ${url}` : "fetch url";
    }
    if (bin === "npm" || bin === "pnpm" || bin === "yarn" || bin === "bun") {
      const positional = positionalArgs(words, 1, ["--prefix", "-C", "--cwd", "--config"]);
      const sub = positional[0] ?? "command";
      const map = {
        install: "install dependencies",
        test: "run tests",
        build: "run build",
        start: "start app",
        lint: "run lint",
        run: positional[1] ? `run ${positional[1]}` : "run script",
      };
      return map[sub] ?? `run ${bin} ${sub}`;
    }
    if (
      bin === "node" ||
      bin === "python" ||
      bin === "python3" ||
      bin === "ruby" ||
      bin === "php"
    ) {
      const heredoc = words.slice(1).find((token) => token.startsWith("<<"));
      if (heredoc) {
        return `run ${bin} inline script (heredoc)`;
      }
      const inline =
        bin === "node"
          ? optionValue(words, ["-e", "--eval"])
          : bin === "python" || bin === "python3"
            ? optionValue(words, ["-c"])
            : undefined;
      if (inline !== undefined) {
        return `run ${bin} inline script`;
      }
      const nodeOptsWithValue = ["-e", "--eval", "-m"];
      const otherOptsWithValue = ["-c", "-e", "--eval", "-m"];
      const script = firstPositional(
        words,
        1,
        bin === "node" ? nodeOptsWithValue : otherOptsWithValue,
      );
      if (!script) {
        return `run ${bin}`;
      }
      if (bin === "node") {
        const mode =
          words.includes("--check") || words.includes("-c")
            ? "check js syntax for"
            : "run node script";
        return `${mode} ${script}`;
      }
      return `run ${bin} ${script}`;
    }
    if (bin === "genosos") {
      const sub = firstPositional(words, 1);
      return sub ? `run genosos ${sub}` : "run genosos";
    }
    const arg = firstPositional(words, 1);
    if (!arg || arg.length > 48) {
      return `run ${bin}`;
    }
    return /^[A-Za-z0-9._/-]+$/.test(arg) ? `run ${bin} ${arg}` : `run ${bin}`;
  },
  summarizeExecCommand = function (command) {
    const cleaned = stripShellPreamble(command);
    const stage = firstTopLevelStage(cleaned).trim();
    if (!stage) {
      return cleaned ? summarizeKnownExec(trimLeadingEnv(splitShellWords(cleaned))) : undefined;
    }
    const pipeline = splitTopLevelPipes(stage);
    if (pipeline.length > 1) {
      const first = summarizeKnownExec(trimLeadingEnv(splitShellWords(pipeline[0])));
      const last = summarizeKnownExec(
        trimLeadingEnv(splitShellWords(pipeline[pipeline.length - 1])),
      );
      const extra = pipeline.length > 2 ? ` (+${pipeline.length - 2} steps)` : "";
      return `${first} -> ${last}${extra}`;
    }
    return summarizeKnownExec(trimLeadingEnv(splitShellWords(stage)));
  };
export function normalizeToolName(name) {
  return (name ?? "tool").trim();
}
export function defaultTitle(name) {
  const cleaned = name.replace(/_/g, " ").trim();
  if (!cleaned) {
    return "Tool";
  }
  return cleaned
    .split(/\s+/)
    .map((part) =>
      part.length <= 2 && part.toUpperCase() === part
        ? part
        : `${part.at(0)?.toUpperCase() ?? ""}${part.slice(1)}`,
    )
    .join(" ");
}
export function normalizeVerb(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }
  return trimmed.replace(/_/g, " ");
}
export function coerceDisplayValue(value, opts = {}) {
  const maxStringChars = opts.maxStringChars ?? 160;
  const maxArrayEntries = opts.maxArrayEntries ?? 3;
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
    if (!firstLine) {
      return;
    }
    if (firstLine.length > maxStringChars) {
      return `${firstLine.slice(0, Math.max(0, maxStringChars - 3))}\u2026`;
    }
    return firstLine;
  }
  if (typeof value === "boolean") {
    if (!value && !opts.includeFalse) {
      return;
    }
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return opts.includeNonFinite ? String(value) : undefined;
    }
    if (value === 0 && !opts.includeZero) {
      return;
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    const values = value
      .map((item) => coerceDisplayValue(item, opts))
      .filter((item) => Boolean(item));
    if (values.length === 0) {
      return;
    }
    const preview = values.slice(0, maxArrayEntries).join(", ");
    return values.length > maxArrayEntries ? `${preview}\u2026` : preview;
  }
  return;
}
export function lookupValueByPath(args, path) {
  if (!args || typeof args !== "object") {
    return;
  }
  let current = args;
  for (const segment of path.split(".")) {
    if (!segment) {
      return;
    }
    if (!current || typeof current !== "object") {
      return;
    }
    const record = current;
    current = record[segment];
  }
  return current;
}
export function formatDetailKey(raw, overrides = {}) {
  const segments = raw.split(".").filter(Boolean);
  const last = segments.at(-1) ?? raw;
  const override = overrides[last];
  if (override) {
    return override;
  }
  const cleaned = last.replace(/_/g, " ").replace(/-/g, " ");
  const spaced = cleaned.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.trim().toLowerCase() || last.toLowerCase();
}
export function resolvePathArg(args) {
  const record = asRecord(args);
  if (!record) {
    return;
  }
  for (const candidate of [record.path, record.file_path, record.filePath]) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return;
}
export function resolveReadDetail(args) {
  const record = asRecord(args);
  if (!record) {
    return;
  }
  const path = resolvePathArg(record);
  if (!path) {
    return;
  }
  const offsetRaw =
    typeof record.offset === "number" && Number.isFinite(record.offset)
      ? Math.floor(record.offset)
      : undefined;
  const limitRaw =
    typeof record.limit === "number" && Number.isFinite(record.limit)
      ? Math.floor(record.limit)
      : undefined;
  const offset = offsetRaw !== undefined ? Math.max(1, offsetRaw) : undefined;
  const limit = limitRaw !== undefined ? Math.max(1, limitRaw) : undefined;
  if (offset !== undefined && limit !== undefined) {
    const unit = limit === 1 ? "line" : "lines";
    return `${unit} ${offset}-${offset + limit - 1} from ${path}`;
  }
  if (offset !== undefined) {
    return `from line ${offset} in ${path}`;
  }
  if (limit !== undefined) {
    const unit = limit === 1 ? "line" : "lines";
    return `first ${limit} ${unit} of ${path}`;
  }
  return `from ${path}`;
}
export function resolveWriteDetail(toolKey, args) {
  const record = asRecord(args);
  if (!record) {
    return;
  }
  const path =
    resolvePathArg(record) ?? (typeof record.url === "string" ? record.url.trim() : undefined);
  if (!path) {
    return;
  }
  if (toolKey === "attach") {
    return `from ${path}`;
  }
  const destinationPrefix = toolKey === "edit" ? "in" : "to";
  const content =
    typeof record.content === "string"
      ? record.content
      : typeof record.newText === "string"
        ? record.newText
        : typeof record.new_string === "string"
          ? record.new_string
          : undefined;
  if (content && content.length > 0) {
    return `${destinationPrefix} ${path} (${content.length} chars)`;
  }
  return `${destinationPrefix} ${path}`;
}
export function resolveWebSearchDetail(args) {
  const record = asRecord(args);
  if (!record) {
    return;
  }
  const query = typeof record.query === "string" ? record.query.trim() : undefined;
  const count =
    typeof record.count === "number" && Number.isFinite(record.count) && record.count > 0
      ? Math.floor(record.count)
      : undefined;
  if (!query) {
    return;
  }
  return count !== undefined ? `for "${query}" (top ${count})` : `for "${query}"`;
}
export function resolveWebFetchDetail(args) {
  const record = asRecord(args);
  if (!record) {
    return;
  }
  const url = typeof record.url === "string" ? record.url.trim() : undefined;
  if (!url) {
    return;
  }
  const mode = typeof record.extractMode === "string" ? record.extractMode.trim() : undefined;
  const maxChars =
    typeof record.maxChars === "number" && Number.isFinite(record.maxChars) && record.maxChars > 0
      ? Math.floor(record.maxChars)
      : undefined;
  const suffix = [
    mode ? `mode ${mode}` : undefined,
    maxChars !== undefined ? `max ${maxChars} chars` : undefined,
  ]
    .filter((value) => Boolean(value))
    .join(", ");
  return suffix ? `from ${url} (${suffix})` : `from ${url}`;
}
export function resolveExecDetail(args) {
  const record = asRecord(args);
  if (!record) {
    return;
  }
  const raw = typeof record.command === "string" ? record.command.trim() : undefined;
  if (!raw) {
    return;
  }
  const unwrapped = unwrapShellWrapper(raw);
  const summary = summarizeExecCommand(unwrapped) ?? summarizeExecCommand(raw) ?? "run command";
  const cwdRaw =
    typeof record.workdir === "string"
      ? record.workdir
      : typeof record.cwd === "string"
        ? record.cwd
        : undefined;
  const cwd = cwdRaw?.trim();
  return cwd ? `${summary} (in ${cwd})` : summary;
}
export function resolveActionSpec(spec, action) {
  if (!spec || !action) {
    return;
  }
  return spec.actions?.[action] ?? undefined;
}
export function resolveDetailFromKeys(args, keys, opts) {
  if (opts.mode === "first") {
    for (const key of keys) {
      const value = lookupValueByPath(args, key);
      const display = coerceDisplayValue(value, opts.coerce);
      if (display) {
        return display;
      }
    }
    return;
  }
  const entries = [];
  for (const key of keys) {
    const value = lookupValueByPath(args, key);
    const display = coerceDisplayValue(value, opts.coerce);
    if (!display) {
      continue;
    }
    entries.push({ label: opts.formatKey ? opts.formatKey(key) : key, value: display });
  }
  if (entries.length === 0) {
    return;
  }
  if (entries.length === 1) {
    return entries[0].value;
  }
  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const token = `${entry.label}:${entry.value}`;
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(entry);
  }
  if (unique.length === 0) {
    return;
  }
  return unique
    .slice(0, opts.maxEntries ?? 8)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join(" \xB7 ");
}
