import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DocumentError } from "./document-store";
import { log } from "./log";

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Permintaan AI boleh membawa lampiran. */
export const MAX_AI_BODY_BYTES = 24 * 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Baca badan permintaan dengan batas ukuran, tanpa memercayai header content-length. */
export async function readText(request: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new HttpError(413, "Permintaan terlalu besar.");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Badan JSON yang sudah divalidasi. */
export async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = MAX_BODY_BYTES,
): Promise<z.output<S>> {
  // Menolak form lintas-situs: browser tidak bisa mengirim tipe ini tanpa preflight.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Gunakan content-type application/json.");
  }
  let data: unknown;
  try {
    data = JSON.parse(await readText(request, maxBytes));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "JSON tidak valid.");
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    // Hanya lokasi dan pesan, supaya nilai kiriman (mis. API key) tidak dipantulkan.
    const detail = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw new HttpError(400, `Permintaan tidak valid. ${detail}`);
  }
  return result.data;
}

/** Jalankan handler dan ubah semua kesalahan menjadi balasan JSON. */
export async function respond(action: () => unknown): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  try {
    const result = await action();
    return result instanceof Response ? result : Response.json(result, { headers });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status, headers });
    }
    if (error instanceof DocumentError) return Response.json({ error: error.message }, { status: 400, headers });
    const requestId = randomUUID().slice(0, 8);
    log("error", "request.failed", {
      requestId,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return Response.json(
      { error: `Terjadi kesalahan di server (kode ${requestId}). Lihat log server.` },
      { status: 500, headers },
    );
  }
}
