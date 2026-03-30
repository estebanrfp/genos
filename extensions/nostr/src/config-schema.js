import { MarkdownConfigSchema, buildChannelConfigSchema } from "genosos/plugin-sdk";
import { z } from "zod";
const allowFromEntry = z.union([z.string(), z.number()]);
const safeUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use https:// protocol" },
  );
export const NostrProfileSchema = z.object({
  name: z.string().max(256).optional(),
  displayName: z.string().max(256).optional(),
  about: z.string().max(2000).optional(),
  picture: safeUrlSchema.optional(),
  banner: safeUrlSchema.optional(),
  website: safeUrlSchema.optional(),
  nip05: z.string().optional(),
  lud16: z.string().optional(),
});
export const NostrConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  markdown: MarkdownConfigSchema,
  privateKey: z.string().optional(),
  relays: z.array(z.string()).optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(allowFromEntry).optional(),
  profile: NostrProfileSchema.optional(),
});
export const nostrChannelConfigSchema = buildChannelConfigSchema(NostrConfigSchema);
