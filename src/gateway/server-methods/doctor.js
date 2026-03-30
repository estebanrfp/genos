/**
 * Doctor RPC handler — exposes autonomous health diagnostics via gateway.
 * @module gateway/server-methods/doctor
 */

import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { runDoctor } from "../../doctor/engine.js";

export const doctorHandlers = {
  "doctor.run": async ({ respond }) => {
    try {
      const config = loadConfig();
      const stateDir = resolveStateDir();
      const report = await runDoctor({ config, stateDir });
      respond(true, report, undefined);
    } catch (err) {
      respond(true, {
        ts: Date.now(),
        summary: { critical: 1, warnings: 0, info: 0, ok: 0, fixed: 0 },
        checks: [
          {
            name: "engine",
            label: "Doctor Engine",
            findings: [
              {
                id: "engine_error",
                severity: "critical",
                title: "Doctor engine failed",
                detail: err.message,
                fixed: false,
              },
            ],
          },
        ],
      });
    }
  },
};
