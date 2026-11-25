import { courtyard, placedPads, type Board, type Box } from "./pcb";
import type { Point } from "./pcb-router";

// Silkscreen: kotak komponen, penanda pin 1, dan teks referensi.
// Dipakai bersama oleh tampilan dan ekspor Gerber agar keduanya selalu sama.

export const SILK_WIDTH = 0.15;
export const PIN1_DOT = 0.5;
const TEXT_HEIGHT = 1.2;
const CHAR_WIDTH = 0.7;
const CHAR_GAP = 0.25;

// Huruf garis pada kisi 4 x 6. Tiap kata adalah satu polyline berisi pasangan "xy".
const GLYPHS: Record<string, string> = {
  A: "06 02 20 42 46,04 44",
  B: "06 00 30 41 42 33 03,33 44 45 36 06",
  C: "41 30 10 01 05 16 36 45",
  D: "00 06 26 44 42 20 00",
  E: "40 00 06 46,03 33",
  F: "40 00 06,03 33",
  G: "41 30 10 01 05 16 36 45 43 23",
  H: "00 06,40 46,03 43",
  I: "10 30,20 26,16 36",
  J: "40 45 36 16 05",
  K: "00 06,40 03 46",
  L: "00 06 46",
  M: "06 00 23 40 46",
  N: "06 00 46 40",
  O: "10 30 41 45 36 16 05 01 10",
  P: "06 00 30 41 42 33 03",
  Q: "10 30 41 45 36 16 05 01 10,24 46",
  R: "06 00 30 41 42 33 03,23 46",
  S: "41 30 10 01 02 13 33 44 45 36 16 05",
  T: "00 40,20 26",
  U: "00 05 16 36 45 40",
  V: "00 26 40",
  W: "00 16 23 36 40",
  X: "00 46,40 06",
  Y: "00 23 40,23 26",
  Z: "00 40 06 46",
  "0": "10 30 41 45 36 16 05 01 10,05 41",
  "1": "11 20 26,16 36",
  "2": "01 10 30 41 42 06 46",
  "3": "01 10 30 41 42 33 13,33 44 45 36 16 05",
  "4": "30 04 44,30 36",
  "5": "40 00 02 32 43 45 36 16 05",
  "6": "30 10 01 05 16 36 45 44 33 03",
  "7": "00 40 16",
  "8": "10 30 41 42 33 13 02 01 10,13 04 05 16 36 45 44 33",
  "9": "43 13 02 01 10 30 41 45 36 16",
};

export const textWidth = (text: string) => text.length * (CHAR_WIDTH + CHAR_GAP) - CHAR_GAP;

/** Polyline teks yang berpusat di (cx, cy). */
export function textStrokes(text: string, cx: number, cy: number): Point[][] {
  const left = cx - textWidth(text) / 2;
  const top = cy - TEXT_HEIGHT / 2;
  return [...text.toUpperCase()].flatMap((char, index) =>
    (GLYPHS[char]?.split(",") ?? []).map((line) =>
      line.split(" ").map((pair) => ({
        x: left + index * (CHAR_WIDTH + CHAR_GAP) + (Number(pair[0]) / 4) * CHAR_WIDTH,
        y: top + (Number(pair[1]) / 6) * TEXT_HEIGHT,
      })),
    ),
  );
}

const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

export type Silk = { ref: string; outline: Point[]; texts: Point[][]; pin1: Point | null };

export function silkscreen(board: Board): Silk[] {
  const yards = board.components.map(courtyard);
  const pads: Box[] = board.components.flatMap(placedPads).map((pad) => ({
    x1: pad.x - pad.w / 2,
    y1: pad.y - pad.h / 2,
    x2: pad.x + pad.w / 2,
    y2: pad.y + pad.h / 2,
  }));
  const taken: Box[] = [];
  const fits = (box: Box) =>
    box.x1 >= 0 &&
    box.y1 >= 0 &&
    box.x2 <= board.width &&
    box.y2 <= board.height &&
    ![...pads, ...yards, ...taken].some((other) => overlaps(box, other));

  return board.components.map((component, index) => {
    const yard = yards[index];
    const { x1, y1, x2, y2 } = yard;
    const outline = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
      { x: x1, y: y1 },
    ];

    // Titik pin 1 di luar kotak, pada sisi yang paling dekat dengan pad pin 1.
    let pin1: Point | null = null;
    const first = placedPads(component).find((pad) => pad.pin === "1");
    if (first) {
      const out = PIN1_DOT / 2 + 0.2;
      const candidates = [
        { distance: first.x - x1, at: { x: x1 - out, y: first.y } },
        { distance: x2 - first.x, at: { x: x2 + out, y: first.y } },
        { distance: first.y - y1, at: { x: first.x, y: y1 - out } },
        { distance: y2 - first.y, at: { x: first.x, y: y2 + out } },
      ].sort((a, b) => a.distance - b.distance);
      for (const { at } of candidates) {
        const half = PIN1_DOT / 2;
        const box = { x1: at.x - half, y1: at.y - half, x2: at.x + half, y2: at.y + half };
        if (fits(box)) {
          pin1 = at;
          taken.push(box);
          break;
        }
      }
    }

    // Teks referensi: atas, bawah, kanan, lalu kiri. Dilewati bila tidak ada tempat.
    const w = textWidth(component.ref) + SILK_WIDTH;
    const h = TEXT_HEIGHT + SILK_WIDTH;
    const gap = 0.3;
    const middle = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    const spots = [
      { x: middle.x, y: y1 - gap - h / 2 },
      { x: middle.x, y: y2 + gap + h / 2 },
      { x: x2 + gap + w / 2, y: middle.y },
      { x: x1 - gap - w / 2, y: middle.y },
    ];
    let texts: Point[][] = [];
    for (const spot of spots) {
      const box = { x1: spot.x - w / 2, y1: spot.y - h / 2, x2: spot.x + w / 2, y2: spot.y + h / 2 };
      if (fits(box)) {
        texts = textStrokes(component.ref, spot.x, spot.y);
        taken.push(box);
        break;
      }
    }
    return { ref: component.ref, outline, texts, pin1 };
  });
}
