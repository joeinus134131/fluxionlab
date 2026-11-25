"use client";

import { useEffect, useRef, useState } from "react";
import { courtyard, placedPads, type Board, type Component } from "@/lib/pcb";
import { VIA_DRILL, VIA_SIZE, type Routing } from "@/lib/pcb-router";
import { PIN1_DOT, silkscreen, SILK_WIDTH } from "@/lib/pcb-silk";
import { fitView, rotateAngle, zoomView, type Angle, type ViewBox } from "@/lib/pcb-view";
import { ViewButton, ViewControls } from "../components/view-controls";

export type Layers = { top: boolean; bottom: boolean; silk: boolean };

const COLORS = { top: "#e5484d", bottom: "#3b82f6", pad: "#d4a73c", board: "#0f3d2a", silk: "#e8efe9" };
const SNAP = 0.5;

export type BoardViewProps = {
  board: Board;
  routing: Routing;
  /** Jalur masih milik papan sebelumnya. */
  stale: boolean;
  layers: Layers;
  selected: string | null;
  onSelect: (ref: string | null) => void;
  /** Hasil Promise `undefined` berarti perpindahan gagal disimpan. */
  onMove: (component: Component) => void | Promise<unknown>;
};

type Drag = { ref: string; offsetX: number; offsetY: number; x: number; y: number; moved: boolean };

