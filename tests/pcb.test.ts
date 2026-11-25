import assert from "node:assert/strict";
import { test } from "node:test";
import { boardSchema, checkBoard, courtyard, footprintPads, placedPads, type Board, type Component } from "@/lib/pcb";
import { analyzeBoard } from "@/lib/pcb-analysis";
import { runDrc } from "@/lib/pcb-drc";
import { CLEARANCE, routeBoard } from "@/lib/pcb-router";
import { blinker, net, part } from "./helpers";

const ALL_FOOTPRINTS = [
  ..."0603 0805 1206 AXIAL RADIAL LED_5MM TO92 TO220 SOT23 SOT223 TACT_6MM MOUNTING_HOLE_M3".split(" "),
  ...Array.from({ length: 19 }, (_, i) => `DIP-${4 + i * 2}`),
  ...Array.from({ length: 11 }, (_, i) => `SOIC-${8 + i * 2}`),
  ...Array.from({ length: 40 }, (_, i) => `PINHEADER-${i + 1}`),
];

test("setiap footprint: nomor pin unik dan jarak antar-pad cukup", () => {
  for (const name of ALL_FOOTPRINTS) {
    const pads = footprintPads(name);
    assert.ok(pads, name);
    assert.equal(new Set(pads.map((p) => p.pin)).size, pads.length, name);
    for (const [i, a] of pads.entries()) {
      if (a.plated && a.drill > 0) assert.ok(Math.min(a.w, a.h) - a.drill >= 0.5, `${name}: cincin pad tipis`);
      for (const b of pads.slice(i + 1)) {
        const space =
          a.round && b.round
            ? Math.hypot(a.x - b.x, a.y - b.y) - a.w / 2 - b.w / 2
            : Math.hypot(
                Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, 0),
                Math.max(Math.abs(a.y - b.y) - (a.h + b.h) / 2, 0),
              );
        assert.ok(space >= CLEARANCE, `${name}: pad ${a.pin} dan ${b.pin} terlalu rapat (${space})`);
      }
    }
  }
  for (const name of ["DIP-5", "DIP-42", "SOIC-6", "PINHEADER-41", "constructor", "QFN-32"]) {
    assert.equal(footprintPads(name), null, name);
  }
});

test("pemeriksaan menemukan masalah netlist dan tata letak", () => {
  const board: Board = {
    ...blinker,
    components: [part("R1", "0805", 10, 10), part("R1", "0805", 10.5, 10), part("R2", "0805", 54.5, 20)],
    nets: [net("A", ["R1.1", "R9.1"]), net("B", ["R1.1", "R1.2"]), net("C", ["R1.2"])],
  };
  const text = checkBoard(board)
    .map((i) => i.message)
    .join("\n");
  for (const expected of [/R1 dipakai lebih/, /bertabrakan/, /keluar dari tepi/, /R9\.1 tidak ada/, /dua net/, /satu pin/, /R2 tidak tersambung/]) {
    assert.match(text, expected);
  }
});

test("papan contoh lolos semua pemeriksaan, termasuk jalur daya lebih lebar", () => {
  boardSchema.parse(blinker);
  const { routing, issues } = analyzeBoard(blinker);
  assert.deepEqual(issues, []);
  assert.deepEqual([...new Set(routing.tracks.filter((t) => t.net === "VCC").map((t) => t.width))], [0.6]);
  assert.deepEqual([...new Set(routing.tracks.filter((t) => t.net === "OUT").map((t) => t.width))], [0.25]);
});

test("DRC menangkap korsleting, jarak sempit, tepi papan, dan net terputus", () => {
  const board: Board = {
    ...blinker,
    components: [part("R1", "0805", 10, 10), part("R2", "0805", 20, 10)],
    nets: [net("A", ["R1.2", "R2.1"]), net("B", ["R1.1", "R2.2"])],
  };
  const check = (tracks: [string, number, number, number, number][]) =>
    runDrc(board, {
      tracks: tracks.map(([name, x1, y1, x2, y2]) => ({
        net: name,
        layer: 0,
        width: 0.25,
        points: [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
        ],
      })),
      vias: [],
      unrouted: [{ net: "B", from: "R1.1", to: "R2.2", a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }],
      timedOut: false,
    })
      .map((i) => i.message)
      .join("\n");

  assert.equal(check([["A", 10.95, 10, 19.05, 10]]), "");
  assert.match(check([["A", 10.95, 10, 19.05, 10], ["B", 15, 8, 15, 12]]), /korsleting/);
  assert.match(check([["A", 10.95, 10, 19.05, 10], ["B", 12, 10.4, 18, 10.4]]), /hanya 0\.150 mm/);
  assert.match(check([["A", 10.95, 10, 19.05, 10], ["B", 0.2, 5, 0.2, 20]]), /tepi papan/);
  assert.match(check([["A", 10.95, 10, 15, 10]]), /net A terputus/);
});

