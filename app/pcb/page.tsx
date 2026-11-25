import type { Metadata } from "next";
import PcbEditor from "./pcb-editor";

export const metadata: Metadata = { title: "Desain PCB · FluxionLab" };

export default function PcbPage() {
  return <PcbEditor />;
}
