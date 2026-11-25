"use client";

import { useState } from "react";
import { CLAUDE_MODELS } from "@/lib/models";
import type { PublicSettings } from "@/lib/settings";
import { inputClass } from "../studio/studio";

const CHOICE_KEY = "fluxion.model";
const DEFAULT_CHOICE = "claude:claude-opus-5-5";

/** Pilihan model AI, dipakai bersama oleh studio 3D dan desain PCB. Hanya untuk komponen yang dirender di browser. */
export function useModelChoice(settings: PublicSettings | null) {
  // Pilihan model diingat di browser (hanya nama model, bukan kunci).
  const [saved, setSaved] = useState(() => localStorage.getItem(CHOICE_KEY) ?? DEFAULT_CHOICE);
  const choices = [
    ...CLAUDE_MODELS.map((model) => ({ value: `claude:${model}`, label: model })),
    ...(settings?.connections ?? []).map((c) => ({ value: `compatible:${c.id}`, label: `${c.name} · ${c.model}` })),
  ];
  // Bila koneksi yang dipilih sudah dihapus, kembali ke model bawaan.
  const choice = !settings || choices.some((c) => c.value === saved) ? saved : DEFAULT_CHOICE;
  const [provider, model] = choice.split(/:(.*)/);
  return {
    choice,
    choices,
    request: { provider, model },
    missingKey: choice.startsWith("claude:") && settings !== null && !settings.claude.hasKey,
    select(value: string) {
      setSaved(value);
      localStorage.setItem(CHOICE_KEY, value);
    },
  };
}

export function ModelSelect({
  model,
  onOpenSettings,
}: {
  model: ReturnType<typeof useModelChoice>;
  onOpenSettings: () => void;
}) {
  return (
    <>
      <label className="block text-sm">
        Model
        <select
          className={`${inputClass} mt-1 bg-background`}
          value={model.choice}
          onChange={(e) => model.select(e.target.value)}
        >
          {model.choices.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="text-sm underline opacity-70" onClick={onOpenSettings}>
        {model.missingKey ? "Isi API key Claude di Pengaturan" : "Atur API key dan model lain"}
      </button>
    </>
  );
}
