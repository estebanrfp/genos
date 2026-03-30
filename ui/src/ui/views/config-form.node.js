let isAnySchema = function (schema) {
    const keys = Object.keys(schema ?? {}).filter((key) => !META_KEYS.has(key));
    return keys.length === 0;
  },
  jsonValue = function (value) {
    if (value === undefined) {
      return "";
    }
    try {
      return JSON.stringify(value, null, 2) ?? "";
    } catch {
      return "";
    }
  },
  renderTextInput = function (params) {
    const { schema, value, path, hints, disabled, onPatch, inputType } = params;
    const showLabel = params.showLabel ?? true;
    const hint = hintForPath(path, hints);
    const label = hint?.label ?? schema.title ?? humanize(String(path.at(-1)));
    const help = hint?.help ?? schema.description;
    const isSensitive =
      (hint?.sensitive ?? false) && !/^\$\{[^}]*\}$/.test(String(value ?? "").trim());
    const placeholder =
      hint?.placeholder ??
      (isSensitive
        ? "\u2022\u2022\u2022\u2022"
        : schema.default !== undefined
          ? `Default: ${String(schema.default)}`
          : "");
    const displayValue = value ?? "";
    return html`
    <div class="cfg-field">
      ${showLabel ? html`<label class="cfg-field__label">${label}</label>` : nothing}
      ${help ? html`<div class="cfg-field__help">${help}</div>` : nothing}
      <div class="cfg-input-wrap">
        <input
          type=${isSensitive ? "password" : inputType}
          class="cfg-input"
          placeholder=${placeholder}
          .value=${displayValue == null ? "" : String(displayValue)}
          ?disabled=${disabled}
          @input=${(e) => {
            const raw = e.target.value;
            if (inputType === "number") {
              if (raw.trim() === "") {
                onPatch(path, undefined);
                return;
              }
              const parsed = Number(raw);
              onPatch(path, Number.isNaN(parsed) ? raw : parsed);
              return;
            }
            onPatch(path, raw);
          }}
          @change=${(e) => {
            if (inputType === "number") {
              return;
            }
            const raw = e.target.value;
            onPatch(path, raw.trim());
          }}
        />
        ${
          schema.default !== undefined
            ? html`
          <button
            type="button"
            class="cfg-input__reset"
            title="Reset to default"
            ?disabled=${disabled}
            @click=${() => onPatch(path, schema.default)}
          >↺</button>
        `
            : nothing
        }
      </div>
    </div>
  `;
  },
  renderNumberInput = function (params) {
    const { schema, value, path, hints, disabled, onPatch } = params;
    const showLabel = params.showLabel ?? true;
    const hint = hintForPath(path, hints);
    const label = hint?.label ?? schema.title ?? humanize(String(path.at(-1)));
    const help = hint?.help ?? schema.description;
    const displayValue = value ?? schema.default ?? "";
    const numValue = typeof displayValue === "number" ? displayValue : 0;
    return html`
    <div class="cfg-field">
      ${showLabel ? html`<label class="cfg-field__label">${label}</label>` : nothing}
      ${help ? html`<div class="cfg-field__help">${help}</div>` : nothing}
      <div class="cfg-number">
        <button
          type="button"
          class="cfg-number__btn"
          ?disabled=${disabled}
          @click=${() => onPatch(path, numValue - 1)}
        >−</button>
        <input
          type="number"
          class="cfg-number__input"
          .value=${displayValue == null ? "" : String(displayValue)}
          ?disabled=${disabled}
          @input=${(e) => {
            const raw = e.target.value;
            const parsed = raw === "" ? undefined : Number(raw);
            onPatch(path, parsed);
          }}
        />
        <button
          type="button"
          class="cfg-number__btn"
          ?disabled=${disabled}
          @click=${() => onPatch(path, numValue + 1)}
        >+</button>
      </div>
    </div>
  `;
  },
  renderSelect = function (params) {
    const { schema, value, path, hints, disabled, options, onPatch } = params;
    const showLabel = params.showLabel ?? true;
    const hint = hintForPath(path, hints);
    const label = hint?.label ?? schema.title ?? humanize(String(path.at(-1)));
    const help = hint?.help ?? schema.description;
    const resolvedValue = value ?? schema.default;
    const currentIndex = options.findIndex(
      (opt) => opt === resolvedValue || String(opt) === String(resolvedValue),
    );
    const unset = "__unset__";
    return html`
    <div class="cfg-field">
      ${showLabel ? html`<label class="cfg-field__label">${label}</label>` : nothing}
      ${help ? html`<div class="cfg-field__help">${help}</div>` : nothing}
      <select
        class="cfg-select"
        ?disabled=${disabled}
        .value=${currentIndex >= 0 ? String(currentIndex) : unset}
        @change=${(e) => {
          const val = e.target.value;
          onPatch(path, val === unset ? undefined : options[Number(val)]);
        }}
      >
        <option value=${unset}>Select...</option>
        ${options.map(
          (opt, idx) => html`
          <option value=${String(idx)}>${String(opt)}</option>
        `,
        )}
      </select>
    </div>
  `;
  },
  renderObject = function (params) {
    const { schema, value, path, hints, unsupported, disabled, onPatch } = params;
    const hint = hintForPath(path, hints);
    const label = hint?.label ?? schema.title ?? humanize(String(path.at(-1)));
    const help = hint?.help ?? schema.description;
    const fallback = value ?? schema.default;
    const obj =
      fallback && typeof fallback === "object" && !Array.isArray(fallback) ? fallback : {};
    const props = schema.properties ?? {};
    const entries = Object.entries(props);
    const sorted = entries.toSorted((a, b) => {
      const orderA = hintForPath([...path, a[0]], hints)?.order ?? 0;
      const orderB = hintForPath([...path, b[0]], hints)?.order ?? 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a[0].localeCompare(b[0]);
    });
    const reserved = new Set(Object.keys(props));
    const additional = schema.additionalProperties;
    const allowExtra = Boolean(additional) && typeof additional === "object" && !hint?.hideCatchall;
    const fields = html`
    ${sorted.map(([propKey, node]) =>
      renderNode({
        schema: node,
        value: obj[propKey],
        path: [...path, propKey],
        hints,
        unsupported,
        disabled,
        onPatch,
      }),
    )}
    ${
      allowExtra
        ? renderMapField({
            schema: additional,
            value: obj,
            path,
            hints,
            unsupported,
            disabled,
            reservedKeys: reserved,
            onPatch,
          })
        : nothing
    }
  `;
    // Pure map (no named properties): render map field inline — no details wrapper needed
    // topLevel: rendered as the root content of a subsection card — wrapper already provided
    const isMapOnly = entries.length === 0 && allowExtra;
    if (path.length === 1 || isMapOnly || params.topLevel) {
      return html`
      <div class="cfg-fields">
        ${fields}
      </div>
    `;
    }
    return html`
    <details class="cfg-object" open>
      <summary class="cfg-object__header">
        <span class="cfg-object__title">${label}</span>
        <span class="cfg-object__chevron">${icons.chevronDown}</span>
      </summary>
      ${help ? html`<div class="cfg-object__help">${help}</div>` : nothing}
      <div class="cfg-object__content">
        ${fields}
      </div>
    </details>
  `;
  },
  renderArray = function (params) {
    const { schema, value, path, hints, unsupported, disabled, onPatch } = params;
    const showLabel = params.showLabel ?? true;
    const hint = hintForPath(path, hints);
    const label = hint?.label ?? schema.title ?? humanize(String(path.at(-1)));
    const help = hint?.help ?? schema.description;
    const itemsSchema = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (!itemsSchema) {
      return html`
      <div class="cfg-field cfg-field--error">
        <div class="cfg-field__label">${label}</div>
        <div class="cfg-field__error">Unsupported array schema. Use Raw mode.</div>
      </div>
    `;
    }
    const arr = Array.isArray(value) ? value : Array.isArray(schema.default) ? schema.default : [];
    return html`
    <div class="cfg-array">
      <div class="cfg-array__header">
        ${showLabel ? html`<span class="cfg-array__label">${label}</span>` : nothing}
        <span class="cfg-array__count">${arr.length} item${arr.length !== 1 ? "s" : ""}</span>
        <button
          type="button"
          class="cfg-array__add"
          ?disabled=${disabled}
          @click=${() => {
            const next = [...arr, defaultValue(itemsSchema)];
            onPatch(path, next);
          }}
        >
          <span class="cfg-array__add-icon">${icons.plus}</span>
          Add
        </button>
      </div>
      ${help ? html`<div class="cfg-array__help">${help}</div>` : nothing}

      ${
        arr.length === 0
          ? html`
              <div class="cfg-array__empty">No items yet. Click "Add" to create one.</div>
            `
          : html`
        <div class="cfg-array__items">
          ${arr.map(
            (item, idx) => html`
            <div class="cfg-array__item">
              <div class="cfg-array__item-header">
                <span class="cfg-array__item-index">#${idx + 1}</span>
                <button
                  type="button"
                  class="cfg-array__item-remove"
                  title="Remove item"
                  ?disabled=${disabled}
                  @click=${() => {
                    const next = [...arr];
                    next.splice(idx, 1);
                    onPatch(path, next);
                  }}
                >
                  ${icons.trash}
                </button>
              </div>
              <div class="cfg-array__item-content">
                ${renderNode({
                  schema: itemsSchema,
                  value: item,
                  path: [...path, idx],
                  hints,
                  unsupported,
                  disabled,
                  showLabel: false,
                  onPatch,
                })}
              </div>
            </div>
          `,
          )}
        </div>
      `
      }
    </div>
  `;
  },
  renderMapField = function (params) {
    const { schema, value, path, hints, unsupported, disabled, reservedKeys, onPatch } = params;
    const anySchema = isAnySchema(schema);
    const entries = Object.entries(value ?? {}).filter(([key]) => !reservedKeys.has(key));
    const hint = hintForPath(path, hints);
    const addLabel = hint?.addLabel ?? "Add Entry";
    const emptyLabel = hint?.emptyLabel ?? "No entries yet.";
    const addEntry = () => {
      const next = { ...value };
      let index = 1;
      let key = `custom-${index}`;
      while (key in next) {
        index += 1;
        key = `custom-${index}`;
      }
      next[key] = anySchema ? {} : defaultValue(schema);
      onPatch(path, next);
    };
    return html`
    <div class="cfg-map">
      ${
        !hint?.addLabel
          ? html`
      <div class="cfg-map__topbar">
        <button type="button" class="cfg-map__add" ?disabled=${disabled} @click=${addEntry}>
          <span class="cfg-map__add-icon">${icons.plus}</span>
          ${addLabel}
        </button>
      </div>`
          : nothing
      }
      ${
        entries.length === 0
          ? html`<div class="cfg-map__empty">${emptyLabel}</div>`
          : html`
        <div class="cfg-map__items">
          ${entries.map(([key, entryValue]) => {
            const valuePath = [...path, key];
            const fallback = jsonValue(entryValue);
            return html`
              <div class="cfg-map__item">
                <div class="cfg-map__item-row">
                  <div class="cfg-map__item-key">
                    <input
                      type="text"
                      class="cfg-map__item-input"
                      placeholder="KEY"
                      .value=${key}
                      ?disabled=${disabled}
                      @change=${(e) => {
                        const nextKey = e.target.value.trim();
                        if (!nextKey || nextKey === key) {
                          return;
                        }
                        const next = { ...value };
                        if (nextKey in next) {
                          return;
                        }
                        next[nextKey] = next[key];
                        delete next[key];
                        onPatch(path, next);
                      }}
                    />
                  </div>
                  <div class="cfg-map__item-sep"></div>
                  <div class="cfg-map__item-value">
                    ${
                      anySchema
                        ? html`<textarea
                            class="cfg-map__item-input cfg-map__item-input--area"
                            placeholder="JSON value"
                            rows="2"
                            .value=${fallback}
                            ?disabled=${disabled}
                            @change=${(e) => {
                              const target = e.target;
                              const raw = target.value.trim();
                              if (!raw) {
                                onPatch(valuePath, undefined);
                                return;
                              }
                              try {
                                onPatch(valuePath, JSON.parse(raw));
                              } catch {
                                target.value = fallback;
                              }
                            }}
                          ></textarea>`
                        : renderNode({
                            schema,
                            value: entryValue,
                            path: valuePath,
                            hints,
                            unsupported,
                            disabled,
                            showLabel: false,
                            onPatch,
                          })
                    }
                  </div>
                </div>
                <button
                  type="button"
                  class="cfg-map__item-remove"
                  title="Remove entry"
                  ?disabled=${disabled}
                  @click=${() => {
                    const next = { ...value };
                    delete next[key];
                    onPatch(path, next);
                  }}
                >
                  ${icons.trash}
                </button>
              </div>
            `;
          })}
        </div>
      `
      }
    </div>
  `;
  };
