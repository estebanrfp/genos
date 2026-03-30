export function parseGeminiAuth(apiKey) {
  if (apiKey.startsWith("{")) {
    try {
      const parsed = JSON.parse(apiKey);
      if (typeof parsed.token === "string" && parsed.token) {
        return {
          headers: {
            Authorization: `Bearer ${parsed.token}`,
            "Content-Type": "application/json",
          },
        };
      }
    } catch {}
  }
  return {
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
  };
}
