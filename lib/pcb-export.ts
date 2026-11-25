import { placedPads, type Board, type PlacedPad } from "./pcb";
import { CLEARANCE, EDGE_CLEARANCE, VIA_DRILL, VIA_SIZE, type Point, type Routing } from "./pcb-router";
import { PIN1_DOT, silkscreen, SILK_WIDTH } from "./pcb-silk";

// Berkas produksi: Gerber RS-274X, bor Excellon, BOM, dan posisi komponen.
// Gerber memakai Y ke atas, jadi sumbu Y dibalik terhadap tampilan.

const MASK_EXPANSION = 0.05;

function gerber(height: number, fileFunction: string) {
  const apertures = new Map<string, number>();
  const body: string[] = [];
  let selected = 0;
  const num = (value: number) => Math.round(value * 1e6).toString();
  const xy = ({ x, y }: Point) => `X${num(x)}Y${num(height - y)}`;
  const select = (shape: string) => {
    let code = apertures.get(shape);
    if (!code) {
      code = 10 + apertures.size;
      apertures.set(shape, code);
    }
    if (code !== selected) body.push(`D${code}*`);
    selected = code;
  };
  const size = (value: number) => value.toFixed(4);
  return {
    flash(at: Point, w: number, h: number, round: boolean) {
      select(round ? `C,${size(w)}` : `R,${size(w)}X${size(h)}`);
      body.push(`${xy(at)}D03*`);
    },
    line(points: Point[], width: number) {
      select(`C,${size(width)}`);
      body.push(`${xy(points[0])}D02*`);
      for (const point of points.slice(1)) body.push(`${xy(point)}D01*`);
    },
    toString() {
      return [
        "%TF.GenerationSoftware,FluxionLab,PCB,1.0*%",
        `%TF.FileFunction,${fileFunction}*%`,
        "%FSLAX46Y46*%",
        "%MOMM*%",
        "%LPD*%",
        ...[...apertures].map(([shape, code]) => `%ADD${code}${shape}*%`),
        "G01*",
        ...body,
        "M02*",
        "",
      ].join("\n");
    },
  };
}

const rectangle = (x1: number, y1: number, x2: number, y2: number): Point[] => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 },
  { x: x1, y: y1 },
];

function drillFile(height: number, holes: { x: number; y: number; d: number }[]) {
  const sizes = [...new Set(holes.map((hole) => hole.d))].sort((a, b) => a - b);
  const lines = ["M48", "METRIC,TZ", ...sizes.map((d, i) => `T${i + 1}C${d.toFixed(3)}`), "%", "G90", "G05"];
  sizes.forEach((d, i) => {
    lines.push(`T${i + 1}`);
    for (const hole of holes.filter((h) => h.d === d)) {
      lines.push(`X${hole.x.toFixed(3)}Y${(height - hole.y).toFixed(3)}`);
    }
  });
  lines.push("M30", "");
  return lines.join("\n");
}

const csv = (rows: (string | number)[][]) =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          let text = String(cell);
          // Cegah teks dari AI dibaca sebagai rumus oleh aplikasi spreadsheet.
          if (typeof cell === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
          return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(","),
    )
    .join("\n") + "\n";

