import { z } from "zod";
import { generateScene } from "@/lib/ai";
import { aiRoute } from "@/lib/ai-route";
import { attachmentsSchema, DEFAULT_ATTACHMENT_PROMPT } from "@/lib/attachments";
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
  })
  .refine((body) => body.prompt || body.attachments.length > 0, "Tulis permintaan atau lampirkan file.");

export async function POST(request: Request) {
  return (
    guard(request) ??
    aiRoute(async () => {
      const body = await readBody(request, bodySchema, MAX_AI_BODY_BYTES);
      const before = getState();
      const scene = await generateScene({
        ...body,
        prompt: body.prompt || DEFAULT_ATTACHMENT_PROMPT,
        current: before.scene,
        signal: request.signal,
      });
      // Jangan menimpa perubahan yang masuk (UI atau MCP) selama AI bekerja.
      if (getState().version !== before.version) {
        throw new HttpError(409, "Scene berubah saat AI bekerja, hasil tidak diterapkan. Kirim ulang permintaan.");
      }
      return applyOperation({ op: "replace", scene });
    })
  );
}
