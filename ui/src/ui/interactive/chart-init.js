// GenosOS — Post-render chart initializer (Frappe Charts)
import { Chart } from "frappe-charts";

const DARK_COLORS = ["#c792ea", "#82aaff", "#c3e88d", "#ffcb6b", "#f78c6c", "#89ddff", "#ff5370"];
const LIGHT_COLORS = ["#6f42c1", "#0366d6", "#22863a", "#b08800", "#e36209", "#005cc5", "#d73a49"];

/** @returns {boolean} */
const isDark = () => document.documentElement.dataset.theme !== "light";

/**
 * Scan for uninitialized .ix-chart placeholders and mount Frappe Charts.
 * Safe to call repeatedly — already-initialized elements are skipped.
 */
export const initPendingCharts = () => {
  const placeholders = document.querySelectorAll(".ix-chart:not([data-initialized])");
  if (placeholders.length === 0) {
    return;
  }

  for (const el of placeholders) {
    el.dataset.initialized = "1";
    try {
      const config = JSON.parse(el.dataset.chart);
      const colors = config.colors ?? (isDark() ? DARK_COLORS : LIGHT_COLORS);

      new Chart(el, {
        type: config.chartType,
        data: config.data,
        height: config.height ?? 220,
        colors,
        animate: true,
        truncateLegends: true,
        axisOptions: config.axisOptions ?? { xIsSeries: config.chartType === "line" },
        barOptions: config.barOptions ?? { spaceRatio: 0.4 },
        lineOptions: config.lineOptions ?? { regionFill: 1, hideDots: false },
        tooltipOptions: config.tooltipOptions ?? {},
        isNavigable: config.isNavigable ?? false,
        valuesOverPoints: config.valuesOverPoints ?? false,
      });
    } catch (err) {
      el.textContent = `Chart error: ${err.message}`;
    }
  }
};
