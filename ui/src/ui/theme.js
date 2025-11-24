export function getSystemTheme() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function resolveTheme(mode) {
  if (mode === "system") {
    return getSystemTheme();
  }
  return mode;
}
