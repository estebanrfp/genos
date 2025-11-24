import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import {
  ZAI_CN_BASE_URL,
  ZAI_CODING_CN_BASE_URL,
  ZAI_CODING_GLOBAL_BASE_URL,
  ZAI_GLOBAL_BASE_URL,
} from "./onboard-auth.models.js";
async function probeZaiChatCompletions(params) {
  try {
    const res = await fetchWithTimeout(
      `${params.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${params.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: params.modelId,
          stream: false,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      },
      params.timeoutMs,
      params.fetchFn,
    );
    if (res.ok) {
      return { ok: true };
    }
    let errorCode;
    let errorMessage;
    try {
      const json = await res.json();
      const code = json?.error?.code;
      const msg = json?.error?.message ?? json?.msg ?? json?.message;
      if (typeof code === "string") {
        errorCode = code;
      } else if (typeof code === "number") {
        errorCode = String(code);
      }
      if (typeof msg === "string") {
        errorMessage = msg;
      }
    } catch {}
    return { ok: false, status: res.status, errorCode, errorMessage };
  } catch {
    return { ok: false };
  }
}
export async function detectZaiEndpoint(params) {
  if (process.env.VITEST && !params.fetchFn) {
    return null;
  }
  const timeoutMs = params.timeoutMs ?? 5000;
  const glm5 = [
    { endpoint: "global", baseUrl: ZAI_GLOBAL_BASE_URL },
    { endpoint: "cn", baseUrl: ZAI_CN_BASE_URL },
  ];
  for (const candidate of glm5) {
    const result = await probeZaiChatCompletions({
      baseUrl: candidate.baseUrl,
      apiKey: params.apiKey,
      modelId: "glm-5",
      timeoutMs,
      fetchFn: params.fetchFn,
    });
    if (result.ok) {
      return {
        endpoint: candidate.endpoint,
        baseUrl: candidate.baseUrl,
        modelId: "glm-5",
        note: `Verified GLM-5 on ${candidate.endpoint} endpoint.`,
      };
    }
  }
  const coding = [
    { endpoint: "coding-global", baseUrl: ZAI_CODING_GLOBAL_BASE_URL },
    { endpoint: "coding-cn", baseUrl: ZAI_CODING_CN_BASE_URL },
  ];
  for (const candidate of coding) {
    const result = await probeZaiChatCompletions({
      baseUrl: candidate.baseUrl,
      apiKey: params.apiKey,
      modelId: "glm-4.7",
      timeoutMs,
      fetchFn: params.fetchFn,
    });
    if (result.ok) {
      return {
        endpoint: candidate.endpoint,
        baseUrl: candidate.baseUrl,
        modelId: "glm-4.7",
        note: "Coding Plan endpoint detected; GLM-5 is not available there. Defaulting to GLM-4.7.",
      };
    }
  }
  return null;
}
