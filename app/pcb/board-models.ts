import * as THREE from "three";
import { placedPads, type Board, type Component, type PlacedPad } from "@/lib/pcb";
import { VIA_DRILL, VIA_SIZE, type Point, type Routing } from "@/lib/pcb-router";
import { PIN1_DOT, silkscreen, SILK_WIDTH, type Silk } from "@/lib/pcb-silk";
import type { Layers } from "./board-view";

// Model 3D papan. Sumbu: X papan = X, Y papan = Z, tinggi = Y. Permukaan atas di y = 0,
// titik tengah papan di titik asal. Bentuk komponen hanya ilustrasi, bukan ukuran mekanis presisi.

export const THICKNESS = 1.6;

const COLORS = {
  board: "#12573a",
  top: "#e5484d",
  bottom: "#3b82f6",
  pad: "#d4a73c",
  hole: "#0b0d10",
  silk: "#e8efe9",
  via: "#cbd5e1",
  ratsnest: "#facc15",
  black: "#1c1f24",
  tan: "#b99a6b",
  metal: "#c3c9d1",
  led: "#ef4444",
  can: "#31456b",
};

const material = (color: string, options: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, ...options });

function add(parent: THREE.Object3D, geometry: THREE.BufferGeometry, paint: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geometry, paint);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cylinder = (radius: number, height: number) => new THREE.CylinderGeometry(radius, radius, height, 24);

