import { placedPads, type Board, type Issue } from "./pcb";
import { CLEARANCE, EDGE_CLEARANCE, VIA_SIZE, type Point, type Routing } from "./pcb-router";

// DRC geometris atas hasil akhir. Sengaja tidak memakai grid router,
// supaya kesalahan router tertangkap di sini sebelum sampai ke pabrik.

const TOLERANCE = 0.005;
const TOUCH = 0.002;

/** Tembaga: persegi atau ruas, diperlebar sejauh `radius`. */
type Copper = {
  net: string | null;
  label: string;
  top: boolean;
  bottom: boolean;
  radius: number;
  box: { x1: number; y1: number; x2: number; y2: number };
} & ({ kind: "rect" } | { kind: "segment"; a: Point; b: Point });

function pointSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segments(a: Point, b: Point, c: Point, d: Point) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

type Box = Copper["box"];

const boxGap = (a: Box, b: Box) =>
  Math.hypot(Math.max(a.x1 - b.x2, b.x1 - a.x2, 0), Math.max(a.y1 - b.y2, b.y1 - a.y2, 0));

function segmentRect(a: Point, b: Point, r: Box) {
  const inside = (p: Point) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
  if (inside(a) || inside(b)) return 0;
  const corners = [
    { x: r.x1, y: r.y1 },
    { x: r.x2, y: r.y1 },
    { x: r.x2, y: r.y2 },
    { x: r.x1, y: r.y2 },
  ];
  return Math.min(...corners.map((corner, i) => segments(a, b, corner, corners[(i + 1) % 4])));
}

/** Jarak antar-tepi dua tembaga. Nol atau negatif berarti bersentuhan. */
function gap(a: Copper, b: Copper) {
  let core: number;
  if (a.kind === "segment" && b.kind === "segment") core = segments(a.a, a.b, b.a, b.b);
  else if (a.kind === "segment") core = segmentRect(a.a, a.b, b.box);
  else if (b.kind === "segment") core = segmentRect(b.a, b.b, a.box);
  else core = boxGap(a.box, b.box);
  return core - a.radius - b.radius;
}

/** Kotak pembatas termasuk radius, dipakai untuk menyaring pasangan yang jauh. */
const reach = (c: Copper): Box => ({
  x1: c.box.x1 - c.radius,
  y1: c.box.y1 - c.radius,
  x2: c.box.x2 + c.radius,
  y2: c.box.y2 + c.radius,
});

function segment(a: Point, b: Point, radius: number, rest: Omit<Copper, "box" | "radius" | "kind">): Copper {
  const box = { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  return { ...rest, kind: "segment", a, b, radius, box };
}

function collect(board: Board, routing: Routing): Copper[] {
  const netOf = new Map<string, string>();
  for (const net of board.nets) for (const pin of net.pins) if (!netOf.has(pin)) netOf.set(pin, net.name);

  const items: Copper[] = [];
  for (const pad of board.components.flatMap(placedPads)) {
    if (!pad.plated) continue;
    const rest = { net: netOf.get(pad.id) ?? null, label: `pad ${pad.id}`, top: true, bottom: pad.drill > 0 };
    if (pad.round) items.push(segment(pad, pad, pad.w / 2, rest));
    else {
      const box = { x1: pad.x - pad.w / 2, y1: pad.y - pad.h / 2, x2: pad.x + pad.w / 2, y2: pad.y + pad.h / 2 };
      items.push({ ...rest, kind: "rect", radius: 0, box });
    }
  }
  for (const track of routing.tracks) {
    track.points.slice(1).forEach((point, i) => {
      items.push(
        segment(track.points[i], point, track.width / 2, {
          net: track.net,
          label: `jalur ${track.net}`,
          top: track.layer === 0,
          bottom: track.layer === 1,
        }),
      );
    });
  }
  for (const via of routing.vias) {
    items.push(segment(via, via, VIA_SIZE / 2, { net: via.net, label: `via ${via.net}`, top: true, bottom: true }));
  }
  return items;
}

const sharesLayer = (a: Copper, b: Copper) => (a.top && b.top) || (a.bottom && b.bottom);

export function runDrc(board: Board, routing: Routing): Issue[] {
  const items = collect(board, routing);
  const messages = new Set<string>();

  // Jarak antar-net berbeda. Diurutkan menurut x agar pasangan jauh bisa dilewati.
  const sorted = items.map((item) => ({ item, box: reach(item) })).sort((a, b) => a.box.x1 - b.box.x1);
  sorted.forEach(({ item: a, box }, i) => {
    for (let j = i + 1; j < sorted.length && sorted[j].box.x1 <= box.x2 + CLEARANCE; j++) {
      const b = sorted[j].item;
      if ((a.net !== null && a.net === b.net) || !sharesLayer(a, b)) continue;
      // Pad dalam satu komponen sudah ditentukan footprint.
      if (a.label.startsWith("pad") && b.label.startsWith("pad") && boxGap(box, sorted[j].box) > 0) continue;
      if (boxGap(box, sorted[j].box) >= CLEARANCE) continue;
      const distance = gap(a, b);
      if (distance < CLEARANCE - TOLERANCE) {
        messages.add(
          distance <= 0
            ? `DRC: korsleting antara ${a.label} dan ${b.label}.`
            : `DRC: jarak ${a.label} ke ${b.label} hanya ${distance.toFixed(3)} mm (minimal ${CLEARANCE} mm).`,
        );
      }
    }
  });

  // Jarak jalur dan via ke tepi papan.
  for (const item of items) {
    if (item.label.startsWith("pad")) continue;
    const box = reach(item);
    const edge = Math.min(box.x1, box.y1, board.width - box.x2, board.height - box.y2);
    if (edge < EDGE_CLEARANCE - TOLERANCE) messages.add(`DRC: ${item.label} terlalu dekat ke tepi papan.`);
  }

  // Kesinambungan: semua pad satu net harus terhubung oleh tembaga yang bersentuhan.
  const incomplete = new Set(routing.unrouted.map((u) => u.net));
  const byNet = new Map<string, Copper[]>();
  for (const item of items) {
    if (item.net === null) continue;
    const list = byNet.get(item.net);
    if (list) list.push(item);
    else byNet.set(item.net, [item]);
  }
  for (const [net, list] of byNet) {
    if (incomplete.has(net)) continue;
    const parent = list.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (sharesLayer(list[i], list[j]) && gap(list[i], list[j]) <= TOUCH) parent[find(i)] = find(j);
      }
    }
    const groups = new Set(list.flatMap((item, i) => (item.label.startsWith("pad") ? [find(i)] : [])));
    if (groups.size > 1) messages.add(`DRC: net ${net} terputus.`);
  }

  return [...messages].map((message) => ({ level: "error" as const, message }));
}
