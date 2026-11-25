import assert from "node:assert/strict";
import { test } from "node:test";
import { draggedPosition } from "@/lib/scene-drag";

test("geseran dibulatkan, posisi asal di luar kisi tetap terjaga", () => {
  assert.deepEqual(draggedPosition([0.55, 0.5, -2], [0.24, 0, -0.27], 0.1), [0.75, 0.5, -2.3]);
});

test("geseran sangat kecil tidak mengubah posisi", () => {
  assert.deepEqual(draggedPosition([1.2345678, 0, 3], [0.04, -0.04, 0], 0.1), [1.2345678, 0, 3]);
});

test("posisi dibatasi sesuai skema scene", () => {
  assert.deepEqual(draggedPosition([999, 0, -999], [50, 0, -50], 1), [1000, 0, -1000]);
});
