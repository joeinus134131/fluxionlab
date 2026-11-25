// Tipe dan validasi pengaturan AI. Aman dipakai di browser (tidak berisi akses file).
import { z } from "zod";

const apiKey = z.string().trim().max(500).regex(/^[\x21-\x7e]*$/, "API key tidak boleh berisi spasi.");

export const connectionInputSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(60),
  baseUrl: z
    .url({ protocol: /^https?$/ })
    .max(300)
    .transform((url) => url.replace(/\/+$/, "")),
  model: z.string().trim().min(1).max(150),
  // Kosong berarti: pertahankan kunci yang sudah tersimpan.
  apiKey: apiKey.optional(),
});

export const settingsOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setClaudeKey"), apiKey }),
  z.object({ op: z.literal("saveConnection"), connection: connectionInputSchema }),
  z.object({ op: z.literal("deleteConnection"), id: z.string() }),
]);

export type SettingsOperation = z.infer<typeof settingsOperationSchema>;

/** Yang boleh dilihat browser: tanpa isi kunci. */
export type PublicSettings = {
  claude: { hasKey: boolean; hint: string };
  connections: { id: string; name: string; baseUrl: string; model: string; hasKey: boolean; hint: string }[];
};