import { html, nothing } from "lit";
import { defaultValue, hintForPath, humanize, pathKey, schemaType } from "./config-form.shared.js";
const META_KEYS = new Set(["title", "description", "default", "nullable"]);
const icons = {
  chevronDown: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `,
  plus: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  `,
  minus: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  `,
  trash: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  `,
  edit: html`
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    </svg>
  `,
};
export function renderNode(params) {
  const { schema, value, path, hints, unsupported, disabled, onPatch } = params;
  const showLabel = params.showLabel ?? true;
  const type = schemaType(schema);
  const hint = hintForPath(path, hints);
  const label = hint?.label ?? schema.title ?? humanize(String(path.at(-1)));
  const help = hint?.help ?? schema.description;
  const key = pathKey(path);
  if (unsupported.has(key)) {
    return nothing;
  }
  if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf ?? schema.oneOf ?? [];
    const nonNull = variants.filter(
      (v) => !(v.type === "null" || (Array.isArray(v.type) && v.type.includes("null"))),
    );
    if (nonNull.length === 1) {
      return renderNode({ ...params, schema: nonNull[0] });
    }
    const extractLiteral = (v) => {
      if (v.const !== undefined) {
        return v.const;
      }
      if (v.enum && v.enum.length === 1) {
        return v.enum[0];
      }
      return;
    };
    const literals = nonNull.map(extractLiteral);
    const allLiterals = literals.every((v) => v !== undefined);
    if (allLiterals && literals.length > 0 && literals.length <= 5) {
      const resolvedValue = value ?? schema.default;
      return html`
        <div class="cfg-field">
          ${showLabel ? html`<label class="cfg-field__label">${label}</label>` : nothing}
          ${help ? html`<div class="cfg-field__help">${help}</div>` : nothing}
          <div class="cfg-segmented">
            ${literals.map(
              (lit) => html`
              <button
                type="button"
                class="cfg-segmented__btn ${lit === resolvedValue || String(lit) === String(resolvedValue) ? "active" : ""}"
                ?disabled=${disabled}
                @click=${() => onPatch(path, lit)}
              >
                ${String(lit)}
              </button>
            `,
            )}
          </div>
        </div>
      `;
    }
    if (allLiterals && literals.length > 5) {
      return renderSelect({ ...params, options: literals, value: value ?? schema.default });
    }
    const primitiveTypes = new Set(nonNull.map((variant) => schemaType(variant)).filter(Boolean));
    const normalizedTypes = new Set(
      [...primitiveTypes].map((v) => (v === "integer" ? "number" : v)),
    );
    if ([...normalizedTypes].every((v) => ["string", "number", "boolean"].includes(v))) {
      const hasString = normalizedTypes.has("string");
      const hasNumber = normalizedTypes.has("number");
      const hasBoolean = normalizedTypes.has("boolean");
      if (hasBoolean && normalizedTypes.size === 1) {
        return renderNode({
          ...params,
          schema: { ...schema, type: "boolean", anyOf: undefined, oneOf: undefined },
        });
      }
      if (hasString || hasNumber) {
        return renderTextInput({
          ...params,
          inputType: hasNumber && !hasString ? "number" : "text",
        });
      }
    }
  }
  if (schema.enum) {
    const options = schema.enum;
    if (options.length <= 5) {
      const resolvedValue = value ?? schema.default;
      return html`
        <div class="cfg-field">
          ${showLabel ? html`<label class="cfg-field__label">${label}</label>` : nothing}
          ${help ? html`<div class="cfg-field__help">${help}</div>` : nothing}
          <div class="cfg-segmented">
            ${options.map(
              (opt) => html`
              <button
                type="button"
                class="cfg-segmented__btn ${opt === resolvedValue || String(opt) === String(resolvedValue) ? "active" : ""}"
                ?disabled=${disabled}
                @click=${() => onPatch(path, opt)}
              >
                ${String(opt)}
              </button>
            `,
            )}
          </div>
        </div>
      `;
    }
    return renderSelect({ ...params, options, value: value ?? schema.default });
  }
  if (type === "object") {
    return renderObject(params);
  }
  if (type === "array") {
    return renderArray(params);
  }
  if (type === "boolean") {
    const displayValue =
      typeof value === "boolean"
        ? value
        : typeof schema.default === "boolean"
          ? schema.default
          : false;
    return html`
      <label class="cfg-toggle-row ${disabled ? "disabled" : ""}">
        <div class="cfg-toggle-row__content">
          <span class="cfg-toggle-row__label">${label}</span>
          ${help ? html`<span class="cfg-toggle-row__help">${help}</span>` : nothing}
        </div>
        <div class="cfg-toggle">
          <input
            type="checkbox"
            .checked=${displayValue}
            ?disabled=${disabled}
            @change=${(e) => onPatch(path, e.target.checked)}
          />
          <span class="cfg-toggle__track"></span>
        </div>
      </label>
    `;
  }
  if (type === "number" || type === "integer") {
    return renderNumberInput(params);
  }
  if (type === "string") {
    return renderTextInput({ ...params, inputType: "text" });
  }
  return html`
    <div class="cfg-field cfg-field--error">
      <div class="cfg-field__label">${label}</div>
      <div class="cfg-field__error">Unsupported type: ${type}. Use Raw mode.</div>
    </div>
  `;
}
