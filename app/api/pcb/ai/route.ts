import { z } from "zod";
import { aiRoute } from "@/lib/ai-route";
import { attachmentsSchema, DEFAULT_ATTACHMENT_PROMPT } from "@/lib/attachments";
import { guard } from "@/lib/guard";
import { HttpError, MAX_AI_BODY_BYTES, readBody } from "@/lib/http";
import { generateBoard, reviewBoard } from "@/lib/pcb-ai";
import { applyBoardOperation, getBoardState } from "@/lib/pcb-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const model = { provider: z.enum(["claude", "compatible"]), model: z.string().max(100).default("") };
const bodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("design"),
    prompt: z.string().trim().max(4000),
    attachments: attachmentsSchema,
    /** Boleh memakai satu panggilan tambahan untuk memperbaiki hasil yang gagal cek. */
    autoRepair: z.boolean().default(true),
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
      const before = getBoardState();
      const options = { ...body, current: before.board, signal: request.signal };
      if (body.mode === "review") {
        if (before.board.components.length === 0) throw new HttpError(400, "Belum ada desain untuk direview.");
        return { review: await reviewBoard(options), version: before.version };
      }
      const result = await generateBoard({
        ...options,
        prompt: body.prompt || DEFAULT_ATTACHMENT_PROMPT,
        attachments: body.attachments,
        autoRepair: body.autoRepair,
      });
      // Jangan menimpa perubahan yang masuk (UI atau MCP) selama AI bekerja.
      if (getBoardState().version !== before.version) {
        throw new HttpError(409, "Papan berubah saat AI bekerja, hasil tidak diterapkan. Kirim ulang permintaan.");
      }
      const state = applyBoardOperation({ op: "replace", board: result.board });
      return { ...state, calls: result.calls, problems: result.problems };
    })
  );
}
