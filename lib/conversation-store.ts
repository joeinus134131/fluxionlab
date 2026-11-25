import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { fitsTotal, MAX_ATTACHMENTS, attachmentSchema, type Attachment } from "./attachments";
import {
  MAX_CONVERSATIONS,
  MAX_TITLE,
  type ChatMessage,
  type ConversationKind,
  type ConversationOperation,
  type ConversationView,
} from "./conversations";
import { DocumentError } from "./document-store";
import { writeFileAtomic } from "./files";
import { log } from "./log";
import { boardDocument } from "./pcb-store";
import { sceneDocument } from "./scene-store";

// Tiap percakapan punya riwayat chat dan desainnya sendiri. Desain percakapan aktif adalah
// dokumen yang sedang dibuka (dipakai juga oleh REST dan MCP); desain percakapan lain disimpan di sini.

const MAX_MESSAGES = 200;
/** Banyaknya pesan lama yang dikirim ke model. */
const HISTORY_MESSAGES = 20;

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  label: z.string().optional(),
  files: z.array(z.string()).optional(),
  at: z.number(),
});

const conversationSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  /** true setelah judul diisi otomatis atau oleh pengguna. */
  titled: z.boolean(),
  updatedAt: z.number(),
  messages: z.array(messageSchema),
  design: z.unknown().optional(),
});

const fileSchema = z.object({ activeId: z.string(), conversations: z.array(conversationSchema).min(1) });

type Conversation = z.infer<typeof conversationSchema>;
type Data = z.infer<typeof fileSchema>;

const documents = { scene: sceneDocument, pcb: boardDocument };

const dataDirectory = () => path.join(process.cwd(), ".data");
const indexFile = (kind: ConversationKind) => path.join(dataDirectory(), `conversations-${kind}.json`);
const attachmentDirectory = (conversationId: string) => path.join(dataDirectory(), "attachments", conversationId);
const attachmentFile = (conversationId: string, messageId: string) =>
  path.join(attachmentDirectory(conversationId), `${messageId}.json`);

const newId = () => randomUUID().slice(0, 12);

function blank(data: Data | null): Conversation {
  const used = new Set(data?.conversations.map((c) => c.title));
  let number = 1;
  while (used.has(`Percakapan ${number}`)) number += 1;
  return { id: newId(), title: `Percakapan ${number}`, titled: false, updatedAt: Date.now(), messages: [] };
}

function save(kind: ConversationKind, data: Data) {
  writeFileAtomic(indexFile(kind), JSON.stringify(data));
}

function load(kind: ConversationKind): Data {
  const file = indexFile(kind);
  if (existsSync(file)) {
    try {
      const data = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      if (data.conversations.some((c) => c.id === data.activeId)) return data;
      return { ...data, activeId: data.conversations[0].id };
    } catch (error) {
      // Simpan file rusak agar tidak tertimpa diam-diam.
      const moved = `${file}.rusak-${Date.now()}`;
      renameSync(file, moved);
      log("error", "store.corrupt", { file: moved, reason: error instanceof Error ? error.name : "unknown" });
    }
  }
  // Pemakaian pertama: desain yang sedang dibuka menjadi milik percakapan pertama.
  const first = blank(null);
  const data = { activeId: first.id, conversations: [first] };
  save(kind, data);
  return data;
}

const find = (data: Data, id: string) => {
  const conversation = data.conversations.find((c) => c.id === id);
  if (!conversation) throw new DocumentError("Percakapan tidak ditemukan.");
  return conversation;
};

export const activeConversationId = (kind: ConversationKind) => load(kind).activeId;

