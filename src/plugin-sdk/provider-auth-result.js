export function buildOauthProviderAuthResult(params) {
  const email = params.email ?? undefined;
  const profilePrefix = params.profilePrefix ?? params.providerId;
  const profileId = `${profilePrefix}:${email ?? "default"}`;
  const credential = {
    type: "oauth",
    provider: params.providerId,
    access: params.access,
    ...(params.refresh ? { refresh: params.refresh } : {}),
    ...(Number.isFinite(params.expires) ? { expires: params.expires } : {}),
    ...(email ? { email } : {}),
    ...params.credentialExtra,
  };
  return {
    profiles: [{ profileId, credential }],
    configPatch: params.configPatch ?? {
      agents: {
        defaults: {
          models: {
            [params.defaultModel]: {},
          },
        },
      },
    },
    defaultModel: params.defaultModel,
    notes: params.notes,
  };
}
