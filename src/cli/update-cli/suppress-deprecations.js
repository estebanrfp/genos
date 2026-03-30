export function suppressDeprecations() {
  try {
    process.noDeprecation = true;
  } catch {}
  process.env.NODE_NO_WARNINGS = "1";
}