export function billOfMaterials(board: Board) {
  const groups = new Map<string, { value: string; footprint: string; refs: string[] }>();
  for (const { ref, value, footprint } of board.components) {
    if (footprint === "MOUNTING_HOLE_M3") continue;
    const key = JSON.stringify([value, footprint]);
    const group = groups.get(key) ?? { value, footprint, refs: [] };
    group.refs.push(ref);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function productionFiles(board: Board, routing: Routing): Record<string, string> {
  const { width, height } = board;
  const pads: PlacedPad[] = board.components.flatMap(placedPads);

  const copper = ([0, 1] as const).map((layer) => {
    const file = gerber(height, layer === 0 ? "Copper,L1,Top" : "Copper,L2,Bot");
    for (const track of routing.tracks) if (track.layer === layer) file.line(track.points, track.width);
    for (const pad of pads) {
      if (pad.plated && (layer === 0 || pad.drill > 0)) file.flash(pad, pad.w, pad.h, pad.round);
    }
    for (const via of routing.vias) file.flash(via, VIA_SIZE, VIA_SIZE, true);
    return file.toString();
  });

  const mask = ([0, 1] as const).map((layer) => {
    const file = gerber(height, layer === 0 ? "Soldermask,Top" : "Soldermask,Bot");
    for (const pad of pads) {
      if (layer === 0 || pad.drill > 0) {
        file.flash(pad, pad.w + 2 * MASK_EXPANSION, pad.h + 2 * MASK_EXPANSION, pad.round);
      }
    }
    return file.toString();
  });

  const silk = gerber(height, "Legend,Top");
  for (const { outline: box, texts, pin1 } of silkscreen(board)) {
    for (const line of [box, ...texts]) silk.line(line, SILK_WIDTH);
    if (pin1) silk.flash(pin1, PIN1_DOT, PIN1_DOT, true);
  }

  const outline = gerber(height, "Profile,NP");
  outline.line(rectangle(0, 0, width, height), 0.1);

  const plated = [
    ...pads.filter((p) => p.drill > 0 && p.plated).map((p) => ({ x: p.x, y: p.y, d: p.drill })),
    ...routing.vias.map((v) => ({ x: v.x, y: v.y, d: VIA_DRILL })),
  ];
  const unplated = pads.filter((p) => !p.plated).map((p) => ({ x: p.x, y: p.y, d: p.drill }));

  const minimumDrill = Math.min(...plated.map((hole) => hole.d), VIA_DRILL);
  const fabrication = [
    `Proyek: ${board.name}`,
    `Ukuran: ${width} x ${height} mm`,
    "Lapisan: 2",
    `Lebar jalur minimal: ${board.trackWidth} mm`,
    `Jarak tembaga minimal: ${CLEARANCE} mm`,
    `Jarak tembaga ke tepi: ${EDGE_CLEARANCE} mm`,
    `Via: diameter ${VIA_SIZE} mm, bor ${VIA_DRILL} mm, tertutup solder mask`,
    `Bor terkecil: ${minimumDrill} mm`,
    "",
    "Sebelum memesan: buka berkas di penampil Gerber, cocokkan pinout dengan datasheet,",
    "dan jalankan pemeriksaan DFM pabrik.",
    "",
  ].join("\n");

  return {
    "BACA-SAYA.txt": fabrication,
    "top-copper.gtl": copper[0],
    "bottom-copper.gbl": copper[1],
    "top-mask.gts": mask[0],
    "bottom-mask.gbs": mask[1],
    "top-silk.gto": silk.toString(),
    "outline.gko": outline.toString(),
    "drill-pth.drl": drillFile(height, plated),
    ...(unplated.length ? { "drill-npth.drl": drillFile(height, unplated) } : {}),
    "bom.csv": csv([
      ["Referensi", "Nilai", "Footprint", "Jumlah"],
      ...billOfMaterials(board).map((g) => [g.refs.join(" "), g.value, g.footprint, g.refs.length]),
    ]),
    "posisi-komponen.csv": csv([
      ["Referensi", "Nilai", "Footprint", "X (mm)", "Y (mm)", "Rotasi"],
      ...board.components
        .filter((c) => c.footprint !== "MOUNTING_HOLE_M3")
        // Y ke atas seperti Gerber; rotasi dibalik agar berlawanan arah jarum jam.
        .map((c) => [c.ref, c.value, c.footprint, c.x, Number((height - c.y).toFixed(3)), (360 - c.rotation) % 360]),
    ]),
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP tanpa kompresi, cukup untuk beberapa berkas teks kecil. */
export function zip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  const record = (size: number, fields: [number, number, 2 | 4][]) => {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    for (const [at, value, length] of fields) {
      if (length === 2) view.setUint16(at, value, true);
      else view.setUint32(at, value, true);
    }
    return bytes;
  };
  const DATE_1980 = 0x21;
  for (const [name, text] of Object.entries(files)) {
    const path = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = record(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [12, DATE_1980, 2],
      [14, crc, 4],
      [18, data.length, 4],
      [22, data.length, 4],
      [26, path.length, 2],
    ]);
    const central = record(46, [
      [0, 0x02014b50, 4],
      [4, 20, 2],
      [6, 20, 2],
      [14, DATE_1980, 2],
      [16, crc, 4],
      [20, data.length, 4],
      [24, data.length, 4],
      [28, path.length, 2],
      [42, offset, 4],
    ]);
    parts.push(local, path, data);
    directory.push(central, path);
    offset += local.length + path.length + data.length;
  }
  const count = Object.keys(files).length;
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = record(22, [
    [0, 0x06054b50, 4],
    [8, count, 2],
    [10, count, 2],
    [12, directorySize, 4],
    [16, offset, 4],
  ]);
  const all = [...parts, ...directory, end];
  const out = new Uint8Array(offset + directorySize + end.length);
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
