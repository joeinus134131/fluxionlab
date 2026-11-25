import assert from "node:assert/strict";
import { test } from "node:test";
import { fitView, rotateAngle, zoomView } from "@/lib/pcb-view";

test("tampilan pas layar memuat papan dan menukar sisi saat diputar", () => {
  assert.deepEqual(fitView(50, 30, 0), { x: -4, y: -4, w: 58, h: 38 });
  const turned = fitView(50, 30, 90);
  assert.deepEqual([turned.w, turned.h], [38, 58]);
  // Titik tengah papan tetap di tengah tampilan.
  assert.deepEqual([turned.x + turned.w / 2, turned.y + turned.h / 2], [25, 15]);
});

test("zoom mempertahankan titik di bawah kursor", () => {
  const fitted = fitView(50, 30, 0);
  const at = { x: 10, y: 20 };
  const zoomed = zoomView(fitted, at, 2, fitted);
  assert.equal(zoomed.w, fitted.w / 2);
  assert.ok(Math.abs((at.x - zoomed.x) / zoomed.w - (at.x - fitted.x) / fitted.w) < 1e-9);
  assert.ok(Math.abs((at.y - zoomed.y) / zoomed.h - (at.y - fitted.y) / fitted.h) < 1e-9);
});

test("zoom dibatasi dan menjaga perbandingan sisi", () => {
  const fitted = fitView(50, 30, 0);
  const center = { x: 25, y: 15 };
  for (const factor of [1e6, 1e-6]) {
    const view = zoomView(fitted, center, factor, fitted);
    assert.ok(view.w >= 4 && view.w <= fitted.w * 4);
    assert.ok(Math.abs(view.w / view.h - fitted.w / fitted.h) < 1e-9);
  }
});

test("putaran tampilan berputar penuh ke dua arah", () => {
  assert.equal(rotateAngle(0, -90), 270);
  assert.equal(rotateAngle(270, 90), 0);
});
