"use client";

import { useRef, useState } from "react";
import type { BoardState, Issue } from "@/lib/pcb";
import type { PublicSettings } from "@/lib/settings";
import { AttachmentBar, AttachmentZone, useAttachments } from "../components/attachments";
import { ModelSelect, useModelChoice } from "../components/model-select";
import { buttonClass, inputClass, primaryClass } from "../components/ui";

const EXAMPLES = [
  "Buat lampu LED berkedip dengan NE555, suplai 9V lewat pin header",
  "Papan sensor suhu LM35 dengan konektor ke Arduino dan LED indikator daya",
  "Driver relay 5V dengan transistor, dioda flyback, dan LED status",
];

type Props = {
  settings: PublicSettings | null;
  version: number;
  empty: boolean;
  issues: Issue[];
  /** true selama routing dan DRC untuk papan terbaru belum selesai. */
  checking: boolean;
  onResult: (state: BoardState) => void;
  onOpenSettings: () => void;
};

type Task = "design" | "review" | "fix";

export function PcbAiPanel({ settings, version, empty, issues, checking, onResult, onOpenSettings }: Props) {
  const [autoRepair, setAutoRepair] = useState(true);
  const model = useModelChoice(settings);
  const [prompt, setPrompt] = useState("");
  const [task, setTask] = useState<Task | null>(null);
  const [review, setReview] = useState<{ text: string; version: number } | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachments = useAttachments();
  const problems = issues.map((issue) => issue.message);

  const run = async (kind: Task, text: string) => {
    // Lampiran hanya ikut pada permintaan rancang, bukan review atau perbaiki.
    const sent = kind === "design" ? attachments.items : [];
    const controller = new AbortController();
    abortRef.current = controller;
    setTask(kind);
    setMessage(null);
    try {
      const body =
        kind === "review"
          ? { mode: "review" }
          : {
              mode: "design",
              prompt: text.slice(0, 4000),
              attachments: sent,
              // "Perbaiki masalah" sudah merupakan perbaikan, jadi cukup satu panggilan.
              autoRepair: kind === "design" && autoRepair,
            };
      const response = await fetch("/api/pcb/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, ...model.request }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error ?? `Server membalas ${response.status}.`);
      if (kind === "review") {
        setReview({ text: data.review, version: data.version });
        return;
      }
      onResult(data);
      if (kind === "design") setPrompt("");
      attachments.removeSent(sent);
      const calls = data.calls > 1 ? " AI memakai 2 panggilan." : "";
      const remaining = data.problems > 0 ? ` Masih ada ${data.problems} masalah di tab Cek.` : "";
      setMessage({
        text: `Desain diterapkan.${calls}${remaining || " Periksa tab Cek sebelum diekspor."}`,
        failed: false,
      });
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
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={autoRepair} onChange={(e) => setAutoRepair(e.target.checked)} />
        <span>Periksa dan perbaiki otomatis. Bila hasilnya gagal cek, AI dipanggil satu kali lagi (menambah biaya).</span>
      </label>
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
          disabled={busy || empty || checking || problems.length === 0}
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
