"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SHAPES, type Operation, type SceneState } from "@/lib/scene";
import type { PublicSettings } from "@/lib/settings";
import { AiPanel } from "./ai-panel";
import { ConnectPanel } from "./connect-panel";
import { ObjectPanel } from "./object-panel";
import { SettingsPanel } from "./settings-panel";
import { exportScene, type ExportFormat } from "./three-utils";
import Viewer from "./viewer";

const TABS = [
  ["ai", "AI"],
  ["objects", "Objek"],
  ["connect", "Koneksi"],
  ["settings", "Pengaturan"],
] as const;

export const buttonClass =
  "rounded-md border border-current/20 px-3 py-1.5 text-sm hover:bg-current/10 disabled:opacity-40";
export const inputClass = "w-full rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm";

export default function Studio() {
  const [state, setState] = useState<SceneState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("ai");
  const [error, setError] = useState("");
  const [fitRequest, setFitRequest] = useState(0);
  const [offline, setOffline] = useState(false);
  const versionRef = useRef(-1);
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(setSettings)
      .catch(() => {});
  }, []);

  // Abaikan balasan lama yang datang belakangan.
  const accept = useCallback((next: SceneState) => {
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
        const response = await fetch(`/api/scene?since=${versionRef.current}`, { cache: "no-store" });
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
    async (operation: Operation) => {
      setError("");
      try {
        const response = await fetch("/api/scene", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(operation),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        accept(data);
        return data as SceneState;
      } catch (caught) {
        setError((caught as Error).message || "Gagal menyimpan perubahan.");
      }
    },
    [accept],
  );

  const importJson = async (file: File) => {
    try {
      await send({ op: "replace", scene: JSON.parse(await file.text()) });
    } catch {
      setError("File JSON tidak bisa dibaca.");
    }
  };

  if (!state) {
    return (
      <p className="p-8 text-sm">{offline ? "Tidak bisa memuat scene. Cek server." : "Memuat studio…"}</p>
    );
  }

  const { scene } = state;
  const empty = scene.objects.length === 0;

  const addShape = async (type: (typeof SHAPES)[number]) => {
    // Cari tempat kosong di sepanjang sumbu X agar objek baru tidak tertutup objek lain.
    let x = 0;
    const taken = () =>
      scene.objects.some((o) => o.type !== "plane" && Math.abs(o.position[0] - x) < 1 && Math.abs(o.position[2]) < 1);
    while (type !== "plane" && x < 900 && taken()) x += 1.5;
    const next = await send({
      op: "add",
      objects: [
        {
          name: type,
          type,
          position: [x, type === "plane" ? 0 : 0.5, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          color: "#8b9cf7",
          metalness: 0.1,
          roughness: 0.7,
        },
      ],
    });
    const added = next?.scene.objects.at(-1);
    if (added) setSelectedId(added.id);
  };

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-3.5rem)] lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-current/15 p-2">
          <strong className="mr-auto truncate px-1 text-sm">{scene.name}</strong>
          {SHAPES.map((type) => (
            <button
              key={type}
              className={buttonClass}
              onClick={() => addShape(type)}
            >
              + {type}
            </button>
          ))}
        </div>
        <div className="h-[60vh] min-h-0 lg:h-auto lg:flex-1">
          <Viewer
            fitRequest={fitRequest}
            scene={scene}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              if (id) setTab("objects");
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-current/15 p-2">
          <span className="mr-auto px-1 text-xs opacity-60">
            {scene.objects.length} objek{offline && " · koneksi ke server terputus"}
          </span>
          <button className={buttonClass} disabled={empty} onClick={() => setFitRequest((n) => n + 1)}>
            Pusatkan tampilan
          </button>
          <button className={buttonClass} onClick={() => send({ op: "undo" })}>
            Urungkan
          </button>
          <button
            className={buttonClass}
            disabled={empty}
            onClick={() => send({ op: "replace", scene: { name: "Scene baru", objects: [] } })}
          >
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
          {(["glb", "stl", "obj", "json"] as ExportFormat[]).map((format) => (
            <button
              key={format}
              className={buttonClass}
              disabled={empty}
              onClick={() => {
                setError("");
                exportScene(scene, format).catch((caught: Error) => setError(`Ekspor gagal. ${caught.message}`));
              }}
            >
              Ekspor {format.toUpperCase()}
            </button>
          ))}
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
            </button>
          ))}
        </div>
        {error && <p className="m-3 rounded-md bg-red-500/15 p-2 text-sm text-red-500">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* Panel AI tetap terpasang agar prompt dan prosesnya tidak hilang saat pindah tab. */}
          <div hidden={tab !== "ai"}>
            <AiPanel settings={settings} onResult={accept} onOpenSettings={() => setTab("settings")} />
          </div>
          {tab === "objects" && (
            <ObjectPanel scene={scene} selectedId={selectedId} onSelect={setSelectedId} send={send} />
          )}
          {tab === "connect" && <ConnectPanel />}
          {tab === "settings" && <SettingsPanel settings={settings} onChange={setSettings} />}
        </div>
      </aside>
    </div>
  );
}
