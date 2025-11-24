import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const CopilotLoginParamsSchema = Type.Object(
  { profileId: Type.Optional(Type.String()) },
  { additionalProperties: false },
);

export const CopilotLoginResultSchema = Type.Object(
  {
    sessionId: NonEmptyString,
    userCode: NonEmptyString,
    verificationUri: NonEmptyString,
    expiresIn: Type.Number(),
  },
  { additionalProperties: false },
);

export const CopilotLoginStatusParamsSchema = Type.Object(
  { sessionId: NonEmptyString },
  { additionalProperties: false },
);

export const CopilotLoginStatusResultSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("pending"),
      Type.Literal("authorized"),
      Type.Literal("error"),
      Type.Literal("cancelled"),
    ]),
    profileId: Type.Optional(NonEmptyString),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const CopilotLoginCancelParamsSchema = Type.Object(
  { sessionId: NonEmptyString },
  { additionalProperties: false },
);
