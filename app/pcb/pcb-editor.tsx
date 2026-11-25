"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkBoard, EMPTY_BOARD, type BoardOperation, type BoardState } from "@/lib/pcb";
import { productionFiles, zip } from "@/lib/pcb-export";
import { routeBoard } from "@/lib/pcb-router";
import type { PublicSettings } from "@/lib/settings";
import { SettingsPanel } from "../studio/settings-panel";
import { buttonClass, inputClass } from "../studio/studio";
import { download } from "../studio/three-utils";
import { PcbAiPanel } from "./ai-panel";
import BoardView, { type Layers } from "./board-view";
import { CheckPanel, ComponentPanel, rotated } from "./info-panels";

const TABS = [
  ["ai", "AI"],
  ["components", "Komponen"],
  ["check", "Cek"],
  ["settings", "Pengaturan"],
] as const;

const LAYERS = [
  ["top", "Atas (merah)"],
  ["bottom", "Bawah (biru)"],
  ["silk", "Silkscreen"],
] as const;

export default function PcbEditor() {
  const [state, setState] = useState<BoardState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("ai");
  const [layers, setLayers] = useState<Layers>({ top: true, bottom: true, silk: true });
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const versionRef = useRef(-1);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(setSettings)
      .catch(() => {});
  }, []);

  // Abaikan balasan lama yang datang belakangan.
  const accept = useCallback((next: BoardState) => {
    if (next.version <= versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
  }, []);

  // Polling ringan agar perubahan dari MCP atau aplikasi luar langsung terlihat.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/pcb?since=${versionRef.current}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        if (!stopped) {
          if (!data.unchanged) accept(data);
          setOffline(false);
        }
      } catch {
        if (!stopped) setOffline(true);
      }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [accept]);

  const send = useCallback(
    async (operation: BoardOperation) => {
      setError("");
      try {
        const response = await fetch("/api/pcb", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(operation),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        accept(data);
      } catch (caught) {
        setError((caught as Error).message || "Gagal menyimpan perubahan.");
      }
    },
    [accept],
  );

  // Routing dan cek dihitung ulang hanya saat papan berubah.
  const board = state?.board ?? EMPTY_BOARD;
  const routing = useMemo(() => routeBoard(board), [board]);
  const issues = useMemo(() => checkBoard(board), [board]);

  if (!state) {
    return <p className="p-8 text-sm">{offline ? "Tidak bisa memuat papan. Cek server." : "Memuat desain PCB…"}</p>;
  }

  const empty = board.components.length === 0;
  const active = board.components.find((c) => c.ref === selected);
  const problemCount = issues.length + routing.unrouted.length;
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
        <div
          className="relative h-[60vh] min-h-0 bg-[#15171c] outline-none lg:h-auto lg:flex-1"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey && active) send(rotated(active));
          }}
        >
          <BoardView
            board={board}
            routing={routing}
            layers={layers}
            selected={selected}
            onSelect={setSelected}
            onMove={({ ref, x, y, rotation }) => send({ op: "move", ref, x, y, rotation })}
          />
          {empty && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-200">
              Papan masih kosong. Tulis rangkaian yang diinginkan di tab AI.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-current/15 p-2">
          <span className="mr-auto px-1 text-xs opacity-60">
            {board.components.length} komponen · {board.nets.length} net · {routing.vias.length} via ·{" "}
            {routing.unrouted.length} belum tersambung{offline && " · koneksi ke server terputus"}
          </span>
          <label className="flex items-center gap-1 text-xs">
            Lebar jalur
            <select
              className={`${inputClass} w-auto bg-background`}
              value={board.trackWidth}
              disabled={empty}
              onChange={(e) => send({ op: "replace", board: { ...board, trackWidth: Number(e.target.value) } })}
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
          <button className={buttonClass} disabled={empty} onClick={exportGerber}>
            Ekspor Gerber (ZIP)
          </button>
        </div>
      </section>

      <aside className="flex min-h-0 flex-col border-current/15 lg:w-96 lg:border-l">
        <div className="flex border-b border-current/15" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`flex-1 border-b-2 py-2.5 text-sm ${tab === key ? "border-indigo-500 font-semibold" : "border-transparent opacity-60"}`}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "check" && problemCount > 0 && ` (${problemCount})`}
            </button>
          ))}
        </div>
        {error && <p className="m-3 rounded-md bg-red-500/15 p-2 text-sm text-red-500">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* Panel AI tetap terpasang agar prompt, review, dan prosesnya tidak hilang saat pindah tab. */}
          <div hidden={tab !== "ai"}>
            <PcbAiPanel
              settings={settings}
              version={state.version}
              empty={empty}
              issues={issues}
              unrouted={routing.unrouted}
              onResult={accept}
              onOpenSettings={() => setTab("settings")}
            />
          </div>
          {tab === "components" && (
            <ComponentPanel board={board} selected={selected} onSelect={setSelected} send={send} />
          )}
          {tab === "check" && <CheckPanel board={board} routing={routing} />}
          {tab === "settings" && <SettingsPanel settings={settings} onChange={setSettings} />}
        </div>
      </aside>
    </div>
  );
}
