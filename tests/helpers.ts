import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import type { Board, Component } from "@/lib/pcb";

/** Pindah ke folder sementara agar test tidak menyentuh .data asli. Panggil sebelum mengimpor store. */
export function enterTemporaryDirectory() {
  const original = process.cwd();
  const directory = mkdtempSync(path.join(tmpdir(), "fluxion-test-"));
  process.chdir(directory);
  after(() => {
    process.chdir(original);
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

export const part = (
  ref: string,
  footprint: string,
  x: number,
  y: number,
  rotation: Component["rotation"] = 0,
): Component => ({ ref, value: footprint, footprint, x, y, rotation });

export const net = (name: string, pins: string[], width?: number) => ({ name, pins, ...(width ? { width } : {}) });

export const blinker: Board = {
  name: "NE555 blinker",
  width: 55,
  height: 40,
  trackWidth: 0.25,
  notes: "",
  components: [
    part("J1", "PINHEADER-2", 5, 20),
    part("U1", "DIP-8", 25, 20),
    part("R1", "0805", 16, 9),
    part("R2", "0805", 16, 31),
    part("C1", "RADIAL", 35, 31),
    part("C2", "0805", 35, 9),
    part("R3", "AXIAL", 42, 20, 90),
    part("D1", "LED_5MM", 50, 20, 90),
    part("H1", "MOUNTING_HOLE_M3", 50, 5),
  ],
  nets: [
    net("VCC", ["J1.1", "U1.8", "U1.4", "R1.1", "C2.1"], 0.6),
    net("GND", ["J1.2", "U1.1", "C1.2", "C2.2", "D1.1"], 0.6),
    net("DIS", ["R1.2", "U1.7", "R2.1"]),
    net("THR", ["R2.2", "U1.6", "U1.2", "C1.1"]),
    net("OUT", ["U1.3", "R3.1"]),
    net("LED", ["R3.2", "D1.2"]),
  ],
};
