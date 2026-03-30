import { i18n } from "./translate.js";

export class I18nController {
  host;
  unsubscribe;
  constructor(host) {
    this.host = host;
    this.host.addController(this);
  }
  hostConnected() {
    this.unsubscribe = i18n.subscribe(() => {
      this.host.requestUpdate();
    });
  }
  hostDisconnected() {
    this.unsubscribe?.();
  }
}
