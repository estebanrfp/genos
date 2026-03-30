import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

// --- providers.login ---

export const ProvidersLoginParamsSchema = Type.Object(
  {
    provider: NonEmptyString,
    apiKey: Type.Optional(Type.String()),
    token: Type.Optional(Type.String()),
    profileId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// --- providers.login.status ---

export const ProvidersLoginStatusParamsSchema = Type.Object(
  { sessionId: NonEmptyString },
  { additionalProperties: false },
);

// --- providers.login.cancel ---

export const ProvidersLoginCancelParamsSchema = Type.Object(
  { sessionId: NonEmptyString },
  { additionalProperties: false },
);
