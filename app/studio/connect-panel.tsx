"use client";

import { useState, useSyncExternalStore } from "react";
import { buttonClass } from "./studio";

function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      <pre className="overflow-x-auto rounded-md bg-current/10 p-2 text-xs">{code}</pre>
      <button
        className={buttonClass}
        onClick={() =>
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? "Tersalin" : "Salin"}
      </button>
    </section>
  );
}

const subscribe = () => () => {};

export function ConnectPanel() {
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "http://localhost:3000",
  );
  const mcpUrl = `${origin}/api/mcp`;
  return (
    <div className="space-y-5">
      <p className="text-sm opacity-70">
        Aplikasi ini adalah server MCP. Asisten AI yang terhubung bisa membaca dan mengubah scene, dan hasilnya
        langsung tampil di sini. Server harus sedang berjalan.
      </p>
      <Snippet title="Claude Code" code={`claude mcp add --transport http fluxion3d ${mcpUrl}`} />
      <Snippet
        title="Cursor (.cursor/mcp.json)"
        code={JSON.stringify({ mcpServers: { fluxion3d: { url: mcpUrl } } }, null, 2)}
      />
      <Snippet
        title="Claude Desktop (claude_desktop_config.json)"
        code={JSON.stringify(
          { mcpServers: { fluxion3d: { command: "npx", args: ["-y", "mcp-remote", mcpUrl] } } },
          null,
          2,
        )}
      />
      <p className="text-xs opacity-60">
        Konfigurasi Claude Desktop memakai mcp-remote, paket npm pihak ketiga yang diunduh saat dijalankan.
      </p>
      <p className="text-sm opacity-70">Tool MCP: get_scene, set_scene, add_objects, update_object, remove_objects, undo.</p>
      <Snippet title="REST API: baca scene" code={`curl ${origin}/api/scene`} />
      <Snippet
        title="REST API: tambah objek"
        code={`curl -X POST ${origin}/api/scene -H 'content-type: application/json' -d '{"op":"add","objects":[{"name":"Bola","type":"sphere","position":[0,0.5,0],"color":"#ff7a59"}]}'`}
      />
      <p className="text-sm opacity-70">
        Untuk Blender atau Unity, gunakan Ekspor GLB atau OBJ. Untuk cetak 3D, gunakan Ekspor STL: sumbu Z
        menghadap atas, titik terendah menempel di alas, dan 1 satuan = 1 mm (kubus berukuran 20 menjadi 20 mm).
        Bidang (plane) tidak ikut diekspor. Bentuk yang bertumpuk tidak digabung, jadi periksa pratinjau lapisan
        di slicer.
      </p>
    </div>
  );
}
