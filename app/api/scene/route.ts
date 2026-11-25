import { guard } from "@/lib/guard";
import { readBody, respond } from "@/lib/http";
import { operationSchema } from "@/lib/scene";
import { applyOperation, getState } from "@/lib/scene-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return (
    guard(request) ??
    respond(() => {
      const state = getState();
      const since = new URL(request.url).searchParams.get("since");
      return since !== null && Number(since) === state.version ? { version: state.version, unchanged: true } : state;
    })
  );
}

export async function POST(request: Request) {
  return guard(request) ?? respond(async () => applyOperation(await readBody(request, operationSchema)));
}
