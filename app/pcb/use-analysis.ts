"use client";

import { useEffect, useState } from "react";
import type { Board } from "@/lib/pcb";
import { analyzeBoard, type Analysis } from "@/lib/pcb-analysis";

const NOTHING: Analysis = {
  routing: { tracks: [], vias: [], unrouted: [], timedOut: false },
  issues: [],
  errors: 0,
};

/** Hasil routing dan DRC untuk `board`. `pending` true selama hasilnya belum sesuai papan terbaru. */
export function useAnalysis(board: Board) {
  const [result, setResult] = useState<{ board: Board; analysis: Analysis } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<Analysis>) => {
      setResult({ board, analysis: event.data });
      worker.terminate();
    };
    // Bila worker gagal dimuat, hitung langsung agar fitur tetap berjalan.
    worker.onerror = () => {
      setResult({ board, analysis: analyzeBoard(board) });
      worker.terminate();
    };
    worker.postMessage(board);
    return () => worker.terminate();
  }, [board]);

  return { analysis: result?.analysis ?? NOTHING, pending: result?.board !== board };
}
