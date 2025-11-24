import { normalizeWebhookPath } from "./webhook-path.js";
export function registerWebhookTarget(targetsByPath, target) {
  const key = normalizeWebhookPath(target.path);
  const normalizedTarget = { ...target, path: key };
  const existing = targetsByPath.get(key) ?? [];
  targetsByPath.set(key, [...existing, normalizedTarget]);
  const unregister = () => {
    const updated = (targetsByPath.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) {
      targetsByPath.set(key, updated);
      return;
    }
    targetsByPath.delete(key);
  };
  return { target: normalizedTarget, unregister };
}
export function resolveWebhookTargets(req, targetsByPath) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalizeWebhookPath(url.pathname);
  const targets = targetsByPath.get(path);
  if (!targets || targets.length === 0) {
    return null;
  }
  return { path, targets };
}
export function rejectNonPostWebhookRequest(req, res) {
  if (req.method === "POST") {
    return false;
  }
  res.statusCode = 405;
  res.setHeader("Allow", "POST");
  res.end("Method Not Allowed");
  return true;
}
