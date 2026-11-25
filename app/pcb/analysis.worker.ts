import type { Board } from "@/lib/pcb";
import { analyzeBoard } from "@/lib/pcb-analysis";

// Routing dan DRC dijalankan di luar thread utama agar tampilan tidak membeku.
self.onmessage = (event: MessageEvent<Board>) => self.postMessage(analyzeBoard(event.data));
