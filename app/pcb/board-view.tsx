"use client";

import { useRef, useState } from "react";
import { courtyard, placedPads, type Board, type Component } from "@/lib/pcb";
import { VIA_DRILL, VIA_SIZE, type Routing } from "@/lib/pcb-router";
import { PIN1_DOT, silkscreen, SILK_WIDTH } from "@/lib/pcb-silk";

export type Layers = { top: boolean; bottom: boolean; silk: boolean };

const COLORS = { top: "#e5484d", bottom: "#3b82f6", pad: "#d4a73c", board: "#0f3d2a", silk: "#e8efe9" };
const SNAP = 0.5;

type Props = {
  board: Board;
  routing: Routing;
  /** Jalur masih milik papan sebelumnya. */
  stale: boolean;
  layers: Layers;
  selected: string | null;
  onSelect: (ref: string | null) => void;
  onMove: (component: Component) => void;
};

type Drag = { ref: string; offsetX: number; offsetY: number; x: number; y: number; moved: boolean };

export default function BoardView({ board, routing, stale, layers, selected, onSelect, onMove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Posisi pointer dalam milimeter papan.
  const toBoard = (event: React.PointerEvent) => {
    const matrix = svgRef.current!.getScreenCTM()!.inverse();
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
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none"
      viewBox={`-4 -4 ${board.width + 8} ${board.height + 8}`}
      role="img"
      aria-label={`Tata letak PCB ${board.name}`}
      onPointerDown={() => onSelect(null)}
    >
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
              event.stopPropagation();
              onSelect(component.ref);
              if (event.button !== 0) return;
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
              const at = toBoard(event);
              const clamp = (value: number, max: number) =>
                Math.min(max, Math.max(0, Math.round(value / SNAP) * SNAP));
              const x = clamp(at.x - drag.offsetX, board.width);
              const y = clamp(at.y - drag.offsetY, board.height);
              // Klik tanpa geser tidak memindahkan komponen yang posisinya di luar kelipatan snap.
              const far = Math.hypot(at.x - drag.offsetX - component.x, at.y - drag.offsetY - component.y) > SNAP / 2;
              if (drag.moved || far) setDrag({ ...drag, x, y, moved: true });
            }}
            onPointerUp={() => {
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
    </svg>
  );
}
