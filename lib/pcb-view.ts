// Hitungan tampilan canvas PCB 2D: pas layar, zoom, dan geser. Satuan mm.

export type ViewBox = { x: number; y: number; w: number; h: number };
export type Angle = 0 | 90 | 180 | 270;

const MARGIN = 4;
const MIN_WIDTH = 4;
const MAX_ZOOM_OUT = 4;

/** Tampilan yang memuat seluruh papan, yang diputar `angle` derajat pada titik tengahnya. */
export function fitView(width: number, height: number, angle: Angle): ViewBox {
  const [across, down] = angle % 180 === 0 ? [width, height] : [height, width];
  const w = across + MARGIN * 2;
  const h = down + MARGIN * 2;
  return { x: width / 2 - w / 2, y: height / 2 - h / 2, w, h };
}

/** Perbesar (factor > 1) atau perkecil dengan titik `at` tetap di tempatnya pada layar. */
export function zoomView(view: ViewBox, at: { x: number; y: number }, factor: number, fitted: ViewBox): ViewBox {
  const w = Math.min(fitted.w * MAX_ZOOM_OUT, Math.max(MIN_WIDTH, view.w / factor));
  const k = w / view.w;
  return { x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k, w, h: view.h * k };
}

export const rotateAngle = (angle: Angle, by: 90 | -90) => ((angle + by + 360) % 360) as Angle;
