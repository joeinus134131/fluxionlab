"use client";

import { useState } from "react";
import { SHAPES, type Operation, type SceneState } from "@/lib/scene";
import { ConversationPanel, useConversations } from "../components/conversations";
import { historyShortcut, useDocument, useSettings, useShortcuts } from "../components/hooks";
import { buttonClass, Tabs } from "../components/ui";
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

export default function Studio() {
  const { state, accept, send, error, setError, offline } = useDocument<SceneState, Operation>("/api/scene");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("ai");
  const [fitRequest, setFitRequest] = useState(0);
  const [settings, setSettings] = useSettings();
  const conversations = useConversations("scene", state?.version, accept);
  const [aiBusy, setAiBusy] = useState(false);

  useShortcuts((event) => {
    const history = historyShortcut(event);
    if (history) {
      send({ op: history });
      return true;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state?.scene.objects.some((o) => o.id === selectedId)) {
      send({ op: "remove", ids: [selectedId!] });
      return true;
    }
    return false;
  });

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
            onMove={(id, position) => send({ op: "update", id, patch: { position } })}
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
          <button className={buttonClass} onClick={() => send({ op: "redo" })}>
            Ulangi
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
        <Tabs label="Panel studio" tabs={TABS} active={tab} onChange={setTab} />
        {error && <p role="alert" className="m-3 rounded-md bg-red-500/15 p-2 text-sm text-red-500">{error}</p>}
        <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* Panel AI tetap terpasang agar prompt dan prosesnya tidak hilang saat pindah tab. */}
          <div hidden={tab !== "ai"}>
            <ConversationPanel conversations={conversations} locked={aiBusy} />
            {/* Ganti percakapan mengosongkan prompt dan lampiran. */}
            <AiPanel
              key={conversations.view?.activeId}
              settings={settings}
              conversationId={conversations.view?.activeId}
              onBusyChange={setAiBusy}
              onResult={accept}
              onOpenSettings={() => setTab("settings")}
            />
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
