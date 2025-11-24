let isProfileConfigCompatible = function (params) {
    const profileConfig = params.cfg?.auth?.profiles?.[params.profileId];
    if (profileConfig && profileConfig.provider !== params.provider) {
      return false;
    }
    if (profileConfig && profileConfig.mode !== params.mode) {
      if (
        !(
          params.allowOAuthTokenCompatibility &&
          profileConfig.mode === "oauth" &&
          params.mode === "token"
        )
      ) {
        return false;
      }
    }
    return true;
  },
  buildOAuthApiKey = function (provider, credentials) {
    const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
    return needsProjectId
      ? JSON.stringify({
          token: credentials.access,
          projectId: credentials.projectId,
        })
      : credentials.access;
  },
  buildApiKeyProfileResult = function (params) {
    return {
      apiKey: params.apiKey,
      provider: params.provider,
      email: params.email,
    };
  },
  buildOAuthProfileResult = function (params) {
    return buildApiKeyProfileResult({
      apiKey: buildOAuthApiKey(params.provider, params.credentials),
      provider: params.provider,
      email: params.email,
    });
  },
  isExpiredCredential = function (expires) {
    return (
      typeof expires === "number" &&
      Number.isFinite(expires) &&
      expires > 0 &&
      Date.now() >= expires
    );
  };
