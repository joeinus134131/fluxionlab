import { placedPads, type Board, type PlacedPad } from "./pcb";

// Autorouter dua lapis berbasis grid (A*), dengan beberapa kali coba ulang.

export const CLEARANCE = 0.2;
export const EDGE_CLEARANCE = 0.3;
export const VIA_SIZE = 0.8;
export const VIA_DRILL = 0.4;
const STEP = 0.25;
// Cadangan untuk ruas diagonal di antara dua titik grid.
const SLACK = 0.04;
const VIA_COST = 12;
const MAX_PASSES = 4;
const TIME_BUDGET_MS = 4000;

export type Point = { x: number; y: number };
/** layer 0 = atas, 1 = bawah. */
export type Track = { net: string; layer: 0 | 1; points: Point[] };
export type Via = { net: string; x: number; y: number };
export type Unrouted = { net: string; from: string; to: string; a: Point; b: Point };
export type Routing = { tracks: Track[]; vias: Via[]; unrouted: Unrouted[] };

type NetJob = { name: string; id: number; pads: PlacedPad[] };

const FREE = 0;
const BLOCKED = -1;

class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly size: number;
  /** Pemilik tiap sel per lapisan: kosong, id satu net, atau tertutup untuk semua. */
  readonly owner: [Int16Array, Int16Array];
  /** Sel yang tidak boleh diberi via (di sekitar pad). */
  readonly noVia: Uint8Array;

  constructor(board: Board) {
    this.cols = Math.floor(board.width / STEP) + 1;
    this.rows = Math.floor(board.height / STEP) + 1;
    this.size = this.cols * this.rows;
    this.owner = [new Int16Array(this.size), new Int16Array(this.size)];
    this.noVia = new Uint8Array(this.size);
    const edge = EDGE_CLEARANCE + board.trackWidth / 2;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = col * STEP;
        const y = row * STEP;
        if (x < edge || y < edge || x > board.width - edge || y > board.height - edge) {
          const cell = row * this.cols + col;
          this.owner[0][cell] = BLOCKED;
          this.owner[1][cell] = BLOCKED;
        }
      }
    }
  }

  /** Kunjungi sel yang jaraknya ke persegi (atau titik/garis tipis) kurang dari radius. */
  around(cx: number, cy: number, halfW: number, halfH: number, radius: number, visit: (cell: number) => void) {
    const c1 = Math.max(0, Math.ceil((cx - halfW - radius) / STEP));
    const c2 = Math.min(this.cols - 1, Math.floor((cx + halfW + radius) / STEP));
    const r1 = Math.max(0, Math.ceil((cy - halfH - radius) / STEP));
    const r2 = Math.min(this.rows - 1, Math.floor((cy + halfH + radius) / STEP));
    for (let row = r1; row <= r2; row++) {
      const dy = Math.max(Math.abs(row * STEP - cy) - halfH, 0);
      for (let col = c1; col <= c2; col++) {
        const dx = Math.max(Math.abs(col * STEP - cx) - halfW, 0);
        if (dx * dx + dy * dy < radius * radius) visit(row * this.cols + col);
      }
    }
  }

  claim(layer: 0 | 1, cell: number, net: number) {
    const current = this.owner[layer][cell];
    if (current === FREE) this.owner[layer][cell] = net;
    else if (current !== net) this.owner[layer][cell] = BLOCKED;
  }

  stampPad(pad: PlacedPad, net: number, trackWidth: number) {
    const radius = CLEARANCE + trackWidth / 2 + SLACK;
    // Bantalan bundar dianggap titik berjari-jari, selain itu persegi.
    const halfW = pad.round ? 0 : pad.w / 2;
    const halfH = pad.round ? 0 : pad.h / 2;
    const extra = pad.round ? pad.w / 2 : 0;
    for (const layer of pad.drill > 0 ? ([0, 1] as const) : ([0] as const)) {
      this.around(pad.x, pad.y, halfW, halfH, radius + extra, (cell) => this.claim(layer, cell, net));
    }
    const viaGap = VIA_SIZE / 2 + 0.05;
    this.around(pad.x, pad.y, halfW, halfH, viaGap + extra, (cell) => (this.noVia[cell] = 1));
  }

  viaFits(cell: number, net: number, trackWidth: number) {
    if (this.noVia[cell]) return false;
    const reach = Math.max(0, VIA_SIZE / 2 - trackWidth / 2);
    const x = (cell % this.cols) * STEP;
    const y = Math.floor(cell / this.cols) * STEP;
    let fits = true;
    this.around(x, y, 0, 0, reach + 0.01, (other) => {
      for (const layer of this.owner) {
        if (layer[other] !== FREE && layer[other] !== net) fits = false;
      }
    });
    return fits;
  }
}

