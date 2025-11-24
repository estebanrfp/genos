export async function fetchRemoteEmbeddingVectors(params) {
  const res = await fetch(params.url, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify(params.body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${params.errorPrefix}: ${res.status} ${text}`);
  }
  const payload = await res.json();
  const data = payload.data ?? [];
  return data.map((entry) => entry.embedding ?? []);
}