/** Ruas pipih (jalur atau garis silkscreen) di ketinggian `y`. */
function strip(parent: THREE.Object3D, a: Point, b: Point, width: number, y: number, paint: THREE.Material) {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const mesh = add(parent, box(Math.hypot(dx, dz), 0.05, width), paint, (a.x + b.x) / 2, y, (a.y + b.y) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
}

/** Badan komponen, relatif terhadap titik tengah komponen. */
function body(group: THREE.Group, component: Component, pads: PlacedPad[]) {
  const name = component.footprint;
  const local = pads.map((pad) => ({ ...pad, x: pad.x - component.x, y: pad.y - component.y }));
  const xs = local.map((p) => p.x);
  const ys = local.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...ys) - Math.min(...ys);
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midZ = (Math.max(...ys) + Math.min(...ys)) / 2;
  const turned = component.rotation % 180 !== 0;
  /** Ukuran yang ditulis untuk rotasi 0, ditukar bila komponen diputar 90/270. */
  const slab = (w: number, h: number, d: number, color: string, y = h / 2) =>
    add(group, box(turned ? d : w, h, turned ? w : d), material(color), midX, y, midZ);

  if (name === "MOUNTING_HOLE_M3") return;
  if (name === "0603" || name === "0805" || name === "1206") {
    const [w, d] = name === "0603" ? [1.6, 0.8] : name === "0805" ? [2, 1.25] : [3.2, 1.6];
    slab(w, 0.55, d, component.ref.startsWith("C") ? COLORS.tan : component.ref.startsWith("D") ? COLORS.led : COLORS.black);
  } else if (name.startsWith("DIP-") || name.startsWith("SOIC-")) {
    const dip = name.startsWith("DIP-");
    const along = turned ? spanX : spanZ;
    const across = turned ? spanZ : spanX;
    const height = dip ? 3.2 : 1.5;
    slab(across - (dip ? 1.4 : 1.6), height, along + (dip ? 2.2 : 1), COLORS.black, height / 2 + (dip ? 0.5 : 0.15));
    for (const pad of local) add(group, box(0.45, dip ? 1.6 : 0.4, 0.45), material(COLORS.metal), pad.x, dip ? 0.8 : 0.2, pad.y);
    const first = local[0];
    add(group, cylinder(0.35, 0.08), material(COLORS.silk), first.x * 0.5, height + (dip ? 0.52 : 0.17), first.y * 0.8);
  } else if (name.startsWith("PINHEADER-")) {
    add(group, box(spanX + 2.3, 2.5, spanZ + 2.3), material(COLORS.black), midX, 1.25, midZ);
    for (const pad of local) add(group, box(0.64, 8.5, 0.64), material(COLORS.pad, { metalness: 0.7 }), pad.x, 4.25, pad.y);
  } else if (name === "LED_5MM") {
    const paint = material(COLORS.led, { transparent: true, opacity: 0.85 });
    add(group, cylinder(2.2, 4.5), paint, midX, 3.2, midZ);
    add(group, new THREE.SphereGeometry(2.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint.clone(), midX, 5.45, midZ);
  } else if (name === "RADIAL") {
    add(group, cylinder(2, 6), material(COLORS.can), midX, 3.4, midZ);
    add(group, cylinder(1.8, 0.1), material(COLORS.metal), midX, 6.45, midZ);
  } else if (name === "AXIAL") {
    const shape = add(group, cylinder(1.2, 6.3), material(COLORS.tan), midX, 1.5, midZ);
    // Silinder tegak direbahkan searah kedua kakinya.
    if (spanX >= spanZ) shape.rotation.z = Math.PI / 2;
    else shape.rotation.x = Math.PI / 2;
    for (const pad of local) strip(group, { x: midX, y: midZ }, pad, 0.5, 1.5, material(COLORS.metal));
  } else if (name === "TO92") {
    add(group, cylinder(1.9, 4.5), material(COLORS.black), midX, 4, midZ);
  } else if (name === "TO220") {
    slab(10, 9, 4.2, COLORS.black, 6);
    slab(10, 6, 1.3, COLORS.metal, 13.5);
  } else if (name === "SOT23") {
    slab(2.9, 1, 1.4, COLORS.black, 0.6);
  } else if (name === "SOT223") {
    slab(6.5, 1.6, 3.5, COLORS.black, 0.9);
  } else if (name === "TACT_6MM") {
    slab(6, 3.2, 6, COLORS.metal);
    add(group, cylinder(1.7, 1.6), material(COLORS.black), midX, 4, midZ);
  }
}

function componentGroup(component: Component, silk: Silk, layers: Layers) {
  const group = new THREE.Group();
  group.userData.ref = component.ref;
  const pads = placedPads(component);
  const center = { x: component.x, y: component.y };
  const local = (p: Point) => ({ x: p.x - center.x, y: p.y - center.y });

  const gold = material(COLORS.pad, { metalness: 0.6, roughness: 0.4 });
  const hole = material(COLORS.hole);
  for (const pad of pads) {
    const { x, y } = local(pad);
    if (pad.plated) {
      for (const level of pad.drill > 0 ? [0.04, -THICKNESS - 0.04] : [0.04]) {
        add(group, pad.round ? cylinder(pad.w / 2, 0.06) : box(pad.w, 0.06, pad.h), gold, x, level, y);
      }
    }
    if (pad.drill > 0) add(group, cylinder(pad.drill / 2, THICKNESS + 0.18), hole, x, -THICKNESS / 2, y);
  }

  if (layers.silk) {
    const white = material(COLORS.silk);
    for (const line of [silk.outline, ...silk.texts]) {
      line.slice(1).forEach((point, i) => strip(group, local(line[i]), local(point), SILK_WIDTH, 0.06, white));
    }
    if (silk.pin1) {
      const { x, y } = local(silk.pin1);
      add(group, cylinder(PIN1_DOT / 2, 0.05), white, x, 0.06, y);
    }
  }

  body(group, component, pads);
  group.position.set(center.x, 0, center.y);
  return group;
}

export function buildBoardModel(board: Board, routing: Routing, layers: Layers, stale: boolean) {
  const root = new THREE.Group();
  // Koordinat papan (0..lebar) digeser agar titik tengah papan ada di titik asal.
  const flat = new THREE.Group();
  flat.position.set(-board.width / 2, 0, -board.height / 2);
  root.add(flat);

  add(flat, box(board.width, THICKNESS, board.height), material(COLORS.board), board.width / 2, -THICKNESS / 2, board.height / 2);

  const faded = stale ? { transparent: true, opacity: 0.25 } : {};
  const copper = [material(COLORS.top, faded), material(COLORS.bottom, faded)];
  for (const track of routing.tracks) {
    if (!(track.layer === 0 ? layers.top : layers.bottom)) continue;
    const level = track.layer === 0 ? 0.02 : -THICKNESS - 0.02;
    track.points.forEach((point, i) => {
      add(flat, cylinder(track.width / 2, 0.05), copper[track.layer], point.x, level, point.y);
      if (i > 0) strip(flat, track.points[i - 1], point, track.width, level, copper[track.layer]);
    });
  }
  for (const via of routing.vias) {
    add(flat, cylinder(VIA_SIZE / 2, THICKNESS + 0.12), material(COLORS.via, faded), via.x, -THICKNESS / 2, via.y);
    add(flat, cylinder(VIA_DRILL / 2, THICKNESS + 0.14), material(COLORS.hole, faded), via.x, -THICKNESS / 2, via.y);
  }
  if (!stale) {
    const yellow = material(COLORS.ratsnest, { emissive: COLORS.ratsnest, emissiveIntensity: 0.6 });
    for (const missing of routing.unrouted) strip(flat, missing.a, missing.b, 0.2, 0.2, yellow);
  }

  const silk = silkscreen(board);
  const components = board.components.map((component, i) => {
    const group = componentGroup(component, silk[i], layers);
    flat.add(group);
    return group;
  });
  return { root, components };
}

export function disposeModel(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  });
}

/** Sorot satu komponen. Material yang dipakai bersama hanya dibagi di dalam satu komponen. */
export function highlight(components: THREE.Group[], ref: string | null) {
  for (const group of components) {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        (child.material as THREE.MeshStandardMaterial).emissive.set(group.userData.ref === ref ? "#3b4fd8" : "#000000");
      }
    });
  }
}