class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get length() {
    return this.items.length;
  }
  push(item: number, key: number) {
    let i = this.items.length;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.items[i] = this.items[parent];
      this.keys[i] = this.keys[parent];
      i = parent;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }
  pop(): number {
    const top = this.items[0];
    const item = this.items.pop()!;
    const key = this.keys.pop()!;
    const n = this.items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && this.keys[child + 1] < this.keys[child]) child++;
        if (this.keys[child] >= key) break;
        this.items[i] = this.items[child];
        this.keys[i] = this.keys[child];
        i = child;
      }
      this.items[i] = item;
      this.keys[i] = key;
    }
    return top;
  }
}

const MOVES = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/** Titik-titik di dalam pad yang boleh menjadi ujung jalur. Node = layer * size + sel. */
function terminals(grid: Grid, pad: PlacedPad, net: number): number[] {
  const col = Math.round(pad.x / STEP);
  const row = Math.round(pad.y / STEP);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return [];
  const cell = row * grid.cols + col;
  const layers = pad.drill > 0 ? [0, 1] : [0];
  return layers.filter((l) => grid.owner[l][cell] === net).map((l) => l * grid.size + cell);
}

function search(grid: Grid, net: number, trackWidth: number, sources: Set<number>, targets: number[]) {
  const { size, cols, rows } = grid;
  const cost = new Float32Array(size * 2).fill(Infinity);
  const parent = new Int32Array(size * 2).fill(-1);
  const closed = new Uint8Array(size * 2);
  const goal = new Set(targets);
  const goalCol = targets[0] % size % cols;
  const goalRow = Math.floor((targets[0] % size) / cols);
  const estimate = (cell: number) => {
    const dx = Math.abs((cell % cols) - goalCol);
    const dy = Math.abs(Math.floor(cell / cols) - goalRow);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new Heap();
  for (const node of sources) {
    cost[node] = 0;
    open.push(node, estimate(node % size));
  }
  const relax = (from: number, to: number, step: number) => {
    const next = cost[from] + step;
    if (next >= cost[to]) return;
    cost[to] = next;
    parent[to] = from;
    open.push(to, next + estimate(to % size));
  };
  while (open.length > 0) {
    const node = open.pop();
    if (closed[node]) continue;
    closed[node] = 1;
    if (goal.has(node)) {
      const path = [node];
      while (parent[path[0]] >= 0) path.unshift(parent[path[0]]);
      return path;
    }
    const layer = node >= size ? 1 : 0;
    const cell = node - layer * size;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const previous = parent[node];
    for (const [dx, dy, length] of MOVES) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const other = r * cols + c;
      const owner = grid.owner[layer][other];
      if (owner !== FREE && owner !== net) continue;
      // Sedikit penalti belok agar jalur tidak zig-zag.
      const turned = previous >= 0 && node - previous !== layer * size + other - node;
      relax(node, layer * size + other, length + (turned ? 0.2 : 0));
    }
    const flipped = (1 - layer) * size + cell;
    const owner = grid.owner[1 - layer][cell];
    if ((owner === FREE || owner === net) && grid.viaFits(cell, net, trackWidth)) {
      relax(node, flipped, VIA_COST);
    }
  }
  return null;
}

