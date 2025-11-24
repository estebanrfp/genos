import { z } from "zod";

const ModelRoutingTiersSchema = z
  .object({
    simple: z.string().optional(),
    normal: z.string().optional(),
    complex: z.string().optional(),
  })
  .strict();

const ModelRoutingSchema = z
  .object({
    enabled: z.boolean().optional(),
    tiers: ModelRoutingTiersSchema.optional(),
  })
  .strict();

export const AgentModelSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
      routing: ModelRoutingSchema.optional(),
    })
    .strict(),
]);
