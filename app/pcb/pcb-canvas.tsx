"use client";

import { useState } from "react";
import { ViewButton } from "../components/view-controls";
import BoardView, { type BoardViewProps } from "./board-view";
import BoardView3d from "./board-view-3d";

const MODES = [
  ["2d", "2D"],
  ["3d", "3D"],
] as const;

/** Canvas PCB dengan pilihan tampilan datar atau tiga dimensi. */
export default function PcbCanvas(props: BoardViewProps) {
  const [mode, setMode] = useState<(typeof MODES)[number][0]>("2d");
  return (
    <div className="relative h-full w-full">
      {mode === "2d" ? <BoardView {...props} /> : <BoardView3d {...props} />}
      <div role="group" aria-label="Mode tampilan" className="absolute top-2 right-2 flex gap-1 rounded-md bg-black/70 p-1">
        {MODES.map(([key, label]) => (
          <ViewButton key={key} label={`Tampilan ${label}`} pressed={mode === key} onClick={() => setMode(key)}>
            {label}
          </ViewButton>
        ))}
      </div>
    </div>
  );
}
