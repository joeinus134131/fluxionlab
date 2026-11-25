"use client";

import { useRef, useState } from "react";
import type { BoardState, Issue } from "@/lib/pcb";
import type { Unrouted } from "@/lib/pcb-router";
import type { PublicSettings } from "@/lib/settings";
import { AttachmentBar, AttachmentZone, useAttachments } from "../components/attachments";
import { ModelSelect, useModelChoice } from "../components/model-select";
import { buttonClass, inputClass } from "../studio/studio";

const EXAMPLES = [
  "Buat lampu LED berkedip dengan NE555, suplai 9V lewat pin header",
  "Papan sensor suhu LM35 dengan konektor ke Arduino dan LED indikator daya",
  "Driver relay 5V dengan transistor, dioda flyback, dan LED status",
];

const primaryClass = "rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40";

type Props = {
  settings: PublicSettings | null;
  version: number;
  empty: boolean;
  issues: Issue[];
  unrouted: Unrouted[];
  onResult: (state: BoardState) => void;
  onOpenSettings: () => void;
};

type Task = "design" | "review" | "fix";

export function PcbAiPanel({ settings, version, empty, issues, unrouted, onResult, onOpenSettings }: Props) {
  const model = useModelChoice(settings);
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [review, setReview] = useState<{ text: string; version: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachments = useAttachments();
  const problems = [
    ...issues.map((issue) => issue.message),
    ...unrouted.map((u) => `Router gagal menyambung net ${u.net}: ${u.from} ke ${u.to}.`),
  ];

  const run = async (kind: Task, text: string) => {
    // Lampiran hanya ikut pada permintaan rancang, bukan review atau perbaiki.
    const sent = kind === "design" ? attachments.items : [];
    const controller = new AbortController();
    abortRef.current = controller;
    setTask(kind);
    setMessage(null);
    try {
      const body =
        kind === "review" ? { mode: "review" } : { mode: "design", prompt: text.slice(0, 4000), attachments: sent };
      const response = await fetch("/api/pcb/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, ...model.request }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (kind === "review") {
        setReview({ text: data.review, version: data.version });
        return;
      }
      onResult(data);
      if (kind === "design") setPrompt("");
      attachments.removeSent(sent);
      setMessage({ text: "Desain diterapkan. Periksa tab Cek sebelum diekspor.", failed: false });
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? { text: "Dibatalkan.", failed: false }
          : { text: (error as Error).message || "Gagal menghubungi AI.", failed: true },
      );
    } finally {
      setTask(null);
    }
  };

  const busy = task !== null;
  const canSend = !busy && !attachments.processing && (prompt.trim() !== "" || attachments.items.length > 0);

  return (
    <AttachmentZone attachments={attachments}>
      <ModelSelect model={model} onOpenSettings={onOpenSettings} />
      <label className="block text-sm">
        Deskripsikan rangkaian atau perubahan yang diinginkan
        <textarea
          className={`${inputClass} mt-1 min-h-28`}
          value={prompt}
          maxLength={4000}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) run("design", prompt);
          }}
          placeholder="Contoh: tambahkan LED indikator daya"
        />
      </label>
      <AttachmentBar attachments={attachments} />
      <button
        className={`${primaryClass} w-full`}
        disabled={!canSend}
        onClick={() => run("design", prompt)}
      >
        {task === "design" ? "AI sedang mendesain…" : "Rancang dengan AI"}
      </button>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy || empty} onClick={() => run("review", "")}>
          {task === "review" ? "Mereview…" : "Review dengan AI"}
        </button>
        <button
          className={buttonClass}
          disabled={busy || empty || problems.length === 0}
          onClick={() =>
            run(
              "fix",
              `Fix these problems. Prefer moving or rotating components, enlarging the board if needed, and keep the circuit function unchanged:\n${problems.join("\n")}`,
            )
          }
        >
          {task === "fix" ? "Memperbaiki…" : `Perbaiki masalah (${problems.length})`}
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
      {review && (
        <section className="rounded-md border border-current/15 p-3 text-sm">
          <h3 className="font-semibold">Review AI</h3>
          {review.version !== version && <p className="mt-1 text-xs text-amber-500">Papan sudah berubah sejak review ini.</p>}
          <p className="mt-2 whitespace-pre-wrap">{review.text}</p>
        </section>
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
