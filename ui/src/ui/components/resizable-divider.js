import { __decorateClass as __decorateClass_48d94f0e55ed4dd4 } from "bun:wrap";
import { LitElement, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

export class ResizableDivider extends LitElement {
  constructor() {
    super(...arguments);
    this.splitRatio = 0.6;
    this.minRatio = 0.4;
    this.maxRatio = 0.7;
  }
  isDragging = false;
  startX = 0;
  startRatio = 0;
  static styles = css`
    :host {
      width: 1px;
      cursor: col-resize;
      background: var(--border, #333);
      flex-shrink: 0;
      position: relative;
    }
    :host::before {
      content: "";
      position: absolute;
      top: 0;
      left: -6px;
      right: -6px;
      bottom: 0;
    }
  `;
  render() {
    return nothing;
  }
  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("mousedown", this.handleMouseDown);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
  }
  handleMouseDown = (e) => {
    this.isDragging = true;
    this.startX = e.clientX;
    this.startRatio = this.splitRatio;
    this.classList.add("dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mouseup", this.handleMouseUp);
    e.preventDefault();
  };
  handleMouseMove = (e) => {
    if (!this.isDragging) {
      return;
    }
    const container = this.parentElement;
    if (!container) {
      return;
    }
    const containerWidth = container.getBoundingClientRect().width;
    const deltaX = e.clientX - this.startX;
    const deltaRatio = deltaX / containerWidth;
    let newRatio = this.startRatio + deltaRatio;
    newRatio = Math.max(this.minRatio, Math.min(this.maxRatio, newRatio));
    this.dispatchEvent(
      new CustomEvent("resize", {
        detail: { splitRatio: newRatio },
        bubbles: true,
        composed: true,
      }),
    );
  };
  handleMouseUp = () => {
    this.isDragging = false;
    this.classList.remove("dragging");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mouseup", this.handleMouseUp);
  };
}
__decorateClass_48d94f0e55ed4dd4(
  [property({ type: Number })],
  ResizableDivider.prototype,
  "splitRatio",
  2,
);
__decorateClass_48d94f0e55ed4dd4(
  [property({ type: Number })],
  ResizableDivider.prototype,
  "minRatio",
  2,
);
__decorateClass_48d94f0e55ed4dd4(
  [property({ type: Number })],
  ResizableDivider.prototype,
  "maxRatio",
  2,
);
ResizableDivider = __decorateClass_48d94f0e55ed4dd4(
  [customElement("resizable-divider")],
  ResizableDivider,
);
