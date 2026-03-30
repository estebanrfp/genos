import { en } from "../locales/en.js";
export const SUPPORTED_LOCALES = ["en", "zh-CN", "zh-TW", "pt-BR"];
export function isSupportedLocale(value) {
  return value !== null && value !== undefined && SUPPORTED_LOCALES.includes(value);
}

class I18nManager {
  locale = "en";
  translations = { en };
  subscribers = new Set();
  constructor() {
    this.loadLocale();
  }
  loadLocale() {
    const saved = localStorage.getItem("genosos.i18n.locale");
    if (isSupportedLocale(saved)) {
      this.locale = saved;
    } else {
      const navLang = navigator.language;
      if (navLang.startsWith("zh")) {
        this.locale = navLang === "zh-TW" || navLang === "zh-HK" ? "zh-TW" : "zh-CN";
      } else if (navLang.startsWith("pt")) {
        this.locale = "pt-BR";
      } else {
        this.locale = "en";
      }
    }
  }
  getLocale() {
    return this.locale;
  }
  async setLocale(locale) {
    if (this.locale === locale) {
      return;
    }
    if (!this.translations[locale]) {
      try {
        let module;
        if (locale === "zh-CN") {
          module = await import("../locales/zh-CN.js");
        } else if (locale === "zh-TW") {
          module = await import("../locales/zh-TW.js");
        } else if (locale === "pt-BR") {
          module = await import("../locales/pt-BR.js");
        } else {
          return;
        }
        this.translations[locale] = module[locale.replace("-", "_")];
      } catch (e) {
        console.error(`Failed to load locale: ${locale}`, e);
        return;
      }
    }
    this.locale = locale;
    localStorage.setItem("genosos.i18n.locale", locale);
    this.notify();
  }
  registerTranslation(locale, map) {
    this.translations[locale] = map;
  }
  subscribe(sub) {
    this.subscribers.add(sub);
    return () => this.subscribers.delete(sub);
  }
  notify() {
    this.subscribers.forEach((sub) => sub(this.locale));
  }
  t(key, params) {
    const keys = key.split(".");
    let value = this.translations[this.locale] || this.translations["en"];
    for (const k of keys) {
      if (value && typeof value === "object") {
        value = value[k];
      } else {
        value = undefined;
        break;
      }
    }
    if (value === undefined && this.locale !== "en") {
      value = this.translations["en"];
      for (const k of keys) {
        if (value && typeof value === "object") {
          value = value[k];
        } else {
          value = undefined;
          break;
        }
      }
    }
    if (typeof value !== "string") {
      return key;
    }
    if (params) {
      return value.replace(/\{(\w+)\}/g, (_, k) => params[k] || `{${k}}`);
    }
    return value;
  }
}
export const i18n = new I18nManager();
export const t = (key, params) => i18n.t(key, params);
