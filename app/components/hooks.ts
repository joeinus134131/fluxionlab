"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicSettings } from "@/lib/settings";

const POLL_MS = 1500;

async function readJson(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `Server membalas ${response.status}.`);
  if (!data) throw new Error("Balasan server tidak bisa dibaca.");
  return data;
}

/** Dokumen yang tersinkron dengan server: polling, kirim operasi, dan status koneksi. */
export function useDocument<S extends { version: number }, Operation>(url: string) {
  const [state, setState] = useState<S | null>(null);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const versionRef = useRef(-1);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  // Abaikan balasan lama yang datang belakangan.
  const accept = useCallback((next: S) => {
    if (next.version <= versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
  }, []);

  // Polling ringan agar perubahan dari MCP atau aplikasi luar langsung terlihat.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      // Tab yang tersembunyi tidak perlu bertanya terus.
      if (!document.hidden || versionRef.current < 0) {
        try {
          const asked = versionRef.current;
          const response = await fetch(`${url}?since=${asked}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
          });
          const data = await readJson(response);
          if (!stopped) {
            if (!data.unchanged) {
              // Lebih kecil dari versi yang ditanyakan berarti data di server diganti (mis. file dihapus).
              // Balasan yang sekadar terlambat tidak masuk sini dan diabaikan oleh accept.
              if (data.version < asked && versionRef.current === asked) versionRef.current = -1;
              accept(data);
            }
            setOffline(false);
          }
        } catch {
          if (!stopped) setOffline(true);
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [accept, url]);

  // Operasi dikirim berurutan agar urutannya sama dengan urutan klik.
  const send = useCallback(
    (operation: Operation) => {
      const run = async (): Promise<S | undefined> => {
        setError("");
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(operation),
            signal: AbortSignal.timeout(30_000),
          });
          const data = await readJson(response);
          accept(data);
          return data as S;
        } catch (caught) {
          setError((caught as Error).message || "Gagal menyimpan perubahan.");
        }
      };
      const result = queueRef.current.then(run);
      queueRef.current = result;
      return result;
    },
    [accept, url],
  );

  return { state, accept, send, error, setError, offline };
}

export function useSettings() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(setSettings)
      .catch(() => {});
  }, []);
  return [settings, setSettings] as const;
}

/**
 * Pintasan keyboard halaman. Diabaikan saat mengetik atau saat fokus di bilah tab.
 * `handler` mengembalikan true bila tombolnya dipakai.
 */
export function useShortcuts(handler: (event: KeyboardEvent) => boolean) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || target?.closest('input, textarea, select, [contenteditable], [role="tablist"]')) {
        return;
      }
      if (ref.current(event)) event.preventDefault();
    };
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);
}

/** "undo", "redo", atau null untuk Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, dan Ctrl+Y. */
export function historyShortcut(event: KeyboardEvent): "undo" | "redo" | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  return key === "y" ? "redo" : null;
}