/** Pembangkit acak berbenih agar kegagalan bisa diulang. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomBoard(seed: number): Board {
  const next = random(seed);
  const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)];
  const footprints = ["0603", "0805", "1206", "SOT23", "SOT223", "SOIC-8", "SOIC-16", "DIP-8", "DIP-14", "PINHEADER-4", "TO92", "TO220", "AXIAL", "RADIAL", "LED_5MM", "TACT_6MM", "MOUNTING_HOLE_M3"];
  const width = 40 + Math.floor(next() * 30);
  const height = 30 + Math.floor(next() * 25);
  const components: Component[] = [];
  const wanted = 5 + Math.floor(next() * 9);
  for (let tries = 0; tries < 300 && components.length < wanted; tries++) {
    const candidate = part(
      `U${components.length + 1}`,
      pick(footprints),
      Math.round(next() * width * 4) / 4 + (next() > 0.5 ? 0.13 : 0),
      Math.round(next() * height * 4) / 4,
      pick([0, 90, 180, 270] as const),
    );
    const a = courtyard(candidate);
    const free = components.every((other) => {
      const b = courtyard(other);
      return !(a.x1 < b.x2 + 0.5 && b.x1 < a.x2 + 0.5 && a.y1 < b.y2 + 0.5 && b.y1 < a.y2 + 0.5);
    });
    if (free && a.x1 >= 0.5 && a.y1 >= 0.5 && a.x2 <= width - 0.5 && a.y2 <= height - 0.5) components.push(candidate);
  }
  const pins = components.flatMap(placedPads).filter((p) => p.pin).map((p) => p.id);
  pins.sort(() => next() - 0.5);
  const nets = [];
  while (pins.length >= 2 && nets.length < 14) {
    const size = 2 + Math.floor(next() * 3);
    nets.push(net(`N${nets.length}`, pins.splice(0, size), pick([0, 0, 0, 0.4, 0.8])));
  }
  return { name: `acak-${seed}`, width, height, trackWidth: pick([0.2, 0.25, 0.25, 0.4]), components, nets, notes: "" };
}

test("uji acak: hasil router tidak pernah melanggar DRC", () => {
  let connections = 0;
  let missed = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const board = boardSchema.parse(randomBoard(seed));
    const routing = routeBoard(board);
    assert.deepEqual(runDrc(board, routing), [], `seed ${seed}`);
    connections += board.nets.reduce((sum, n) => sum + n.pins.length - 1, 0);
    missed += routing.unrouted.length;
  }
  console.log(`# uji acak: ${connections - missed}/${connections} sambungan terhubung`);
  assert.ok(missed / connections < 0.1, "router terlalu sering gagal");
});

test("papan sebesar batas maksimal selesai dalam waktu wajar", () => {
  const components = Array.from({ length: 80 }, (_, i) =>
    part(`U${i + 1}`, "SOIC-16", 12 + (i % 10) * 14, 10 + Math.floor(i / 10) * 18),
  );
  const nets = Array.from({ length: 150 }, (_, i) => net(`N${i}`, [`U${(i % 40) + 1}.${(i % 16) + 1}`, `U${80 - (i % 40)}.${((i * 7) % 16) + 1}`]));
  const board = { name: "besar", width: 150, height: 150, trackWidth: 0.25, components, nets, notes: "" };
  const started = Date.now();
  const routing = routeBoard(board, { budgetMs: 1500 });
  assert.ok(Date.now() - started < 8000, `terlalu lama: ${Date.now() - started} ms`);
  // Tiap sambungan yang tidak sempat atau gagal dirute harus dilaporkan.
  if (routing.timedOut) assert.ok(routing.unrouted.length > 0);
});