export default function BoardView({ board, routing, stale, layers, selected, onSelect, onMove }: BoardViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boardRef = useRef<SVGGElement>(null);
  const [angle, setAngle] = useState<Angle>(0);
  // Tampilan hasil geser/zoom. Tidak dipakai lagi bila ukuran papan atau orientasi berubah.
  const viewKey = `${board.width}x${board.height}@${angle}`;
  const [custom, setCustom] = useState<{ key: string; view: ViewBox } | null>(null);
  const fitted = fitView(board.width, board.height, angle);
  const view = custom?.key === viewKey ? custom.view : fitted;
  // Jari atau tombol mouse yang sedang menggeser latar, dan apakah sudah bergerak.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panned = useRef(false);

  /** Titik layar menjadi koordinat viewBox (belum diputar). */
  const toView = (clientX: number, clientY: number) =>
    new DOMPoint(clientX, clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());

  const zoom = (factor: number, at = { x: view.x + view.w / 2, y: view.y + view.h / 2 }) =>
    setCustom({ key: viewKey, view: zoomView(view, at, factor, fitted) });

  // Roda mouse dipasang manual karena harus bisa mencegah halaman ikut bergulir.
  const wheelRef = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelRef.current = (event) => {
      event.preventDefault();
      // Cubit di trackpad datang sebagai roda + ctrl dengan nilai yang jauh lebih kecil.
      const speed = event.ctrlKey ? 0.01 : event.deltaMode === 1 ? 0.05 : 0.0015;
      zoom(Math.exp(-event.deltaY * speed), toView(event.clientX, event.clientY));
    };
  });
  useEffect(() => {
    const svg = svgRef.current!;
    const listen = (event: WheelEvent) => wheelRef.current(event);
    svg.addEventListener("wheel", listen, { passive: false });
    return () => svg.removeEventListener("wheel", listen);
  }, []);

  const startPan = (event: React.PointerEvent) => {
    if (pointers.current.size === 0) panned.current = false;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  // Satu pointer menggeser; dua jari sekaligus menggeser dan mencubit.
  const movePan = (event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = { x: event.clientX, y: event.clientY };
    if (!panned.current && Math.hypot(current.x - previous.x, current.y - previous.y) < 3) return;
    panned.current = true;
    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, current);
    const middle = (point: { x: number; y: number }) =>
      other ? { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 } : point;
    const from = toView(middle(previous).x, middle(previous).y);
    const to = toView(middle(current).x, middle(current).y);
    let next = { ...view, x: view.x + from.x - to.x, y: view.y + from.y - to.y };
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(current.x - other.x, current.y - other.y);
      if (before > 0 && after > 0) next = zoomView(next, from, after / before, fitted);
    }
    setCustom({ key: viewKey, view: next });
  };

  const endPan = (event: React.PointerEvent) => {
    if (!pointers.current.delete(event.pointerId)) return;
    // Klik latar tanpa geser membatalkan pilihan.
    if (event.type === "pointerup" && event.button === 0 && pointers.current.size === 0 && !panned.current) {
      onSelect(null);
    }
  };
  const [drag, setDrag] = useState<Drag | null>(null);

  // Posisi pointer dalam milimeter papan, sudah memperhitungkan putaran tampilan.
  const toBoard = (event: React.PointerEvent) => {
    const matrix = boardRef.current!.getScreenCTM()!.inverse();
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
  };

  const components = board.components.map((c) => (drag?.ref === c.ref ? { ...c, x: drag.x, y: drag.y } : c));
  const pads = components.flatMap(placedPads);
  const silk = silkscreen({ ...board, components });
  const faded = drag !== null || stale;
  const highlighted = new Set(pads.filter((pad) => pad.ref === selected).map((pad) => pad.id));
  const activeNets = new Set(
    board.nets.filter((net) => net.pins.some((pin) => highlighted.has(pin))).map((net) => net.name),
  );

  return (
    <div className="relative h-full w-full">
    <svg
      ref={svgRef}
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      role="img"
      aria-label={`Tata letak PCB ${board.name}`}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onContextMenu={(event) => event.preventDefault()}
    >
    <g ref={boardRef} transform={`rotate(${angle} ${board.width / 2} ${board.height / 2})`}>
      <rect width={board.width} height={board.height} rx={0.6} fill={COLORS.board} stroke="#7dd3a8" strokeWidth={0.2} />

      {([1, 0] as const).map(
        (layer) =>
          (layer === 0 ? layers.top : layers.bottom) && (
            <g key={layer} fill="none" strokeLinecap="round" strokeLinejoin="round">
              {routing.tracks
                .filter((track) => track.layer === layer)
                .map((track, i) => (
                  <polyline
                    key={i}
                    points={track.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    stroke={layer === 0 ? COLORS.top : COLORS.bottom}
                    strokeWidth={track.width}
                    opacity={faded ? 0.2 : activeNets.size === 0 || activeNets.has(track.net) ? 0.95 : 0.3}
                  />
                ))}
            </g>
          ),
      )}

      {routing.vias.map((via, i) => (
        <g key={i} opacity={faded ? 0.2 : 1}>
          <circle cx={via.x} cy={via.y} r={VIA_SIZE / 2} fill="#cbd5e1" />
          <circle cx={via.x} cy={via.y} r={VIA_DRILL / 2} fill="#111" />
        </g>
      ))}

      {pads.map((pad, i) => (
        <g key={i} pointerEvents="none">
          {pad.plated &&
            (pad.round ? (
              <circle cx={pad.x} cy={pad.y} r={pad.w / 2} fill={COLORS.pad} />
            ) : (
              <rect x={pad.x - pad.w / 2} y={pad.y - pad.h / 2} width={pad.w} height={pad.h} fill={COLORS.pad} />
            ))}
          {pad.drill > 0 && <circle cx={pad.x} cy={pad.y} r={pad.drill / 2} fill="#111" />}
        </g>
      ))}

      {/* Ratsnest: sambungan yang belum berhasil diberi jalur. */}
      {!faded &&
        routing.unrouted.map((missing, i) => (
          <line
            key={i}
            x1={missing.a.x}
            y1={missing.a.y}
            x2={missing.b.x}
            y2={missing.b.y}
            stroke="#facc15"
            strokeWidth={0.2}
            strokeDasharray="0.8 0.5"
          />
        ))}

      {components.map((component, i) => {
        const box = courtyard(component);
        const active = component.ref === selected;
        const { texts, pin1 } = silk[i];
        const color = active ? "#a5b4fc" : COLORS.silk;
        return (
          <g
            key={`${component.ref}-${i}`}
            className="cursor-move"
            onPointerDown={(event) => {
              // Tombol tengah/kanan menggeser tampilan, juga bila dimulai di atas komponen.
              if (event.button !== 0) return;
              event.stopPropagation();
              onSelect(component.ref);
              const at = toBoard(event);
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({
                ref: component.ref,
                offsetX: at.x - component.x,
                offsetY: at.y - component.y,
                x: component.x,
                y: component.y,
                moved: false,
              });
            }}
            onPointerMove={(event) => {
              if (drag?.ref !== component.ref) return;
              event.stopPropagation();
              const at = toBoard(event);
              const clamp = (value: number, max: number) =>
                Math.min(max, Math.max(0, Math.round(value / SNAP) * SNAP));
              const x = clamp(at.x - drag.offsetX, board.width);
              const y = clamp(at.y - drag.offsetY, board.height);
              // Klik tanpa geser tidak memindahkan komponen yang posisinya di luar kelipatan snap.
              const far = Math.hypot(at.x - drag.offsetX - component.x, at.y - drag.offsetY - component.y) > SNAP / 2;
              if (drag.moved || far) setDrag({ ...drag, x, y, moved: true });
            }}
            onPointerUp={(event) => {
              if (drag?.ref === component.ref) event.stopPropagation();
              if (drag?.moved) onMove({ ...component, x: drag.x, y: drag.y });
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            <title>{`${component.ref} ${component.value} (${component.footprint})`}</title>
            <rect
              x={box.x1}
              y={box.y1}
              width={box.x2 - box.x1}
              height={box.y2 - box.y1}
              fill="transparent"
              stroke={active ? "#a5b4fc" : COLORS.silk}
              strokeWidth={active ? 0.35 : 0.15}
              opacity={layers.silk || active ? 1 : 0}
            />
            {layers.silk && (
              <g pointerEvents="none">
                {texts.map((line, n) => (
                  <polyline
                    key={n}
                    points={line.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth={SILK_WIDTH}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {pin1 && <circle cx={pin1.x} cy={pin1.y} r={PIN1_DOT / 2} fill={color} />}
              </g>
            )}
          </g>
        );
      })}
    </g>
    </svg>
      <ViewControls hint="Seret latar: geser · Roda/cubit: zoom · Seret komponen: pindah">
        <ViewButton label="Perbesar" onClick={() => zoom(1.25)}>
          +
        </ViewButton>
        <ViewButton label="Perkecil" onClick={() => zoom(0.8)}>
          −
        </ViewButton>
        <ViewButton label="Putar tampilan ke kiri" onClick={() => setAngle(rotateAngle(angle, -90))}>
          ⟲
        </ViewButton>
        <ViewButton label="Putar tampilan ke kanan" onClick={() => setAngle(rotateAngle(angle, 90))}>
          ⟳
        </ViewButton>
        <ViewButton
          label="Kembalikan tampilan"
          onClick={() => {
            setAngle(0);
            setCustom(null);
          }}
        >
          Pas layar
        </ViewButton>
      </ViewControls>
    </div>
  );
}