import { getOAuthApiKey, getOAuthProviders } from "@mariozechner/pi-ai";
import { withFileLock } from "../../infra/file-lock.js";
import { refreshQwenPortalCredentials } from "../../providers/qwen-portal-oauth.js";
import { refreshChutesTokens } from "../chutes-oauth.js";
import { AUTH_STORE_LOCK_OPTIONS, log } from "./constants.js";
import { formatAuthDoctorHint } from "./doctor.js";
import { ensureAuthStoreFile, resolveAuthStorePath } from "./paths.js";
import { suggestOAuthProfileIdForLegacyDefault } from "./repair.js";
import { ensureAuthProfileStore, saveAuthProfileStore } from "./store.js";
const OAUTH_PROVIDER_IDS = new Set(getOAuthProviders().map((provider) => provider.id));
const isOAuthProvider = (provider) => OAUTH_PROVIDER_IDS.has(provider);
const resolveOAuthProvider = (provider) => (isOAuthProvider(provider) ? provider : null);
async function refreshOAuthTokenWithLock(params) {
  const authPath = resolveAuthStorePath(params.agentDir);
  ensureAuthStoreFile(authPath);
  return await withFileLock(authPath, AUTH_STORE_LOCK_OPTIONS, async () => {
    const store = ensureAuthProfileStore(params.agentDir);
    const cred = store.profiles[params.profileId];
    if (!cred || cred.type !== "oauth") {
      return null;
    }
    if (Date.now() < cred.expires) {
      return {
        apiKey: buildOAuthApiKey(cred.provider, cred),
        newCredentials: cred,
      };
    }
    const oauthCreds = {
      [cred.provider]: cred,
    };
    const result =
      String(cred.provider) === "chutes"
        ? await (async () => {
            const newCredentials = await refreshChutesTokens({
              credential: cred,
            });
            return { apiKey: newCredentials.access, newCredentials };
          })()
        : String(cred.provider) === "qwen-portal"
          ? await (async () => {
              const newCredentials = await refreshQwenPortalCredentials(cred);
              return { apiKey: newCredentials.access, newCredentials };
            })()
          : await (async () => {
              const oauthProvider = resolveOAuthProvider(cred.provider);
              if (!oauthProvider) {
                return null;
              }
              return await getOAuthApiKey(oauthProvider, oauthCreds);
            })();
    if (!result) {
      return null;
    }
    store.profiles[params.profileId] = {
      ...cred,
      ...result.newCredentials,
      type: "oauth",
    };
    saveAuthProfileStore(store, params.agentDir);
    return result;
  });
}
async function tryResolveOAuthProfile(params) {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred || cred.type !== "oauth") {
    return null;
  }
  if (
    !isProfileConfigCompatible({
      cfg,
      profileId,
      provider: cred.provider,
      mode: cred.type,
    })
  ) {
    return null;
  }
  if (Date.now() < cred.expires) {
    return buildOAuthProfileResult({
      provider: cred.provider,
      credentials: cred,
      email: cred.email,
    });
  }
  const refreshed = await refreshOAuthTokenWithLock({
    profileId,
    agentDir: params.agentDir,
  });
  if (!refreshed) {
    return null;
  }
  return buildApiKeyProfileResult({
    apiKey: refreshed.apiKey,
    provider: cred.provider,
    email: cred.email,
  });
}
export async function resolveApiKeyForProfile(params) {
  const { cfg, store, profileId } = params;
  const cred = store.profiles[profileId];
  if (!cred) {
    return null;
  }
  if (cred.disabled === true) {
    return null;
  }
  if (
    !isProfileConfigCompatible({
      cfg,
      profileId,
      provider: cred.provider,
      mode: cred.type,
      allowOAuthTokenCompatibility: true,
    })
  ) {
    return null;
  }
  if (cred.type === "api_key") {
    const key = cred.key?.trim();
    if (!key) {
      return null;
    }
    return buildApiKeyProfileResult({ apiKey: key, provider: cred.provider, email: cred.email });
  }
  if (cred.type === "token") {
    const token = cred.token?.trim();
    if (!token) {
      return null;
    }
    if (isExpiredCredential(cred.expires)) {
      return null;
    }
    return buildApiKeyProfileResult({ apiKey: token, provider: cred.provider, email: cred.email });
  }
  if (Date.now() < cred.expires) {
    return buildOAuthProfileResult({
      provider: cred.provider,
      credentials: cred,
      email: cred.email,
    });
  }
  try {
    const result = await refreshOAuthTokenWithLock({
      profileId,
      agentDir: params.agentDir,
    });
    if (!result) {
      return null;
    }
    return buildApiKeyProfileResult({
      apiKey: result.apiKey,
      provider: cred.provider,
      email: cred.email,
    });
  } catch (error) {
    const refreshedStore = ensureAuthProfileStore(params.agentDir);
    const refreshed = refreshedStore.profiles[profileId];
    if (refreshed?.type === "oauth" && Date.now() < refreshed.expires) {
      return buildOAuthProfileResult({
        provider: refreshed.provider,
        credentials: refreshed,
        email: refreshed.email ?? cred.email,
      });
    }
    const fallbackProfileId = suggestOAuthProfileIdForLegacyDefault({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      legacyProfileId: profileId,
    });
    if (fallbackProfileId && fallbackProfileId !== profileId) {
      try {
        const fallbackResolved = await tryResolveOAuthProfile({
          cfg,
          store: refreshedStore,
          profileId: fallbackProfileId,
          agentDir: params.agentDir,
        });
        if (fallbackResolved) {
          return fallbackResolved;
        }
      } catch {}
    }
    if (params.agentDir) {
      try {
        const mainStore = ensureAuthProfileStore(undefined);
        const mainCred = mainStore.profiles[profileId];
        if (mainCred?.type === "oauth" && Date.now() < mainCred.expires) {
          refreshedStore.profiles[profileId] = { ...mainCred };
          saveAuthProfileStore(refreshedStore, params.agentDir);
          log.info("inherited fresh OAuth credentials from main agent", {
            profileId,
            agentDir: params.agentDir,
            expires: new Date(mainCred.expires).toISOString(),
          });
          return buildOAuthProfileResult({
            provider: mainCred.provider,
            credentials: mainCred,
            email: mainCred.email,
          });
        }
      } catch {}
    }
    const message = error instanceof Error ? error.message : String(error);
    const hint = formatAuthDoctorHint({
      cfg,
      store: refreshedStore,
      provider: cred.provider,
      profileId,
    });
    throw new Error(
      `OAuth token refresh failed for ${cred.provider}: ${message}. Please try again or re-authenticate.` +
        (hint ? `\n\n${hint}` : ""),
      { cause: error },
    );
  }
}
