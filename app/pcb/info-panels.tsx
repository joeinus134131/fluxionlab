"use client";

import { checkBoard, type Board, type BoardOperation, type Component, type Issue } from "@/lib/pcb";
import { billOfMaterials } from "@/lib/pcb-export";
import type { Routing } from "@/lib/pcb-router";
import { buttonClass } from "../studio/studio";

type ComponentProps = {
  board: Board;
  selected: string | null;
  onSelect: (ref: string) => void;
  send: (operation: BoardOperation) => void;
};

export const rotated = (component: Component): BoardOperation => ({
  op: "move",
  ref: component.ref,
  x: component.x,
  y: component.y,
  rotation: ((component.rotation + 90) % 360) as Component["rotation"],
});

export function ComponentPanel({ board, selected, onSelect, send }: ComponentProps) {
  if (board.components.length === 0) {
    return <p className="text-sm opacity-60">Belum ada komponen. Buat desain lewat tab AI atau MCP.</p>;
  }
  const component = board.components.find((c) => c.ref === selected);
  const nets = component ? board.nets.flatMap((net) =>
    net.pins
      .filter((pin) => pin.split(".")[0] === component.ref)
      .map((pin) => ({ pin: pin.split(".")[1], net: net.name })),
  ) : [];

  return (
    <div className="space-y-4">
      <ul className="max-h-64 overflow-y-auto rounded-md border border-current/15">
        {board.components.map((c, i) => (
          <li key={`${c.ref}-${i}`}>
            <button
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${c.ref === selected ? "bg-indigo-500/20" : "hover:bg-current/5"}`}
              onClick={() => onSelect(c.ref)}
            >
              <strong className="w-12 shrink-0">{c.ref}</strong>
              <span className="truncate">{c.value}</span>
              <span className="ml-auto text-xs opacity-50">{c.footprint}</span>
            </button>
          </li>
        ))}
      </ul>
      {component ? (
        <div className="space-y-2 text-sm">
          <p>
            <strong>{component.ref}</strong> di X {component.x} mm, Y {component.y} mm, rotasi {component.rotation}°
          </p>
          <ul className="grid grid-cols-2 gap-x-3 text-xs">
            {nets.map(({ pin, net }) => (
              <li key={`${pin}-${net}`}>
                Pin {pin}: {net}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className={buttonClass} onClick={() => send(rotated(component))}>
              Putar 90°
            </button>
            <button className={buttonClass} onClick={() => send({ op: "remove", ref: component.ref })}>
              Hapus
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm opacity-60">Pilih komponen dari daftar atau klik di papan. Seret untuk memindahkan.</p>
      )}
    </div>
  );
}

export function CheckPanel({ board, routing }: { board: Board; routing: Routing }) {
  const issues: Issue[] = [
    ...checkBoard(board),
    ...routing.unrouted.map((u) => ({
      level: "error" as const,
      message: `Belum tersambung: ${u.net} (${u.from} ke ${u.to}).`,
    })),
  ];
  const bom = billOfMaterials(board);
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Pemeriksaan</h3>
        {board.components.length === 0 ? (
          <p className="text-sm opacity-60">Belum ada desain.</p>
        ) : issues.length === 0 ? (
          <p className="text-sm text-emerald-500">Tidak ada masalah tata letak, netlist, atau sambungan.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {issues.map((issue, i) => (
              <li key={i} className={issue.level === "error" ? "text-red-500" : "text-amber-500"}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs opacity-60">
          Pemeriksaan ini tidak menilai benar tidaknya rangkaian. Cocokkan pinout dan nilai komponen dengan datasheet
          sebelum memesan papan.
        </p>
      </section>
      {board.notes && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Catatan desain</h3>
          <p className="whitespace-pre-wrap text-sm opacity-80">{board.notes}</p>
        </section>
      )}
      {bom.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Daftar komponen (BOM)</h3>
          <table className="w-full text-left text-xs">
            <thead className="opacity-60">
              <tr>
                <th className="py-1 font-medium">Referensi</th>
                <th className="font-medium">Nilai</th>
                <th className="font-medium">Footprint</th>
                <th className="text-right font-medium">Jml</th>
              </tr>
            </thead>
            <tbody>
              {bom.map((row) => (
                <tr key={row.refs[0]} className="border-t border-current/10 align-top">
                  <td className="py-1 pr-2">{row.refs.join(", ")}</td>
                  <td className="pr-2">{row.value}</td>
                  <td>{row.footprint}</td>
                  <td className="text-right">{row.refs.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
