"use client";

import { useRef, useState } from "react";
import {
  fitsTotal,
  IMAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_IMAGE_CHARS,
  MAX_PDF_BYTES,
  MAX_TEXT_CHARS,
  type Attachment,
} from "@/lib/attachments";

const MAX_IMAGE_SIDE = 1568;
const TEXT_EXTENSIONS = /\.(txt|md|csv|json|svg|scad|ya?ml|log|ino|net)$/i;
const ACCEPT = [...IMAGE_TYPES, "application/pdf", "text/*", ".md,.json,.svg,.scad,.yml,.yaml,.log,.ino,.net,.csv"].join(",");

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas"))), type, 0.9),
  );

/** Gambar besar diperkecil agar hemat token dan muat dalam batas ukuran. */
async function readImage(file: File): Promise<Attachment> {
  const mediaType = file.type as (typeof IMAGE_TYPES)[number];
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`Gambar "${file.name}" tidak bisa dibaca.`);
  });
  const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (ratio === 1 && file.size * 1.37 < MAX_IMAGE_CHARS) {
    bitmap.close();
    return { kind: "image", name: file.name, mediaType, data: await toBase64(file) };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await toBlob(canvas, mediaType === "image/jpeg" ? "image/jpeg" : "image/png");
  if (blob.size * 1.37 >= MAX_IMAGE_CHARS) {
    // JPEG tidak punya transparansi, jadi diberi latar putih.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    blob = await toBlob(canvas, "image/jpeg");
  }
  return {
    kind: "image",
    name: file.name,
    mediaType: blob.type as (typeof IMAGE_TYPES)[number],
    data: await toBase64(blob),
  };
}

async function readAttachment(file: File): Promise<Attachment> {
  const name = file.name.slice(-200) || "lampiran";
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ...(await readImage(file)), name };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error(`PDF "${name}" lebih dari 10 MB.`);
    return { kind: "pdf", name, data: await toBase64(file) };
  }
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.test(name)) {
    const data = await file.text();
    if (!data.trim()) throw new Error(`File "${name}" kosong.`);
    if (data.length > MAX_TEXT_CHARS) throw new Error(`File teks "${name}" terlalu panjang.`);
    return { kind: "text", name, data };
  }
  throw new Error(`"${name}" belum didukung. Gunakan gambar (PNG, JPG, WEBP, GIF), PDF, atau file teks.`);
}

export function useAttachments() {
  const [items, setItems] = useState<(Attachment & { key: string })[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const itemsRef = useRef(items);
  const queueRef = useRef(Promise.resolve());

  const update = (next: typeof items) => {
    itemsRef.current = next;
    setItems(next);
  };

  // Diproses berurutan supaya batas jumlah dan ukuran tetap berlaku saat menempel berkali-kali.
  const add = (files: File[]) => {
    if (files.length === 0) return;
    setError("");
    setPending((n) => n + 1);
    queueRef.current = queueRef.current.then(async () => {
      for (const file of files) {
        try {
          if (itemsRef.current.length >= MAX_ATTACHMENTS) throw new Error(`Maksimal ${MAX_ATTACHMENTS} lampiran.`);
          const next = [...itemsRef.current, { ...(await readAttachment(file)), key: crypto.randomUUID() }];
          if (!fitsTotal(next)) throw new Error("Total lampiran terlalu besar.");
          update(next);
        } catch (caught) {
          setError((caught as Error).message || "Lampiran gagal dibaca.");
        }
      }
      setPending((n) => n - 1);
    });
  };

  return {
    items,
    error,
    processing: pending > 0,
    add,
    remove: (key: string) => update(itemsRef.current.filter((item) => item.key !== key)),
    /** Hanya menghapus yang sudah terkirim; lampiran yang ditambah saat AI bekerja tetap ada. */
    removeSent: (sent: { key: string }[]) =>
      update(itemsRef.current.filter((item) => !sent.some((s) => s.key === item.key))),
  };
}

type Attachments = ReturnType<typeof useAttachments>;

/** Area yang menerima tempel (Cmd/Ctrl+V) dan seret file. */
export function AttachmentZone({ attachments, children }: { attachments: Attachments; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
  return (
    <div
      className={`space-y-3 rounded-md ${over ? "outline-2 outline-offset-4 outline-indigo-500 outline-dashed" : ""}`}
      onPaste={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length === 0) return;
        // Salinan dari aplikasi dokumen berisi teks sekaligus gambar: utamakan teksnya.
        const text = event.clipboardData.getData("text/plain").trim();
        if (text && !files.some((file) => text.includes(file.name))) return;
        event.preventDefault();
        attachments.add(files);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        attachments.add([...event.dataTransfer.files]);
      }}
    >
      {children}
    </div>
  );
}

export function AttachmentBar({ attachments }: { attachments: Attachments }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      {attachments.items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attachments.items.map((item) => (
            <li key={item.key} className="relative rounded-md border border-current/20 p-1">
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- pratinjau data URL lokal
                <img
                  src={`data:${item.mediaType};base64,${item.data}`}
                  alt={item.name}
                  title={item.name}
                  className="size-16 rounded object-cover"
                />
              ) : (
                <span className="flex h-16 w-24 flex-col justify-center overflow-hidden px-1 text-xs" title={item.name}>
                  <strong>{item.kind === "pdf" ? "PDF" : "Teks"}</strong>
                  <span className="truncate opacity-70">{item.name}</span>
                </span>
              )}
              <button
                type="button"
                aria-label={`Hapus lampiran ${item.name}`}
                className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-zinc-700 text-xs text-white"
                onClick={() => attachments.remove(item.key)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-current/20 px-3 py-1.5 text-sm hover:bg-current/10"
          onClick={() => inputRef.current?.click()}
        >
          📎 Lampirkan
        </button>
        <span className="text-xs opacity-60">
          {attachments.processing ? "Memproses lampiran…" : "atau tempel (⌘/Ctrl+V) / seret file ke sini"}
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            attachments.add([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>
      {attachments.error && (
        <p role="alert" className="text-sm text-red-500">
          {attachments.error}
        </p>
      )}
    </div>
  );
}
