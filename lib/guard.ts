import { timingSafeEqual } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * API ini bisa mengubah scene dan memakai kuota AI Anda, jadi dibatasi:
 * - dari komputer sendiri: boleh, asal bukan permintaan lintas-origin (situs lain di browser);
 * - selain itu: wajib "Authorization: Bearer <FLUXION_API_TOKEN>".
 * Pemeriksaan Host bukan pengganti firewall, karena itu server di-bind ke 127.0.0.1.
 * Mengembalikan Response bila ditolak, atau null bila boleh lanjut.
 */
export function guard(request: Request, { localOnly = false } = {}): Response | null {
  const token = process.env.FLUXION_API_TOKEN;
  const auth = request.headers.get("authorization");
  if (!localOnly && token && auth) {
    const given = Buffer.from(auth);
    const expected = Buffer.from(`Bearer ${token}`);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return null;
  }

  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "");
  const origin = request.headers.get("origin");
  const sameOrigin = !origin || origin === `http://${host}` || origin === `https://${host}`;
  const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
  if (LOCAL_HOSTS.has(hostname) && sameOrigin && !crossSite) return null;

  return Response.json({ error: "Akses ditolak." }, { status: 403 });
}
