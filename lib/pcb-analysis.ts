import { checkBoard, type Board, type Issue } from "./pcb";
import { runDrc } from "./pcb-drc";
import { routeBoard, type Routing } from "./pcb-router";

export type Analysis = { routing: Routing; issues: Issue[]; errors: number };

/** Routing, cek tata letak/netlist, dan DRC dalam satu hasil. */
export function analyzeBoard(board: Board): Analysis {
  const routing = routeBoard(board);
  const issues: Issue[] = [
    ...checkBoard(board),
    ...routing.unrouted.map((u) => ({
      level: "error" as const,
      message: `Belum tersambung: ${u.net} (${u.from} ke ${u.to}).`,
    })),
    ...runDrc(board, routing),
  ];
  if (routing.timedOut) {
    issues.push({ level: "warning", message: "Waktu routing habis. Kurangi komponen atau perbesar papan." });
  }
  return { routing, issues, errors: issues.filter((issue) => issue.level === "error").length };
}
