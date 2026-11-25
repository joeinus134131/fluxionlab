// Hitungan posisi saat objek diseret di studio 3D.

type Vec3 = [number, number, number];

/** Batas posisi menurut skema scene. */
const LIMIT = 1000;

/**
 * Posisi baru setelah digeser sejauh `delta` dari `origin`.
 * Yang dibulatkan ke kelipatan `step` adalah geserannya, sehingga posisi asal
 * yang tidak pas di kisi tetap terjaga dan sumbu yang tidak digeser tidak berubah.
 */
export function draggedPosition(origin: Vec3, delta: Vec3, step: number): Vec3 {
  return origin.map((value, axis) => {
    const snapped = Math.round(delta[axis] / step) * step;
    if (snapped === 0) return value;
    const moved = Math.round((value + snapped) * 1e6) / 1e6;
    return Math.min(LIMIT, Math.max(-LIMIT, moved));
  }) as Vec3;
}
