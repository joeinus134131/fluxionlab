import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { guard } from "@/lib/guard";
import { MAX_BODY_BYTES, readText, respond } from "@/lib/http";
import { MAX_OBJECTS, newObjectSchema, patchSchema, sceneInputSchema, type Operation } from "@/lib/scene";
import { applyOperation, getState } from "@/lib/scene-store";
import { boardSchema, componentSchema, FOOTPRINT_GUIDE, type BoardOperation } from "@/lib/pcb";
import { analyzeBoard } from "@/lib/pcb-analysis";
import { applyBoardOperation, getBoardState } from "@/lib/pcb-store";

export const dynamic = "force-dynamic";

const GUIDE =
  "Y is up, ground is y=0, units are meters, position is the object center. At scale [1,1,1] every shape fits a 1m cube; " +
  "torus lies in the XY plane, plane lies flat on XZ. Rotation is in degrees.";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

function run(operation: Operation) {
  try {
    return text(applyOperation(operation));
  } catch (error) {
    return { ...text({ error: (error as Error).message }), isError: true };
  }
}

const PCB_GUIDE =
  "2-layer PCB. Units are mm, (0,0) is the top-left corner, Y goes down, x,y is the component center. " +
  'Nets list pins as "REF.PIN". Tracks are autorouted.';

/** Papan beserta hasil cek dan routing, agar asisten bisa memperbaiki desainnya. */
function report(state = getBoardState()) {
  const { issues, routing } = analyzeBoard(state.board);
  return { ...state, issues, unrouted: routing.unrouted.map(({ net, from, to }) => ({ net, from, to })) };
}

function runBoard(operation: BoardOperation) {
  try {
    return text(report(applyBoardOperation(operation)));
  } catch (error) {
    return { ...text({ error: (error as Error).message }), isError: true };
  }
}

function registerBoardTools(server: McpServer) {
  server.registerTool(
    "get_board",
    {
      description: `Read the current PCB with check results and unrouted connections. ${PCB_GUIDE}`,
      annotations: { readOnlyHint: true },
    },
    async () => text(report()),
  );
  server.registerTool(
    "set_board",
    { description: `Replace the whole PCB. ${PCB_GUIDE}\n${FOOTPRINT_GUIDE}`, inputSchema: boardSchema.shape },
    async (board) => runBoard({ op: "replace", board }),
  );
  const { ref, x, y, rotation } = componentSchema.shape;
  server.registerTool(
    "move_component",
    { description: "Move or rotate one PCB component.", inputSchema: { ref, x, y, rotation } },
    async (args) => runBoard({ op: "move", ...args }),
  );
  server.registerTool(
    "remove_component",
    { description: "Delete one PCB component and its net connections.", inputSchema: { ref } },
    async (args) => runBoard({ op: "remove", ...args }),
  );
  server.registerTool("undo_board", { description: "Revert the last PCB change." }, async () =>
    runBoard({ op: "undo" }),
  );
  server.registerTool("redo_board", { description: "Reapply the last undone PCB change." }, async () =>
    runBoard({ op: "redo" }),
  );
}

function createServer() {
  const server = new McpServer({ name: "fluxion3d", version: "0.1.0" });

  server.registerTool(
    "get_scene",
    { description: `Read the current 3D scene, including object ids. ${GUIDE}`, annotations: { readOnlyHint: true } },
    async () => text(getState()),
  );
  server.registerTool(
    "set_scene",
    { description: `Replace the whole scene. ${GUIDE}`, inputSchema: sceneInputSchema.shape },
    async (scene) => run({ op: "replace", scene }),
  );
  server.registerTool(
    "add_objects",
    {
      description: `Add primitive objects to the scene. ${GUIDE}`,
      inputSchema: { objects: z.array(newObjectSchema).min(1).max(MAX_OBJECTS) },
    },
    async ({ objects }) => run({ op: "add", objects }),
  );
  server.registerTool(
    "update_object",
    { description: "Change fields of one object.", inputSchema: { id: z.string(), patch: patchSchema } },
    async ({ id, patch }) => run({ op: "update", id, patch }),
  );
  server.registerTool(
    "remove_objects",
    { description: "Delete objects by id.", inputSchema: { ids: z.array(z.string()).min(1) } },
    async ({ ids }) => run({ op: "remove", ids }),
  );
  server.registerTool("undo", { description: "Revert the last scene change." }, async () => run({ op: "undo" }));
  server.registerTool("redo", { description: "Reapply the last undone scene change." }, async () => run({ op: "redo" }));

  registerBoardTools(server);

  return server;
}

// Streamable HTTP tanpa sesi: satu server dan transport per permintaan.
export async function POST(request: Request) {
  return (
    guard(request) ??
    respond(async () => {
      const body = await readText(request, MAX_BODY_BYTES);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await createServer().connect(transport);
      return transport.handleRequest(new Request(request.url, { method: "POST", headers: request.headers, body }));
    })
  );
}

function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export { methodNotAllowed as GET, methodNotAllowed as DELETE };
