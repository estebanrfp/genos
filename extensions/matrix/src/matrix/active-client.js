import { normalizeAccountId } from "genosos/plugin-sdk/account-id";
const activeClients = new Map();
export function setActiveMatrixClient(client, accountId) {
  const key = normalizeAccountId(accountId);
  if (client) {
    activeClients.set(key, client);
  } else {
    activeClients.delete(key);
  }
}
export function getActiveMatrixClient(accountId) {
  const key = normalizeAccountId(accountId);
  return activeClients.get(key) ?? null;
}
export function getAnyActiveMatrixClient() {
  const first = activeClients.values().next();
  return first.done ? null : first.value;
}
export function clearAllActiveMatrixClients() {
  activeClients.clear();
}
