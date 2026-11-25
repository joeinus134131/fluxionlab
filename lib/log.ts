// Log satu baris JSON. Jangan pernah memasukkan API key, prompt, atau isi lampiran.
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  if (process.env.FLUXION_LOG === "silent") return;
  console[level](JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
}
