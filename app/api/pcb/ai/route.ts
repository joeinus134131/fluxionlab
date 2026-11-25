import { z } from "zod";
import { aiRoute } from "@/lib/ai-route";
import { attachmentsSchema, DEFAULT_ATTACHMENT_PROMPT } from "@/lib/attachments";
import { activeConversationId, conversationHistory, recordExchange } from "@/lib/conversation-store";
import { guard } from "@/lib/guard";
import { HttpError, MAX_AI_BODY_BYTES, readBody } from "@/lib/http";
import { generateBoard, reviewBoard } from "@/lib/pcb-ai";
import { applyBoardOperation, getBoardState } from "@/lib/pcb-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const model = {
  provider: z.enum(["claude", "compatible"]),
  model: z.string().max(100).default(""),
  /** Percakapan yang sedang dilihat pengirim. Kosong berarti percakapan aktif. */
  conversationId: z.string().max(64).optional(),
};
const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("design"),
    prompt: z.string().trim().max(4000),
    attachments: attachmentsSchema,
    /** Boleh memakai satu panggilan tambahan untuk memperbaiki hasil yang gagal cek. */
    autoRepair: z.boolean().default(true),
    /** Teks singkat untuk riwayat, misalnya saat prompt berisi daftar masalah yang panjang. */
    label: z.string().trim().max(200).optional(),
    ...model,
  }),
  z.object({ mode: z.literal("review"), ...model }),
]);

export async function POST(request: Request) {
  return (
    guard(request) ??
    aiRoute(async () => {
      const body = await readBody(request, bodySchema, MAX_AI_BODY_BYTES);
      if (body.mode === "design" && !body.prompt && body.attachments.length === 0) {
        throw new HttpError(400, "Tulis permintaan atau lampirkan file.");
      }
      const conversationId = activeConversationId("pcb");
      if (body.conversationId && body.conversationId !== conversationId) {
        throw new HttpError(409, "Percakapan aktif sudah berganti. Muat ulang lalu kirim lagi.");
      }
      const before = getBoardState();
      const history = conversationHistory("pcb", conversationId, body.mode === "design" ? body.attachments : []);
      const options = { ...body, current: before.board, history, signal: request.signal };
      if (body.mode === "review") {
        if (before.board.components.length === 0) throw new HttpError(400, "Belum ada desain untuk direview.");
        const review = await reviewBoard(options);
        recordExchange("pcb", conversationId, { text: "Review desain ini." }, review);
        return { review, version: before.version };
      }
      const prompt = body.prompt || DEFAULT_ATTACHMENT_PROMPT;
      const result = await generateBoard({
        ...options,
        prompt,
        attachments: body.attachments,
        autoRepair: body.autoRepair,
      });
      // Jangan menimpa perubahan yang masuk (UI atau MCP) selama AI bekerja.
      if (getBoardState().version !== before.version) {
        throw new HttpError(409, "Papan berubah saat AI bekerja, hasil tidak diterapkan. Kirim ulang permintaan.");
      }
      const state = applyBoardOperation({ op: "replace", board: result.board });
      recordExchange(
        "pcb",
        conversationId,
        { text: prompt, label: body.label, attachments: body.attachments },
        `Desain "${state.board.name}" diterapkan: ${state.board.components.length} komponen, ${state.board.nets.length} net.` +
          (result.problems ? ` Masih ada ${result.problems} masalah (lihat tab Cek).` : "") +
          (state.board.notes ? `\n\n${state.board.notes}` : ""),
      );
      return { ...state, calls: result.calls, problems: result.problems };
    })
  );
}
