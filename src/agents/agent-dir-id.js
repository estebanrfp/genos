import { randomBytes } from "node:crypto";
/** Generate 8-char hex token for opaque agent directory names. */
export const generateAgentDirId = () => randomBytes(4).toString("hex");
