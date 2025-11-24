import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const AuthProfileEntrySchema = Type.Object(
  {
    profileId: NonEmptyString,
    provider: NonEmptyString,
    type: Type.Union([Type.Literal("api_key"), Type.Literal("oauth"), Type.Literal("token")]),
    maskedValue: Type.String(),
    email: Type.Optional(Type.String()),
    expires: Type.Optional(Type.Number()),
    disabled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const AuthProfilesListResultSchema = Type.Object(
  { profiles: Type.Array(AuthProfileEntrySchema) },
  { additionalProperties: false },
);

export const AuthProfilesSetParamsSchema = Type.Object(
  {
    provider: NonEmptyString,
    type: Type.Union([Type.Literal("api_key"), Type.Literal("token")]),
    value: NonEmptyString,
    profileId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AuthProfilesSetResultSchema = Type.Object(
  { ok: Type.Literal(true), profileId: NonEmptyString },
  { additionalProperties: false },
);

export const AuthProfilesDeleteParamsSchema = Type.Object(
  { profileId: NonEmptyString },
  { additionalProperties: false },
);

export const AuthProfilesDeleteResultSchema = Type.Object(
  { ok: Type.Literal(true), profileId: NonEmptyString },
  { additionalProperties: false },
);

export const AuthProfilesSetDisabledParamsSchema = Type.Object(
  {
    profileId: NonEmptyString,
    disabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AuthProfilesSetDisabledResultSchema = Type.Object(
  { ok: Type.Literal(true), profileId: NonEmptyString, disabled: Type.Boolean() },
  { additionalProperties: false },
);
