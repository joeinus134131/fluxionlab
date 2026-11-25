import { z } from "zod";

// Skema PCB, pustaka footprint, geometri, dan pemeriksaan desain.
// Dipakai bersama oleh UI, REST API, AI, dan server MCP.
// Satuan mm. Titik (0,0) di pojok kiri atas papan, X ke kanan, Y ke bawah.

export const MAX_COMPONENTS = 80;
export const MAX_NETS = 150;
export const MAX_BOARD_MM = 150;

export type Pad = {
  pin: string;
  x: number;
  y: number;
  w: number;
  h: number;
  round: boolean;
  /** Diameter bor. 0 berarti pad SMD di lapisan atas. */
  drill: number;
  /** false untuk lubang tanpa tembaga (lubang baut). */
  plated: boolean;
};

function smd(pin: number, x: number, y: number, w: number, h: number): Pad {
  return { pin: String(pin), x, y, w, h, round: false, drill: 0, plated: true };
}

/** Pad tembus lubang. Pin 1 dibuat kotak sebagai penanda orientasi. */
function tht(pin: number, x: number, y: number, size: number, drill: number): Pad {
  return { pin: String(pin), x, y, w: size, h: size, round: pin !== 1, drill, plated: true };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const inline = (count: number, size: number, drill: number) =>
  range(count).map((i) => tht(i + 1, (i - (count - 1) / 2) * 2.54, 0, size, drill));
const chip = (offset: number, w: number, h: number) => [smd(1, -offset, 0, w, h), smd(2, offset, 0, w, h)];

const FIXED: Record<string, () => Pad[]> = {
  "0603": () => chip(0.8, 0.9, 0.95),
  "0805": () => chip(0.95, 1.0, 1.3),
  "1206": () => chip(1.5, 1.15, 1.8),
  AXIAL: () => [tht(1, -5.08, 0, 1.8, 0.9), tht(2, 5.08, 0, 1.8, 0.9)],
  RADIAL: () => [tht(1, -1.27, 0, 1.6, 0.8), tht(2, 1.27, 0, 1.6, 0.8)],
  LED_5MM: () => [tht(1, -1.27, 0, 1.7, 0.9), tht(2, 1.27, 0, 1.7, 0.9)],
  TO92: () => inline(3, 1.7, 0.8),
  TO220: () => inline(3, 1.9, 1.1),
  SOT23: () => [smd(1, -0.95, 1.1, 0.6, 0.9), smd(2, 0.95, 1.1, 0.6, 0.9), smd(3, 0, -1.1, 0.6, 0.9)],
  SOT223: () => [
    smd(1, -2.3, 3.15, 1.2, 2.2),
    smd(2, 0, 3.15, 1.2, 2.2),
    smd(3, 2.3, 3.15, 1.2, 2.2),
    smd(4, 0, -3.15, 3.6, 2.2),
  ],
  TACT_6MM: () => [
    tht(1, -3.25, -2.25, 2, 1.1),
    tht(2, 3.25, -2.25, 2, 1.1),
    tht(3, -3.25, 2.25, 2, 1.1),
    tht(4, 3.25, 2.25, 2, 1.1),
  ],
  MOUNTING_HOLE_M3: () => [{ pin: "", x: 0, y: 0, w: 3.2, h: 3.2, round: true, drill: 3.2, plated: false }],
};

/** Dua baris, pin 1 di kiri atas, bernomor turun di kiri lalu naik di kanan. */
function dualRow(count: number, pitch: number, halfSpan: number, make: (pin: number, x: number, y: number) => Pad) {
  const half = count / 2;
  return range(count).map((i) => {
    const left = i < half;
    const row = left ? i : count - 1 - i;
    return make(i + 1, left ? -halfSpan : halfSpan, (row - (half - 1) / 2) * pitch);
  });
}

export const FOOTPRINT_GUIDE = `Footprints (use these exact strings):
- 0603, 0805, 1206: SMD 2-pin chip for resistor, capacitor, LED. For LED and diode, pin 1 = cathode, pin 2 = anode. For polarized capacitor, pin 1 = positive.
- AXIAL: through-hole resistor or diode, 10.16 mm pitch (diode pin 1 = cathode).
- RADIAL: through-hole capacitor, 2.54 mm pitch (pin 1 = positive).
- LED_5MM: through-hole LED, pin 1 = cathode, pin 2 = anode.
- TO92, TO220: 3 pins in a row. Pin order depends on the exact part; follow its datasheet.
- SOT23: 3 pins (pins 1 and 2 on one side, pin 3 opposite). SOT223: pins 1,2,3 plus tab pin 4.
- DIP-4 to DIP-40 (even count), SOIC-8 to SOIC-28 (even count): standard IC numbering.
- PINHEADER-1 to PINHEADER-40: single row, 2.54 mm pitch, pin 1 at the top at rotation 0. Use for connectors, power input, and plug-in modules.
- TACT_6MM: push button. Pins 1-2 are internally connected, pins 3-4 are internally connected; pressing joins the two pairs.
- MOUNTING_HOLE_M3: 3.2 mm screw hole, no pins.`;

/** Pad dari sebuah footprint pada rotasi 0, atau null bila nama tidak dikenal. */
export function footprintPads(name: string): Pad[] | null {
  if (Object.hasOwn(FIXED, name)) return FIXED[name]();
  const match = /^(DIP|SOIC|PINHEADER)-([1-9]\d?)$/.exec(name);
  if (!match) return null;
  const count = Number(match[2]);
  if (match[1] === "PINHEADER") {
    if (count > 40) return null;
    return range(count).map((i) => tht(i + 1, 0, (i - (count - 1) / 2) * 2.54, 1.7, 1.0));
  }
  if (count % 2 !== 0) return null;
  if (match[1] === "DIP") {
    if (count < 4 || count > 40) return null;
    return dualRow(count, 2.54, count >= 32 ? 7.62 : 3.81, (pin, x, y) => tht(pin, x, y, 1.6, 0.8));
  }
  if (count < 8 || count > 28) return null;
  return dualRow(count, 1.27, 2.7, (pin, x, y) => smd(pin, x, y, 1.5, 0.6));
}

const coord = z.number().min(-50).max(MAX_BOARD_MM + 50);

export const componentSchema = z.object({
  ref: z.string().regex(/^[A-Za-z]{1,4}[0-9]{1,3}$/, "Gunakan format seperti R1 atau U2"),
  value: z.string().max(60),
  footprint: z.string().refine((name) => footprintPads(name) !== null, "Footprint tidak dikenal"),
  x: coord,
  y: coord,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

export const netSchema = z.object({
  name: z.string().min(1).max(40),
  pins: z.array(z.string().max(12)).max(80).describe('Format "REF.PIN", contoh "R1.2"'),
});

export const boardSchema = z.object({
  name: z.string().min(1).max(120),
  width: z.number().min(10).max(MAX_BOARD_MM),
  height: z.number().min(10).max(MAX_BOARD_MM),
  trackWidth: z.number().min(0.2).max(1),
  components: z.array(componentSchema).max(MAX_COMPONENTS),
  nets: z.array(netSchema).max(MAX_NETS),
  notes: z.string().max(4000),
});

export const boardOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), board: boardSchema }),
  z.object({
    op: z.literal("move"),
    ref: z.string(),
    x: coord,
    y: coord,
    rotation: componentSchema.shape.rotation,
  }),
  z.object({ op: z.literal("remove"), ref: z.string() }),
  z.object({ op: z.literal("undo") }),
]);