function routeOnce(board: Board, jobs: NetJob[], loose: PlacedPad[]): Routing & { failed: Set<string> } {
  const grid = new Grid(board);
  const width = board.trackWidth;
  for (const job of jobs) for (const pad of job.pads) grid.stampPad(pad, job.id, width);
  for (const pad of loose) grid.stampPad(pad, BLOCKED, width);

  const result = { tracks: [] as Track[], vias: [] as Via[], unrouted: [] as Unrouted[], failed: new Set<string>() };
  const point = (node: number): Point => ({
    x: ((node % grid.size) % grid.cols) * STEP,
    y: Math.floor((node % grid.size) / grid.cols) * STEP,
  });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  for (const job of jobs) {
    const connected = [job.pads[0]];
    const tree = new Set(terminals(grid, job.pads[0], job.id));
    const centers = new Map<number, PlacedPad>();
    for (const node of tree) centers.set(node, job.pads[0]);
    const rest = job.pads.slice(1);
    const added: { track: Track; cells: number[] }[] = [];
    const addedVias: Via[] = [];

    while (rest.length > 0) {
      // Pad berikutnya: yang paling dekat dengan bagian yang sudah tersambung.
      let best = { index: 0, from: connected[0], gap: Infinity };
      rest.forEach((pad, index) => {
        for (const from of connected) {
          const gap = distance(pad, from);
          if (gap < best.gap) best = { index, from, gap };
        }
      });
      const [pad] = rest.splice(best.index, 1);
      const targets = terminals(grid, pad, job.id);
      const path = tree.size && targets.length ? search(grid, job.id, width, tree, targets) : null;
      if (!path) {
        result.failed.add(job.name);
        result.unrouted.push({ net: job.name, from: best.from.id, to: pad.id, a: best.from, b: pad });
        continue;
      }
      connected.push(pad);
      const end = path[path.length - 1];
      for (const node of targets) {
        tree.add(node);
        centers.set(node, pad);
      }

      // Pecah lintasan per lapisan, buang titik yang segaris.
      let start = 0;
      for (let i = 1; i <= path.length; i++) {
        const changes = i < path.length && path[i] >= grid.size !== path[start] >= grid.size;
        if (i < path.length && !changes) continue;
        const nodes = path.slice(start, i);
        const points: Point[] = [];
        nodes.forEach((node, n) => {
          const straight = n > 0 && n < nodes.length - 1 && node - nodes[n - 1] === nodes[n + 1] - node;
          if (!straight) points.push(point(node));
        });
        // Sambungkan ujung grid ke pusat pad yang tepat.
        const head = start === 0 ? centers.get(path[0]) : undefined;
        if (head && distance(head, points[0]) > 0.001) points.unshift({ x: head.x, y: head.y });
        const last = points[points.length - 1];
        if (i === path.length && centers.has(end) && distance(pad, last) > 0.001) points.push({ x: pad.x, y: pad.y });
        if (points.length > 1) {
          added.push({
            track: { net: job.name, layer: nodes[0] >= grid.size ? 1 : 0, points },
            cells: nodes,
          });
        }
        if (changes) {
          addedVias.push({ net: job.name, ...point(path[i]) });
          start = i;
        }
      }
      for (const node of path) tree.add(node);
    }

    // Tutup area jalur net ini untuk net berikutnya.
    for (const { track, cells } of added) {
      result.tracks.push(track);
      for (const node of cells) {
        const { x, y } = point(node);
        grid.around(x, y, 0, 0, width + CLEARANCE + SLACK, (cell) => grid.claim(track.layer, cell, job.id));
        grid.around(x, y, 0, 0, width / 2 + CLEARANCE + VIA_SIZE / 2, (cell) => (grid.noVia[cell] = 1));
      }
    }
    for (const via of addedVias) {
      result.vias.push(via);
      for (const layer of [0, 1] as const) {
        grid.around(via.x, via.y, 0, 0, VIA_SIZE / 2 + CLEARANCE + width / 2 + SLACK, (cell) =>
          grid.claim(layer, cell, job.id),
        );
      }
      grid.around(via.x, via.y, 0, 0, VIA_SIZE + CLEARANCE, (cell) => (grid.noVia[cell] = 1));
    }
  }
  return result;
}

export function routeBoard(board: Board): Routing {
  const pads = board.components.flatMap(placedPads);
  const byId = new Map(pads.filter((pad) => pad.pin).map((pad) => [pad.id, pad]));
  const used = new Set<string>();
  const jobs: NetJob[] = [];
  board.nets.forEach((net) => {
    const members: PlacedPad[] = [];
    for (const pin of net.pins) {
      const pad = byId.get(pin);
      if (pad && !used.has(pin)) {
        used.add(pin);
        members.push(pad);
      }
    }
    if (members.length > 0) jobs.push({ name: net.name, id: jobs.length + 1, pads: members });
  });
  const loose = pads.filter((pad) => !used.has(pad.id));

  const spread = ({ pads: list }: NetJob) =>
    Math.max(...list.map((p) => p.x)) -
    Math.min(...list.map((p) => p.x)) +
    Math.max(...list.map((p) => p.y)) -
    Math.min(...list.map((p) => p.y));
  let order = [...jobs].sort((a, b) => spread(a) - spread(b));

  const started = Date.now();
  let best = routeOnce(board, order, loose);
  let latest = best;
  for (let pass = 1; pass < MAX_PASSES && best.unrouted.length > 0; pass++) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    // Net yang gagal didahulukan pada percobaan berikutnya.
    order = [...order.filter((j) => latest.failed.has(j.name)), ...order.filter((j) => !latest.failed.has(j.name))];
    latest = routeOnce(board, order, loose);
    if (latest.unrouted.length < best.unrouted.length) best = latest;
  }
  return { tracks: best.tracks, vias: best.vias, unrouted: best.unrouted };
}
