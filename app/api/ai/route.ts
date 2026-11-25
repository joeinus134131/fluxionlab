import { z } from "zod";
import { generateScene } from "@/lib/ai";
import { aiRoute } from "@/lib/ai-route";
import { attachmentsSchema, DEFAULT_ATTACHMENT_PROMPT } from "@/lib/attachments";
import { activeConversationId, conversationHistory, recordExchange } from "@/lib/conversation-store";
import { guard } from "@/lib/guard";
import { HttpError, MAX_AI_BODY_BYTES, readBody } from "@/lib/http";
import { applyOperation, getState } from "@/lib/scene-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z
  .object({
    prompt: z.string().trim().max(4000),
    attachments: attachmentsSchema,
    provider: z.enum(["claude", "compatible"]),
    model: z.string().max(100).default(""),
    /** Percakapan yang sedang dilihat pengirim. Kosong berarti percakapan aktif. */
    conversationId: z.string().max(64).optional(),
  })
  .refine((body) => body.prompt || body.attachments.length > 0, "Tulis permintaan atau lampirkan file.");

export async function POST(request: Request) {
  return (
    guard(request) ??
    aiRoute(async () => {
      const body = await readBody(request, bodySchema, MAX_AI_BODY_BYTES);
      const conversationId = activeConversationId("scene");
      if (body.conversationId && body.conversationId !== conversationId) {
        throw new HttpError(409, "Percakapan aktif sudah berganti. Muat ulang lalu kirim lagi.");
      }
      const before = getState();
      const prompt = body.prompt || DEFAULT_ATTACHMENT_PROMPT;
      const scene = await generateScene({
        ...body,
        prompt,
        history: conversationHistory("scene", conversationId, body.attachments),
        current: before.scene,
        signal: request.signal,
      });
      // Jangan menimpa perubahan yang masuk (UI atau MCP) selama AI bekerja.
      if (getState().version !== before.version) {
        throw new HttpError(409, "Scene berubah saat AI bekerja, hasil tidak diterapkan. Kirim ulang permintaan.");
      }
      const state = applyOperation({ op: "replace", scene });
      recordExchange(
        "scene",
        conversationId,
        { text: prompt, attachments: body.attachments },
        `Desain "${state.scene.name}" diterapkan (${state.scene.objects.length} objek).`,
      );
      return state;
    })
  );
}
