import { afterEach, beforeEach } from "vitest";

export function mountApp(pathname) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("genosos-app");
  app.connect = () => {};
  document.body.append(app);
  return app;
}
export function registerAppMountHooks() {
  beforeEach(() => {
    window.__GENOS_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    window.__GENOS_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    document.body.innerHTML = "";
  });
}
