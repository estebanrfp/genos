import crypto from "node:crypto";
const pendingUploads = new Map();
const PENDING_UPLOAD_TTL_MS = 300000;
export function storePendingUpload(upload) {
  const id = crypto.randomUUID();
  const entry = {
    ...upload,
    id,
    createdAt: Date.now(),
  };
  pendingUploads.set(id, entry);
  setTimeout(() => {
    pendingUploads.delete(id);
  }, PENDING_UPLOAD_TTL_MS);
  return id;
}
export function getPendingUpload(id) {
  if (!id) {
    return;
  }
  const entry = pendingUploads.get(id);
  if (!entry) {
    return;
  }
  if (Date.now() - entry.createdAt > PENDING_UPLOAD_TTL_MS) {
    pendingUploads.delete(id);
    return;
  }
  return entry;
}
export function removePendingUpload(id) {
  if (id) {
    pendingUploads.delete(id);
  }
}
export function getPendingUploadCount() {
  return pendingUploads.size;
}
export function clearPendingUploads() {
  pendingUploads.clear();
}
