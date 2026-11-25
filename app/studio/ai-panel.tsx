"use client";

import { useRef, useState } from "react";
import type { SceneState } from "@/lib/scene";
import type { PublicSettings } from "@/lib/settings";
import { AttachmentBar, AttachmentZone, useAttachments } from "../components/attachments";
import { ModelSelect, useModelChoice } from "../components/model-select";
import { buttonClass, inputClass } from "../components/ui";

const EXAMPLES = [
  "Buat rumah kecil dengan atap, pintu, jendela, dan dua pohon",
  "Desain meja kerja minimalis dengan monitor, keyboard, dan lampu",
  "Buat robot lucu berwarna biru",
];

type Props = {
  settings: PublicSettings | null;
  onResult: (state: SceneState) => void;
  onOpenSettings: () => void;
};

export function AiPanel({ settings, onResult, onOpenSettings }: Props) {
  const model = useModelChoice(settings);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachments = useAttachments();
  const canSend = !busy && !attachments.processing && (prompt.trim() !== "" || attachments.items.length > 0);

  const generate = async () => {
    const sent = attachments.items;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, attachments: sent, ...model.request }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onResult(data);
      setPrompt("");
      attachments.removeSent(sent);
      setMessage({ text: "Desain diterapkan. Tulis lagi untuk merevisinya.", failed: false });
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? { text: "Dibatalkan.", failed: false }
          : { text: (error as Error).message || "Gagal membuat desain.", failed: true },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AttachmentZone attachments={attachments}>
      <ModelSelect model={model} onOpenSettings={onOpenSettings} />
      <label className="block text-sm">
        Deskripsikan desain atau perubahan yang diinginkan
        <textarea
          className={`${inputClass} mt-1 min-h-32`}
          value={prompt}
          maxLength={4000}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) generate();
          }}
          placeholder="Contoh: tambahkan pagar di sekeliling rumah"
        />
      </label>
      <AttachmentBar attachments={attachments} />
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          disabled={!canSend}
          onClick={generate}
        >
          {busy ? "AI sedang mendesain…" : "Buat dengan AI"}
        </button>
        {busy && (
          <button className={buttonClass} onClick={() => abortRef.current?.abort()}>
            Batal
          </button>
        )}
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.failed ? "text-red-500" : "opacity-70"}`}>
          {message.text}
        </p>
      )}
      <div className="space-y-2 pt-2">
        <p className="text-xs opacity-60">Contoh</p>
        {EXAMPLES.map((example) => (
          <button key={example} className={`${buttonClass} block w-full text-left`} onClick={() => setPrompt(example)}>
            {example}
          </button>
        ))}
      </div>
    </AttachmentZone>
  );
}
