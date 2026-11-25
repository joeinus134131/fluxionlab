"use client";

import { netWidth, type Board, type BoardOperation, type Component } from "@/lib/pcb";
import type { Analysis } from "@/lib/pcb-analysis";
import { billOfMaterials } from "@/lib/pcb-export";
import { buttonClass, inputClass } from "../components/ui";

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

export function CheckPanel({ board, analysis, checking }: { board: Board; analysis: Analysis; checking: boolean }) {
  const { issues } = analysis;
  const bom = billOfMaterials(board);
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Pemeriksaan</h3>
        {board.components.length === 0 ? (
          <p className="text-sm opacity-60">Belum ada desain.</p>
        ) : checking ? (
          <p className="text-sm opacity-60">Menghitung jalur dan memeriksa…</p>
        ) : issues.length === 0 ? (
          <p className="text-sm text-emerald-500">
            Lolos cek tata letak, netlist, sambungan, dan DRC jarak tembaga.
          </p>
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

const WIDTHS = [0.3, 0.4, 0.5, 0.8, 1, 1.5, 2];

export function NetPanel({ board, send }: { board: Board; send: (operation: BoardOperation) => void }) {
  if (board.nets.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Lebar jalur per net</h3>
      <ul className="space-y-1">
        {board.nets.map((net, index) => {
          const current = netWidth(board, net);
          return (
            <li key={`${net.name}-${index}`} className="flex items-center gap-2 text-sm">
              <span className="mr-auto truncate" title={net.pins.join(", ")}>
                {net.name}
              </span>
              <select
                aria-label={`Lebar jalur net ${net.name}`}
                className="w-28 shrink-0 rounded-md border border-current/20 bg-background px-2 py-1 text-sm"
                value={net.width && current > board.trackWidth ? current : 0}
                onChange={(e) => {
                  const width = Number(e.target.value);
                  const nets = board.nets.map((n, i) => (i === index ? { ...n, width } : n));
                  send({ op: "replace", board: { ...board, nets } });
                }}
              >
                <option value={0}>Dasar</option>
                {[...new Set([...WIDTHS, current])]
                  .filter((width) => width > board.trackWidth)
                  .sort((a, b) => a - b)
                  .map((width) => (
                    <option key={width} value={width}>
                      {width} mm
                    </option>
                  ))}
              </select>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type SizeProps = { board: Board; send: (operation: BoardOperation) => void };

export function BoardSettings({ board, send }: SizeProps) {
  return (
    <form
      // Isi form diatur ulang saat ukuran berubah dari mana pun.
      key={`${board.name}|${board.width}|${board.height}`}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        send({
          op: "rules",
          rules: { name: String(data.get("name")), width: Number(data.get("width")), height: Number(data.get("height")) },
        });
      }}
    >
      <h3 className="text-sm font-semibold">Papan</h3>
      <label className="block text-sm">
        Nama
        <input name="name" className={`${inputClass} mt-1`} required maxLength={120} defaultValue={board.name} />
      </label>
      <div className="flex gap-2">
        {(["width", "height"] as const).map((field) => (
          <label key={field} className="block text-sm">
            {field === "width" ? "Lebar (mm)" : "Tinggi (mm)"}
            <input
              name={field}
              type="number"
              step="any"
              min={10}
              max={150}
              required
              className={`${inputClass} mt-1`}
              defaultValue={board[field]}
            />
          </label>
        ))}
      </div>
      <button className={buttonClass}>Terapkan</button>
    </form>
  );
}
