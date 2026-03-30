const UNIT_MULTIPLIERS = {
  b: 1,
  kb: 1024,
  k: 1024,
  mb: 1048576,
  m: 1048576,
  gb: 1073741824,
  g: 1073741824,
  tb: 1099511627776,
  t: 1099511627776,
};
export function parseByteSize(raw, opts) {
  const trimmed = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!trimmed) {
    throw new Error("invalid byte size (empty)");
  }
  const m = /^(\d+(?:\.\d+)?)([a-z]+)?$/.exec(trimmed);
  if (!m) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  const unit = (m[2] ?? opts?.defaultUnit ?? "b").toLowerCase();
  const multiplier = UNIT_MULTIPLIERS[unit];
  if (!multiplier) {
    throw new Error(`invalid byte size unit: ${raw}`);
  }
  const bytes = Math.round(value * multiplier);
  if (!Number.isFinite(bytes)) {
    throw new Error(`invalid byte size: ${raw}`);
  }
  return bytes;
}
