// Tipe dan validasi percakapan. Aman dipakai di browser (tidak berisi akses file).
import { z } from "zod";

export const CONVERSATION_KINDS = ["scene", "pcb"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const MAX_CONVERSATIONS = 50;
export const MAX_TITLE = 80;

const kind = z.enum(CONVERSATION_KINDS);
const id = z.string().min(1).max(64);

export const conversationOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("new"), kind }),
  z.object({ op: z.literal("select"), kind, id }),
  z.object({ op: z.literal("rename"), kind, id, title: z.string().trim().min(1).max(MAX_TITLE) }),
  z.object({ op: z.literal("delete"), kind, id }),
]);

export type ConversationOperation = z.infer<typeof conversationOperationSchema>;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Teks ringkas untuk ditampilkan bila `text` berisi instruksi panjang. */
  label?: string;
  files?: string[];
  at: number;
};

export type ConversationView = {
  activeId: string;
  items: { id: string; title: string; updatedAt: number; count: number }[];
  /** Pesan milik percakapan aktif. */
  messages: ChatMessage[];
};
