import { MarkdownConfigSchema } from "genosos/plugin-sdk";
import { z } from "zod";
const TwitchRoleSchema = z.enum(["moderator", "owner", "vip", "subscriber", "all"]);
const TwitchAccountSchema = z.object({
  username: z.string(),
  accessToken: z.string(),
  clientId: z.string().optional(),
  channel: z.string().min(1),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.string()).optional(),
  allowedRoles: z.array(TwitchRoleSchema).optional(),
  requireMention: z.boolean().optional(),
  responsePrefix: z.string().optional(),
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().nullable().optional(),
  obtainmentTimestamp: z.number().optional(),
});
const TwitchConfigBaseSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  markdown: MarkdownConfigSchema.optional(),
});
const SimplifiedSchema = z.intersection(TwitchConfigBaseSchema, TwitchAccountSchema);
const MultiAccountSchema = z.intersection(
  TwitchConfigBaseSchema,
  z
    .object({
      accounts: z.record(z.string(), TwitchAccountSchema),
    })
    .refine((val) => Object.keys(val.accounts || {}).length > 0, {
      message: "accounts must contain at least one entry",
    }),
);
export const TwitchConfigSchema = z.union([SimplifiedSchema, MultiAccountSchema]);
