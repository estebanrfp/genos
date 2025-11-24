let resolveAccountKey = function (accountId) {
  return accountId ?? DEFAULT_ACCOUNT_KEY;
};
const gatewayRegistry = new Map();
const DEFAULT_ACCOUNT_KEY = "\0__default__";
export function registerGateway(accountId, gateway) {
  gatewayRegistry.set(resolveAccountKey(accountId), gateway);
}
export function unregisterGateway(accountId) {
  gatewayRegistry.delete(resolveAccountKey(accountId));
}
export function getGateway(accountId) {
  return gatewayRegistry.get(resolveAccountKey(accountId));
}
export function clearGateways() {
  gatewayRegistry.clear();
}
