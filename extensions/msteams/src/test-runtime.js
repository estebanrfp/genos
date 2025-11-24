import os from "node:os";
import path from "node:path";
export const msteamsRuntimeStub = {
  state: {
    resolveStateDir: (env = process.env, homedir) => {
      const override = env.GENOS_STATE_DIR?.trim() || env.GENOS_STATE_DIR?.trim();
      if (override) {
        return override;
      }
      const resolvedHome = homedir ? homedir() : os.homedir();
      return path.join(resolvedHome, ".genos");
    },
  },
};