export function conversationView(kind: ConversationKind): ConversationView {
  const data = load(kind);
  return {
    activeId: data.activeId,
    items: data.conversations
      .map(({ id, title, updatedAt, messages }) => ({ id, title, updatedAt, count: messages.length }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    messages: find(data, data.activeId).messages,
  };
}

/** Pindah ke `target`: simpan desain yang sedang dibuka, lalu buka desain milik target. */
function activate(kind: ConversationKind, data: Data, target: Conversation, keepCurrent: boolean) {
  const document = documents[kind];
  const design = document.parse(target.design);
  if (keepCurrent) {
    find(data, data.activeId).design = document.get();
    // Disimpan dulu, supaya desain lama aman bila langkah berikutnya gagal.
    save(kind, data);
  }
  document.reset(design);
  delete target.design;
  data.activeId = target.id;
}

export function applyConversationOperation(operation: ConversationOperation) {
  const { kind } = operation;
  const data = load(kind);
  const document = documents[kind];

  if (operation.op === "rename") {
    Object.assign(find(data, operation.id), { title: operation.title, titled: true });
  } else if (operation.op === "select") {
    if (operation.id !== data.activeId) activate(kind, data, find(data, operation.id), true);
  } else if (operation.op === "new") {
    // Percakapan yang masih kosong dipakai ulang agar daftar tidak penuh entri kosong.
    const current = find(data, data.activeId);
    if (current.messages.length > 0 || !document.isEmpty()) {
      if (data.conversations.length >= MAX_CONVERSATIONS) {
        throw new DocumentError(`Maksimal ${MAX_CONVERSATIONS} percakapan. Hapus yang tidak dipakai.`);
      }
      const next = blank(data);
      data.conversations.push(next);
      activate(kind, data, next, true);
    }
  } else {
    const removed = find(data, operation.id);
    data.conversations = data.conversations.filter((c) => c !== removed);
    if (data.activeId === removed.id) {
      let next = [...data.conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!next) {
        next = blank(data);
        data.conversations.push(next);
      }
      activate(kind, data, next, false);
    }
    rmSync(attachmentDirectory(removed.id), { recursive: true, force: true });
  }

  save(kind, data);
  return { ...conversationView(kind), state: document.state() };
}

function readAttachments(conversationId: string, messageId: string): Attachment[] {
  try {
    return z.array(attachmentSchema).parse(JSON.parse(readFileSync(attachmentFile(conversationId, messageId), "utf8")));
  } catch {
    return [];
  }
}

export type Turn = { role: "user" | "assistant"; text: string; attachments?: Attachment[] };

/**
 * Pesan lama untuk dikirim ke model. Lampiran terbaru diprioritaskan, dan bersama lampiran
 * kiriman sekarang tetap dalam batas satu permintaan.
 */
export function conversationHistory(kind: ConversationKind, id: string, current: Attachment[] = []): Turn[] {
  let recent = find(load(kind), id).messages.slice(-HISTORY_MESSAGES);
  if (recent[0]?.role === "assistant") recent = recent.slice(1);
  const included = [...current];
  return recent
    .toReversed()
    .map((message): Turn => {
      if (!message.files?.length) return { role: message.role, text: message.text };
      const stored = readAttachments(id, message.id);
      const fits =
        stored.length > 0 && included.length + stored.length <= MAX_ATTACHMENTS && fitsTotal([...included, ...stored]);
      if (fits) {
        included.push(...stored);
        return { role: message.role, text: message.text, attachments: stored };
      }
      return {
        role: message.role,
        text: `${message.text}\n[Earlier attachments not included: ${message.files.join(", ")}]`,
      };
    })
    .toReversed();
}

/** Catat satu tanya-jawab yang berhasil. Diabaikan bila percakapannya sudah dihapus. */
export function recordExchange(
  kind: ConversationKind,
  id: string,
  request: { text: string; label?: string; attachments?: Attachment[] },
  reply: string,
) {
  const data = load(kind);
  const conversation = data.conversations.find((c) => c.id === id);
  if (!conversation) return;
  const now = Date.now();
  const attachments = request.attachments ?? [];
  const user: ChatMessage = { id: newId(), role: "user", text: request.text, at: now };
  if (request.label) user.label = request.label;
  if (attachments.length > 0) {
    user.files = attachments.map((file) => file.name);
    writeFileAtomic(attachmentFile(id, user.id), JSON.stringify(attachments));
  }
  conversation.messages.push(user, { id: newId(), role: "assistant", text: reply, at: now });
  while (conversation.messages.length > MAX_MESSAGES) {
    const dropped = conversation.messages.shift()!;
    if (dropped.files) rmSync(attachmentFile(id, dropped.id), { force: true });
  }
  if (!conversation.titled) {
    const title = (request.label ?? request.text).replace(/\s+/g, " ").trim();
    conversation.title = title.length > 40 ? `${title.slice(0, 39)}…` : title.slice(0, MAX_TITLE) || conversation.title;
    conversation.titled = true;
  }
  conversation.updatedAt = now;
  save(kind, data);
}