export type Board = z.infer<typeof boardSchema>;
export type Component = z.infer<typeof componentSchema>;
export type BoardOperation = z.infer<typeof boardOperationSchema>;
export type BoardState = { version: number; board: Board };

export const EMPTY_BOARD: Board = {
  name: "Papan baru",
  width: 50,
  height: 40,
  trackWidth: 0.25,
  components: [],
  nets: [],
  notes: "",
};

export type PlacedPad = Pad & { ref: string; /** "R1.2" */ id: string };

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Pad satu komponen dalam koordinat papan. */
export function placedPads(component: Component): PlacedPad[] {
  return (footprintPads(component.footprint) ?? []).map((pad) => {
    let { x, y, w, h } = pad;
    for (let turn = 0; turn < component.rotation; turn += 90) {
      [x, y] = [-y, x];
      [w, h] = [h, w];
    }
    return {
      ...pad,
      x: round(component.x + x),
      y: round(component.y + y),
      w,
      h,
      ref: component.ref,
      id: `${component.ref}.${pad.pin}`,
    };
  });
}

export type Box = { x1: number; y1: number; x2: number; y2: number };

/** Kotak pembatas pad ditambah jarak 0,25 mm. Dipakai untuk silkscreen dan cek tabrakan. */
export function courtyard(component: Component): Box {
  const pads = placedPads(component);
  const margin = 0.25;
  return {
    x1: round(Math.min(...pads.map((p) => p.x - p.w / 2)) - margin),
    y1: round(Math.min(...pads.map((p) => p.y - p.h / 2)) - margin),
    x2: round(Math.max(...pads.map((p) => p.x + p.w / 2)) + margin),
    y2: round(Math.max(...pads.map((p) => p.y + p.h / 2)) + margin),
  };
}

export type Issue = { level: "error" | "warning"; message: string };

/** Pemeriksaan tata letak dan netlist. Bukan pemeriksaan kebenaran rangkaian. */
export function checkBoard(board: Board): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: "error", message });
  const warning = (message: string) => issues.push({ level: "warning", message });

  const pins = new Set<string>();
  const refs = new Set<string>();
  for (const component of board.components) {
    if (refs.has(component.ref)) error(`Referensi ${component.ref} dipakai lebih dari sekali.`);
    refs.add(component.ref);
    for (const pad of placedPads(component)) if (pad.pin) pins.add(pad.id);
  }

  const boxes = board.components.map((component) => ({ ref: component.ref, ...courtyard(component) }));
  for (const [i, a] of boxes.entries()) {
    if (a.x1 < 0 || a.y1 < 0 || a.x2 > board.width || a.y2 > board.height) {
      error(`${a.ref} keluar dari tepi papan.`);
    }
    for (const b of boxes.slice(i + 1)) {
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) error(`${a.ref} bertabrakan dengan ${b.ref}.`);
    }
  }

  const netOfPin = new Map<string, string>();
  const names = new Set<string>();
  for (const net of board.nets) {
    if (names.has(net.name)) error(`Nama net ${net.name} ganda.`);
    names.add(net.name);
    if (new Set(net.pins).size < 2) warning(`Net ${net.name} hanya punya satu pin.`);
    for (const pin of new Set(net.pins)) {
      if (!pins.has(pin)) error(`Net ${net.name}: pin ${pin} tidak ada.`);
      const other = netOfPin.get(pin);
      if (other) error(`Pin ${pin} ada di dua net: ${other} dan ${net.name}.`);
      netOfPin.set(pin, net.name);
    }
  }
  return issues;
}
