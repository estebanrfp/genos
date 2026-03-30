import { describe, expect, it } from "vitest";
import { convertBootstrapToToon } from "./md-to-toon.js";

describe("convertBootstrapToToon", () => {
  describe("key-value bullet blocks", () => {
    it("converts consecutive kv bullets to TOON pairs", () => {
      const input = ["- **Name:** Nyx", "- **Language:** Español (España)", "- **Emoji:** 🌙"].join(
        "\n",
      );
      expect(convertBootstrapToToon(input)).toBe(
        ["Name: Nyx", "Language: Español (España)", "Emoji: 🌙"].join("\n"),
      );
    });

    it("converts kv bullets separated by blank lines", () => {
      const input = ["- **Name:** Nyx", "", "- **Born:** 14 de febrero"].join("\n");
      expect(convertBootstrapToToon(input)).toBe(["Name: Nyx", "Born: 14 de febrero"].join("\n"));
    });

    it("strips inline markdown from kv values", () => {
      const input = "- **Command:** `curl -s http://localhost`";
      expect(convertBootstrapToToon(input)).toBe("Command: curl -s http://localhost");
    });
  });

  describe("bold-key paragraph blocks", () => {
    it("converts bold-key with period separator", () => {
      const input = [
        "**Directo y sin rodeos.** Nada de relleno.",
        "",
        "**Sincero siempre.** Si algo no funciona, lo digo.",
      ].join("\n");
      expect(convertBootstrapToToon(input)).toBe(
        [
          "Directo y sin rodeos: Nada de relleno.",
          "Sincero siempre: Si algo no funciona, lo digo.",
        ].join("\n"),
      );
    });

    it("converts bold-key with colon separator", () => {
      const input = "**Firma:** estebanrfp - Full Stack Developer";
      expect(convertBootstrapToToon(input)).toBe("Firma: estebanrfp - Full Stack Developer");
    });

    it("strips inline markdown from bold-key values", () => {
      const input = "**Tip:** Batch similar **periodic** checks.";
      expect(convertBootstrapToToon(input)).toBe("Tip: Batch similar periodic checks.");
    });
  });

  describe("headers", () => {
    it("converts headers to compact format", () => {
      const input = "## Principios\nContent here";
      expect(convertBootstrapToToon(input)).toBe("Principios:\nContent here");
    });

    it("strips bold from headers", () => {
      const input = "## **Important** Section";
      expect(convertBootstrapToToon(input)).toBe("Important Section:");
    });

    it("strips emoji from headers", () => {
      const input = "# SOUL.md - Quién soy";
      expect(convertBootstrapToToon(input)).toBe("Quién soy:");
    });

    it("handles filename-dash-subtitle pattern in headers", () => {
      const input = "# USER.md - Sobre Esteban";
      expect(convertBootstrapToToon(input)).toBe("Sobre Esteban:");
    });

    it("keeps header without filename pattern", () => {
      const input = "## Contexto";
      expect(convertBootstrapToToon(input)).toBe("Contexto:");
    });

    it("strips emoji-prefixed subheaders", () => {
      const input = "### 🧠 MEMORY.md - Your Long-Term Memory";
      expect(convertBootstrapToToon(input)).toBe("Your Long-Term Memory:");
    });
  });

  describe("bullets", () => {
    it("converts simple bullets to compact format", () => {
      const input = ["- Programador", "- Toca el piano"].join("\n");
      expect(convertBootstrapToToon(input)).toBe(["· Programador", "· Toca el piano"].join("\n"));
    });

    it("converts nested bullets with preserved indentation", () => {
      const input = "  - Sub item";
      expect(convertBootstrapToToon(input)).toBe("  · Sub item");
    });

    it("handles mixed indent levels", () => {
      const input = ["- Main item", "  - Sub item", "- Another main"].join("\n");
      expect(convertBootstrapToToon(input)).toBe(
        ["· Main item", "  · Sub item", "· Another main"].join("\n"),
      );
    });

    it("strips bold from bullet content", () => {
      const input = "- **REGLA: No hacer eso.**";
      expect(convertBootstrapToToon(input)).toBe("· REGLA: No hacer eso.");
    });

    it("strips inline code from bullet content", () => {
      const input = "- `trash` > `rm` (recoverable beats gone forever)";
      expect(convertBootstrapToToon(input)).toBe("· trash > rm (recoverable beats gone forever)");
    });
  });

  describe("inline markdown stripping", () => {
    it("strips bold from prose", () => {
      const input = "Soy **Nyx** — el alter ego.";
      expect(convertBootstrapToToon(input)).toBe("Soy Nyx — el alter ego.");
    });

    it("strips italic from prose", () => {
      const input = "Skills define *how* tools work.";
      expect(convertBootstrapToToon(input)).toBe("Skills define how tools work.");
    });

    it("strips inline code backticks", () => {
      const input = "Use `trash` instead of `rm`.";
      expect(convertBootstrapToToon(input)).toBe("Use trash instead of rm.");
    });

    it("converts markdown links to text (url)", () => {
      const input = "See [docs](https://example.com) for more.";
      expect(convertBootstrapToToon(input)).toBe("See docs (https://example.com) for more.");
    });

    it("strips multiple inline formats in one line", () => {
      const input = "Run **`bun test`** for *all* checks.";
      expect(convertBootstrapToToon(input)).toBe("Run bun test for all checks.");
    });

    it("preserves raw URLs without markdown link syntax", () => {
      const input = "Repo: https://github.com/estebanrfp/gdb";
      expect(convertBootstrapToToon(input)).toBe(input);
    });

    it("preserves emoji in content lines", () => {
      const input = "Soy Nyx 🌙 — el alter ego digital.";
      expect(convertBootstrapToToon(input)).toBe(input);
    });
  });

  describe("code blocks", () => {
    it("strips fences but preserves inner content", () => {
      const input = ["## Config", "```json", '{ "key": "value" }', "```", "Some text"].join("\n");
      const result = convertBootstrapToToon(input);
      expect(result).toContain('{ "key": "value" }');
      expect(result).not.toContain("```");
    });

    it("preserves code block content without further conversion", () => {
      const input = ["```markdown", "### WhatsApp Contacts", "- Esteban: +34660777328", "```"].join(
        "\n",
      );
      const result = convertBootstrapToToon(input);
      // Inner markdown NOT converted — it's code content
      expect(result).toContain("### WhatsApp Contacts");
      expect(result).toContain("- Esteban: +34660777328");
      expect(result).not.toContain("```");
    });

    it("strips language identifier from fences", () => {
      const input = "```javascript\nconsole.log('hi');\n```";
      expect(convertBootstrapToToon(input)).toBe("console.log('hi');");
    });
  });

  describe("prose and passthrough", () => {
    it("strips bold from prose paragraphs", () => {
      const input = "Siempre en **español de España**. Natural.";
      expect(convertBootstrapToToon(input)).toBe("Siempre en español de España. Natural.");
    });

    it("preserves numbered lists", () => {
      const input = ["1. Read SOUL.md", "2. Check context"].join("\n");
      expect(convertBootstrapToToon(input)).toBe(input);
    });

    it("strips standalone bold labels", () => {
      const input = "**Safe to do freely:**";
      expect(convertBootstrapToToon(input)).toBe("Safe to do freely:");
    });
  });

  describe("horizontal rules", () => {
    it("strips horizontal rules", () => {
      const input = "Above\n\n---\n\nBelow";
      expect(convertBootstrapToToon(input)).toBe("Above\n\nBelow");
    });
  });

  describe("mixed content — real files", () => {
    it("handles a real IDENTITY.md-like file", () => {
      const input = [
        "# IDENTITY.md",
        "- **Name:** Nyx",
        "- **Creature:** Alter ego digital",
        "- **Vibe:** Directo, sin rodeos",
        "- **Language:** Español (España)",
      ].join("\n");
      expect(convertBootstrapToToon(input)).toBe(
        [
          "IDENTITY.md:",
          "Name: Nyx",
          "Creature: Alter ego digital",
          "Vibe: Directo, sin rodeos",
          "Language: Español (España)",
        ].join("\n"),
      );
    });

    it("handles a real SOUL.md-like file", () => {
      const input = [
        "# SOUL.md - Quién soy",
        "Soy **Nyx** 🌙 — el alter ego digital de Esteban.",
        "",
        "## Principios",
        "**Directo y sin rodeos.** Nada de relleno.",
        "",
        "**Sincero siempre.** Si algo no funciona, lo digo.",
        "",
        "## Idioma",
        "Siempre en **español de España**.",
      ].join("\n");
      const result = convertBootstrapToToon(input);
      expect(result).toContain("Quién soy:");
      expect(result).toContain("Soy Nyx 🌙 — el alter ego digital de Esteban.");
      expect(result).toContain("Principios:");
      expect(result).toContain("Directo y sin rodeos: Nada de relleno.");
      expect(result).toContain("Sincero siempre: Si algo no funciona, lo digo.");
      expect(result).toContain("Idioma:");
      expect(result).toContain("Siempre en español de España.");
      expect(result).not.toContain("**");
    });

    it("handles AGENTS.md-like section with bullets and code block", () => {
      const input = [
        "## Heartbeats",
        "**Track your checks** in `memory/heartbeat-state.json`:",
        "",
        "```json",
        "{",
        '  "lastChecks": {',
        '    "email": 1703275200',
        "  }",
        "}",
        "```",
        "",
        "**When to reach out:**",
        "",
        "- Important email arrived",
        "- Calendar event coming up",
      ].join("\n");
      const result = convertBootstrapToToon(input);
      expect(result).toContain("Heartbeats:");
      expect(result).toContain("Track your checks in memory/heartbeat-state.json:");
      expect(result).toContain('"lastChecks"');
      expect(result).not.toContain("```");
      expect(result).toContain("When to reach out:");
      expect(result).toContain("· Important email arrived");
      expect(result).not.toContain("**");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for null input", () => {
      expect(convertBootstrapToToon(null)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(convertBootstrapToToon(undefined)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(convertBootstrapToToon("")).toBe("");
    });

    it("returns empty string for non-string input", () => {
      expect(convertBootstrapToToon(42)).toBe("");
    });

    it("collapses excessive blank lines", () => {
      const input = "Line 1\n\n\n\n\nLine 2";
      expect(convertBootstrapToToon(input)).toBe("Line 1\n\nLine 2");
    });

    it("trims trailing whitespace from result", () => {
      const input = "Content\n\n\n";
      expect(convertBootstrapToToon(input)).toBe("Content");
    });
  });
});
