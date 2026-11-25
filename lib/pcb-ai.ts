import { AiError, askModel, parseJson, type Provider } from "./ai";
import type { Attachment } from "./attachments";
import { boardSchema, checkBoard, FOOTPRINT_GUIDE, MAX_BOARD_MM, MAX_COMPONENTS, MAX_NETS, type Board } from "./pcb";
import { routeBoard } from "./pcb-router";

const DESIGN_SYSTEM = `You are an electronics engineer designing a 2-layer PCB.
Return the complete resulting board. When a current board is given and the user asks for a change, keep everything they did not ask you to change.

You choose the components, the netlist, and the placement. Copper routing is done afterwards by an autorouter, so do not describe tracks.

Units are mm. (0,0) is the top-left corner of the board, X goes right, Y goes down. x,y is the center of the component. rotation is 0, 90, 180, or 270 degrees clockwise. Board sides are at most ${MAX_BOARD_MM} mm. trackWidth is 0.25 for signal-level circuits; use up to 1.0 only when current requires it.

${FOOTPRINT_GUIDE}

Netlist: each net lists its pins as "REF.PIN", for example "R1.2". A pin belongs to at most one net. Leave unused pins out. There is no copper pour, so GND must be a net like any other.

Circuit quality: include what a working board needs (current-limiting resistors, decoupling capacitor next to each IC supply pin, pull-ups, power and signal connectors). Check IC pinouts against what you know of the datasheet.

Placement: leave at least 2 mm between component outlines and 2 mm to the board edge so the router has room. Keep connected parts close together. Do not overlap components. Put connectors near the edges.

notes: in the user's language, briefly explain how the circuit works, the supply voltage, and every pinout or value the user must verify against a datasheet. Use at most ${MAX_COMPONENTS} components and ${MAX_NETS} nets.`;

const REVIEW_SYSTEM = `You are a senior electronics engineer reviewing a PCB design given as JSON (units mm).
Reply in the language of the board's name and notes, in plain text without Markdown, at most 300 words.
List concrete problems ordered by severity: wrong or missing connections, pinout mistakes, missing protection or decoupling, component values, current and voltage limits, placement. Name the refs and pins. If something cannot be judged without a datasheet, say so. Do not invent problems.`;

const str = { type: "string" };
const num = { type: "number" };
const object = (properties: Record<string, object>): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

// Batas angka dan format nama divalidasi ulang oleh zod.
const OUTPUT_SCHEMA = object({
  name: str,
  width: num,
  height: num,
  trackWidth: num,
  components: {
    type: "array",
    items: object({
      ref: str,
      value: str,
      footprint: str,
      x: num,
      y: num,
      rotation: { type: "integer", enum: [0, 90, 180, 270] },
    }),
  },
  nets: { type: "array", items: object({ name: str, pins: { type: "array", items: str } }) },
  notes: str,
});

type Options = { provider: Provider; model: string; current: Board; signal: AbortSignal };

export async function generateBoard({
  provider,
  model,
  current,
  signal,
  prompt,
  attachments,
}: Options & { prompt: string; attachments: Attachment[] }) {
  const message =
    current.components.length === 0
      ? prompt
      : `Current board:\n${JSON.stringify(current)}\n\nRequest: ${prompt}`;
  const text = await askModel(provider, model, {
    system: DESIGN_SYSTEM,
    schema: OUTPUT_SCHEMA,
    message,
    attachments,
    signal,
  });
  const result = boardSchema.safeParse(parseJson(text));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AiError(`Desain PCB dari model tidak valid (${issue.path.join(".")}: ${issue.message}).`);
  }
  return result.data;
}

export async function reviewBoard({ provider, model, current, signal }: Options) {
  const issues = checkBoard(current).map((issue) => issue.message);
  const unrouted = routeBoard(current).unrouted.map((u) => `${u.net}: ${u.from} - ${u.to}`);
  const message = `Board:\n${JSON.stringify(current)}\n\nAutomatic check results: ${JSON.stringify(issues)}\nUnrouted connections: ${JSON.stringify(unrouted)}`;
  const text = await askModel(provider, model, {
    system: `${REVIEW_SYSTEM}\n\n${FOOTPRINT_GUIDE}`,
    message,
    signal,
  });
  if (!text.trim()) throw new AiError("Model tidak memberi jawaban. Coba lagi.");
  return text.trim();
}
