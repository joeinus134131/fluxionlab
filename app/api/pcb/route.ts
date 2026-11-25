import { guard } from "@/lib/guard";
import { readBody, respond } from "@/lib/http";
import { boardOperationSchema } from "@/lib/pcb";
import { applyBoardOperation, getBoardState } from "@/lib/pcb-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return (
    guard(request) ??
    respond(() => {
      const state = getBoardState();
      const since = new URL(request.url).searchParams.get("since");
      return since !== null && Number(since) === state.version ? { version: state.version, unchanged: true } : state;
    })
  );
}

export async function POST(request: Request) {
  return guard(request) ?? respond(async () => applyBoardOperation(await readBody(request, boardOperationSchema)));
}
