"use client";

import { useState } from "react";
import type { Operation, Scene, SceneObject } from "@/lib/scene";
import { buttonClass, inputClass } from "./studio";

type Props = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
  send: (operation: Operation) => void;
};

export function ObjectPanel({ scene, selectedId, onSelect, send }: Props) {
  const selected = scene.objects.find((object) => object.id === selectedId);
  if (scene.objects.length === 0) {
    return <p className="text-sm opacity-60">Belum ada objek. Buat lewat tab AI atau tombol di atas.</p>;
  }
  return (
    <div className="space-y-4">
      <ul className="max-h-56 overflow-y-auto rounded-md border border-current/15">
        {scene.objects.map((object) => (
          <li key={object.id}>
            <button
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${object.id === selectedId ? "bg-indigo-500/20" : "hover:bg-current/5"}`}
              onClick={() => onSelect(object.id)}
            >
              <span className="size-3 shrink-0 rounded-sm" style={{ background: object.color }} />
              <span className="truncate">{object.name}</span>
              <span className="ml-auto text-xs opacity-50">{object.type}</span>
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <Editor
          // Reset isi form ketika objek berubah dari mana pun.
          key={JSON.stringify(selected)}
          object={selected}
          send={send}
        />
      ) : (
        <p className="text-sm opacity-60">Pilih objek dari daftar atau klik di tampilan 3D.</p>
      )}
    </div>
  );
}

function Editor({ object, send }: { object: SceneObject; send: Props["send"] }) {
  const [draft, setDraft] = useState(object);

  const save = () => {
    const { id, ...patch } = draft;
    send({ op: "update", id, patch });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="block text-sm">
        Nama
        <input
          className={`${inputClass} mt-1`}
          required
          maxLength={80}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      {(
        [
          ["position", "Posisi"],
          ["rotation", "Rotasi (°)"],
          ["scale", "Skala"],
        ] as const
      ).map(([field, label]) => (
        <fieldset key={field} className="text-sm">
          <legend>{label}</legend>
          <div className="mt-1 flex gap-2">
            {(["X", "Y", "Z"] as const).map((axis, index) => (
              <input
                key={axis}
                aria-label={`${label} ${axis}`}
                className={inputClass}
                type="number"
                step="any"
                min={-1000}
                max={1000}
                required
                value={Number.isNaN(draft[field][index]) ? "" : draft[field][index]}
                onChange={(e) => {
                  const next: SceneObject["position"] = [...draft[field]];
                  next[index] = e.target.valueAsNumber;
                  setDraft({ ...draft, [field]: next });
                }}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <label className="flex items-center gap-2 text-sm">
        Warna
        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
      </label>
      {(["metalness", "roughness"] as const).map((field) => (
        <label key={field} className="block text-sm capitalize">
          {field}: {draft[field].toFixed(2)}
          <input
            className="w-full"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={draft[field]}
            onChange={(e) => setDraft({ ...draft, [field]: e.target.valueAsNumber })}
          />
        </label>
      ))}
      <div className="flex gap-2">
        <button className="flex-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white">Terapkan</button>
        <button type="button" className={buttonClass} onClick={() => send({ op: "remove", ids: [object.id] })}>
          Hapus
        </button>
      </div>
    </form>
  );
}
