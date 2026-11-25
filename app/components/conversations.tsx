"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_TITLE, type ConversationKind, type ConversationOperation, type ConversationView } from "@/lib/conversations";
import { buttonClass, inputClass } from "./ui";

type Action = ConversationOperation extends infer O ? (O extends unknown ? Omit<O, "kind"> : never) : never;

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? `Server membalas ${response.status}.`);
  return data;
}

/**
 * Daftar percakapan dan pesan milik percakapan aktif. Dimuat ulang tiap versi dokumen berubah,
 * misalnya setelah AI selesai atau percakapan diganti dari tab lain.
 */
export function useConversations<S>(kind: ConversationKind, version: number | undefined, accept: (state: S) => void) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  // Balasan muat ulang yang datang terlambat tidak boleh menimpa hasil yang lebih baru.
  const latest = useRef(0);

  useEffect(() => {
    if (version === undefined) return;
    const ticket = ++latest.current;
    request(`/api/conversations?kind=${kind}`)
      .then((data) => {
        if (ticket !== latest.current) return;
        setView(data);
        setError("");
      })
      .catch((caught: Error) => {
        if (ticket === latest.current) setError(`Riwayat percakapan tidak bisa dimuat. ${caught.message}`);
      });
  }, [kind, version, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const run = async (action: Action) => {
    setPending(true);
    setError("");
    try {
      const { state, ...next } = await request("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...action, kind }),
      });
      latest.current += 1;
      setView(next);
      accept(state);
      return true;
    } catch (caught) {
      setError((caught as Error).message || "Gagal mengubah percakapan.");
      return false;
    } finally {
      setPending(false);
    }
  };

  return { view, error, pending, run, refresh };
}

type PanelProps = {
  conversations: ReturnType<typeof useConversations>;
  /** true selama AI bekerja: percakapan tidak boleh diganti. */
  locked: boolean;
};

export function ConversationPanel({ conversations, locked }: PanelProps) {
  const { view, error, pending, run } = conversations;
  const [draft, setDraft] = useState<{ id: string; title: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const lastId = view?.messages.at(-1)?.id;

  // Gulir ke pesan terbaru.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId]);

  if (!view) return <p className="pb-3 text-xs opacity-60">{error || "Memuat percakapan…"}</p>;

  const disabled = locked || pending;
  const active = view.items.find((item) => item.id === view.activeId);
  const renaming = draft?.id === view.activeId ? draft : null;

  return (
    <section aria-label="Percakapan" className="mb-3 space-y-2 border-b border-current/15 pb-3">
      <div className="flex gap-2">
        <select
          aria-label="Pilih percakapan"
          className={`${inputClass} min-w-0 flex-1 bg-background`}
          value={view.activeId}
          disabled={disabled}
          onChange={(event) => run({ op: "select", id: event.target.value })}
        >
          {view.items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
              {item.count > 0 ? ` · ${new Date(item.updatedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}` : ""}
            </option>
          ))}
        </select>
        <button className={`${buttonClass} shrink-0`} disabled={disabled} onClick={() => run({ op: "new" })}>
          + Baru
        </button>
      </div>

      {renaming ? (
        <form
          className="flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (renaming.title.trim() && (await run({ op: "rename", id: renaming.id, title: renaming.title }))) {
              setDraft(null);
            }
          }}
        >
          <input
            aria-label="Nama percakapan"
            className={`${inputClass} min-w-0 flex-1`}
            value={renaming.title}
            maxLength={MAX_TITLE}
            autoFocus
            // Nama lama langsung terpilih supaya tinggal diketik ulang.
            onFocus={(event) => event.target.select()}
            onChange={(event) => setDraft({ ...renaming, title: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
            }}
          />
          <button type="submit" className={buttonClass} disabled={disabled || !renaming.title.trim()}>
            Simpan
          </button>
          <button type="button" className={buttonClass} onClick={() => setDraft(null)}>
            Batal
          </button>
        </form>
      ) : (
        <div className="flex gap-3 text-xs">
          <button
            className="underline opacity-70 disabled:opacity-30"
            disabled={disabled || !active}
            onClick={() => active && setDraft({ id: active.id, title: active.title })}
          >
            Ganti nama
          </button>
          <button
            className="underline opacity-70 disabled:opacity-30"
            disabled={disabled || !active}
            onClick={() => {
              if (
                active &&
                window.confirm(`Hapus percakapan "${active.title}" beserta desainnya? Tindakan ini tidak bisa dibatalkan.`)
              ) {
                run({ op: "delete", id: active.id });
              }
            }}
          >
            Hapus
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      {view.messages.length === 0 ? (
        <p className="text-xs opacity-60">
          Belum ada pesan. Tiap percakapan punya riwayat dan desainnya sendiri, jadi AI fokus ke satu topik.
        </p>
      ) : (
        <ol ref={listRef} aria-label="Riwayat pesan" tabIndex={0} className="max-h-72 space-y-2 overflow-y-auto">
          {view.messages.map((message) => (
            <li
              key={message.id}
              className={`rounded-md p-2 text-sm ${message.role === "user" ? "ml-6 bg-indigo-500/15" : "mr-6 bg-current/5"}`}
            >
              <p className="text-xs opacity-60">{message.role === "user" ? "Kamu" : "AI"}</p>
              <p className="whitespace-pre-wrap break-words">{message.label ?? message.text}</p>
              {message.files && <p className="mt-1 break-words text-xs opacity-60">Lampiran: {message.files.join(", ")}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
