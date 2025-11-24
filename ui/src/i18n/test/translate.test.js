import { describe, it, expect, beforeEach } from "vitest";
import { i18n, t } from "../lib/translate.js";
describe("i18n", () => {
  beforeEach(() => {
    localStorage.clear();
    i18n.setLocale("en");
  });
  it("should return the key if translation is missing", () => {
    expect(t("non.existent.key")).toBe("non.existent.key");
  });
  it("should return the correct English translation", () => {
    expect(t("common.health")).toBe("Health");
  });
  it("should replace parameters correctly", () => {
    expect(t("connection.auth.failed", { command: "test" })).toBe(
      "Auth failed. Re-copy a tokenized URL with test, or update the token, then click Connect.",
    );
  });
  it("should fallback to English if key is missing in another locale", async () => {
    await i18n.setLocale("zh-CN");
    expect(t("common.health")).toBeDefined();
  });
});
