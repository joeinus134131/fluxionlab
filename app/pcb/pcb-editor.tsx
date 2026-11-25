"use client";

import { useState } from "react";
import { EMPTY_BOARD, type BoardOperation, type BoardState, type Component } from "@/lib/pcb";
import { productionFiles, zip } from "@/lib/pcb-export";
import { historyShortcut, useDocument, useSettings, useShortcuts } from "../components/hooks";
import { buttonClass, inputClass, Tabs } from "../components/ui";
import { SettingsPanel } from "../studio/settings-panel";
import { download } from "../studio/three-utils";
import { PcbAiPanel } from "./ai-panel";
import BoardView, { type Layers } from "./board-view";
import { BoardSettings, CheckPanel, ComponentPanel, NetPanel, rotated } from "./info-panels";
import { useAnalysis } from "./use-analysis";

const TABS = [
  ["ai", "AI"],
  ["components", "Komponen"],
  ["check", "Cek"],
  ["settings", "Pengaturan"],
] as const;

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const LAYERS = [
  ["top", "Atas (merah)"],
  ["bottom", "Bawah (biru)"],
  ["silk", "Silkscreen"],
] as const;

export default function PcbEditor() {
  const { state, accept, send, error, setError, offline } = useDocument<BoardState, BoardOperation>("/api/pcb");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("ai");
  const [layers, setLayers] = useState<Layers>({ top: true, bottom: true, silk: true });
  const [settings, setSettings] = useSettings();

  // Routing dan DRC dihitung ulang di worker saat papan berubah.
  const board = state?.board ?? EMPTY_BOARD;
  const { analysis, pending } = useAnalysis(board);
  const { routing } = analysis;

  useShortcuts((event) => {
    const history = historyShortcut(event);
    if (history) {
      send({ op: history });
      return true;
    }
    const component = board.components.find((c) => c.ref === selected);
    if (!component || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key.toLowerCase() === "r") {
      send(rotated(component));
      return true;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      send({ op: "remove", ref: component.ref });
      return true;
    }
    if (event.key in NUDGE) {
      // Shift menggeser satu kisi 2,54 mm.
      const step = event.shiftKey ? 2.54 : 0.5;
      const [dx, dy] = NUDGE[event.key];
      const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value * 100) / 100));
      const moved: Component = {
        ...component,
        x: clamp(component.x + dx * step, board.width),
        y: clamp(component.y + dy * step, board.height),
      };
      send({ op: "move", ref: moved.ref, x: moved.x, y: moved.y, rotation: moved.rotation });
      return true;
    }
    return false;
  });

  if (!state) {
    return <p className="p-8 text-sm">{offline ? "Tidak bisa memuat papan. Cek server." : "Memuat desain PCB…"}</p>;
  }

  const empty = board.components.length === 0;
  const active = board.components.find((c) => c.ref === selected);
  const problemCount = pending ? 0 : analysis.issues.length;
  const fileName = board.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "pcb";

  const exportGerber = () => {
    if (
      problemCount > 0 &&
      !window.confirm(`Masih ada ${problemCount} masalah di tab Cek. Papan bisa jadi tidak berfungsi. Tetap ekspor?`)
    ) {
      return;
    }
    download(zip(productionFiles(board, routing)), `${fileName}-gerber.zip`, "application/zip");
  };

  const importJson = async (file: File) => {
    try {
      await send({ op: "replace", board: JSON.parse(await file.text()) });
    } catch {
      setError("File JSON tidak bisa dibaca.");
    }
  };

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)] lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-current/15 p-2">
          <strong className="mr-auto truncate px-1 text-sm">
            {board.name} · {board.width} × {board.height} mm
          </strong>
          {LAYERS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <button className={buttonClass} disabled={!active} onClick={() => active && send(rotated(active))}>
            Putar 90°
          </button>
        </div>
        <div className="relative h-[60vh] min-h-0 bg-[#15171c] lg:h-auto lg:flex-1">
          <BoardView
            board={board}
            routing={routing}
            stale={pending}
            layers={layers}
            selected={selected}
            onSelect={setSelected}
            onMove={({ ref, x, y, rotation }) => send({ op: "move", ref, x, y, rotation })}
          />
          {pending && !empty && (
            <p role="status" className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-zinc-100">
              Menghitung jalur…
            </p>
          )}
          {empty && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-200">
              Papan masih kosong. Tulis rangkaian yang diinginkan di tab AI.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-current/15 p-2">
          <span className="mr-auto px-1 text-xs opacity-60">
            {board.components.length} komponen · {board.nets.length} net · {routing.vias.length} via ·{" "}
            {pending ? "memeriksa…" : `${routing.unrouted.length} belum tersambung`}
            {offline && " · koneksi ke server terputus"}
          </span>
          <label className="flex items-center gap-1 text-xs">
            Lebar jalur
            <select
              className={`${inputClass} w-auto bg-background`}
              value={board.trackWidth}
              disabled={empty}
              onChange={(e) => send({ op: "rules", rules: { trackWidth: Number(e.target.value) } })}
            >
              {[...new Set([0.25, 0.3, 0.4, 0.5, 0.8, 1, board.trackWidth])]
                .sort((a, b) => a - b)
                .map((width) => (
                  <option key={width} value={width}>
                    {width} mm
                  </option>
                ))}
            </select>
          </label>
          <button className={buttonClass} onClick={() => send({ op: "undo" })}>
            Urungkan
          </button>
          <button className={buttonClass} onClick={() => send({ op: "redo" })}>
            Ulangi
          </button>
          <button className={buttonClass} disabled={empty} onClick={() => send({ op: "replace", board: EMPTY_BOARD })}>
            Kosongkan
          </button>
          <label className={`${buttonClass} cursor-pointer`}>
            Impor JSON
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importJson(file);
                event.target.value = "";
              }}
            />
          </label>
          <button
            className={buttonClass}
            disabled={empty}
            onClick={() => download(JSON.stringify(board, null, 2), `${fileName}.json`, "application/json")}
          >
            Ekspor JSON
          </button>
          <button className={buttonClass} disabled={empty || pending} onClick={exportGerber}>
            Ekspor Gerber (ZIP)
          </button>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-current/15 lg:w-96 lg:border-l">
        <Tabs
          label="Panel desain PCB"
          tabs={TABS.map(([key, label]) =>
            key === "check" && problemCount > 0 ? ([key, `${label} (${problemCount})`] as const) : ([key, label] as const),
          )}
          active={tab}
          onChange={setTab}
        />
        {error && <p role="alert" className="m-3 rounded-md bg-red-500/15 p-2 text-sm text-red-500">{error}</p>}
        <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* Panel AI tetap terpasang agar prompt, review, dan prosesnya tidak hilang saat pindah tab. */}
          <div hidden={tab !== "ai"}>
            <PcbAiPanel
              settings={settings}
              version={state.version}
              empty={empty}
              issues={pending ? [] : analysis.issues}
              checking={pending}
              onResult={accept}
              onOpenSettings={() => setTab("settings")}
            />
          </div>
          {tab === "components" && (
            <div className="space-y-6">
              <ComponentPanel board={board} selected={selected} onSelect={setSelected} send={send} />
              <BoardSettings board={board} send={send} />
              <NetPanel board={board} send={send} />
              <p className="text-xs opacity-60">
                Pintasan: R putar, Delete hapus, panah geser 0,5 mm (Shift 2,54 mm), ⌘/Ctrl+Z urungkan, tambah Shift
                untuk ulangi.
              </p>
            </div>
          )}
          {tab === "check" && <CheckPanel board={board} analysis={analysis} checking={pending} />}
          {tab === "settings" && <SettingsPanel settings={settings} onChange={setSettings} />}
        </div>
      </aside>
    </div>
  );
}
