// Lampiran prompt (gambar, PDF, teks). Dipakai browser dan server, jadi tanpa akses file.
import { z } from "zod";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_CHARS = 5_000_000; // base64
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 100_000;
const MAX_TOTAL_CHARS = 20_000_000;

const name = z.string().min(1).max(200);
const base64 = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), name, mediaType: z.enum(IMAGE_TYPES), data: base64(MAX_IMAGE_CHARS) }),
  z.object({ kind: z.literal("pdf"), name, data: base64(Math.ceil(MAX_PDF_BYTES / 3) * 4) }),
  z.object({ kind: z.literal("text"), name, data: z.string().min(1).max(MAX_TEXT_CHARS) }),
]);

export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS)
  .refine((list) => fitsTotal(list), "Total lampiran terlalu besar.")
  .default([]);

export const fitsTotal = (list: { data: string }[]) =>
  list.reduce((total, item) => total + item.data.length, 0) <= MAX_TOTAL_CHARS;

export type Attachment = z.infer<typeof attachmentSchema>;

/** Dipakai bila pengguna hanya mengirim lampiran tanpa tulisan. */
export const DEFAULT_ATTACHMENT_PROMPT = "Buat desain berdasarkan lampiran.";
