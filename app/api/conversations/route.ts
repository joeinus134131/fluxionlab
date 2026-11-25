import { applyConversationOperation, conversationView } from "@/lib/conversation-store";
import { CONVERSATION_KINDS, conversationOperationSchema, type ConversationKind } from "@/lib/conversations";
import { guard } from "@/lib/guard";
import { HttpError, readBody, respond } from "@/lib/http";

export const dynamic = "force-dynamic";

// Riwayat chat bersifat pribadi: hanya dari komputer ini, token API tidak berlaku.
export async function GET(request: Request) {
  return (
    guard(request, { localOnly: true }) ??
    respond(() => {
      const kind = new URL(request.url).searchParams.get("kind");
      if (!CONVERSATION_KINDS.includes(kind as ConversationKind)) throw new HttpError(400, "Jenis tidak dikenal.");
      return conversationView(kind as ConversationKind);
    })
  );
}

export async function POST(request: Request) {
  return (
    guard(request, { localOnly: true }) ??
    respond(async () => applyConversationOperation(await readBody(request, conversationOperationSchema)))
  );
}
