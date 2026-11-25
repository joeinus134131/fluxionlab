"use client";

import { useState } from "react";
import type { PublicSettings, SettingsOperation } from "@/lib/settings";
import { buttonClass, inputClass } from "./studio";

// Preset hanya mengisi alamat; nama model diisi sendiri sesuai akun Anda.
const PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "Ollama (lokal)", baseUrl: "http://localhost:11434/v1" },
];

const EMPTY = { id: "", name: "", baseUrl: "", model: "", apiKey: "" };
const primaryClass = "rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-40";

type Props = { settings: PublicSettings | null; onChange: (settings: PublicSettings) => void };

export function SettingsPanel({ settings, onChange }: Props) {
  const [claudeKey, setClaudeKey] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const save = async (operation: SettingsOperation, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(operation),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onChange(data);
      setMessage({ text: success, failed: false });
      return true;
    } catch (error) {
      setMessage({ text: (error as Error).message || "Gagal menyimpan pengaturan.", failed: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <p className="text-sm opacity-60">Pengaturan belum bisa dimuat. Muat ulang halaman.</p>;

  const editing = settings.connections.find((c) => c.id === form.id);
  const keyStatus = (item: { hasKey: boolean; hint: string }) =>
    item.hasKey ? `tersimpan ${item.hint}` : "belum diisi";

  return (
    <div className="space-y-6">
      {message && (
        <p role="status" className={`text-sm ${message.failed ? "text-red-500" : "opacity-70"}`}>
          {message.text}
        </p>
      )}

      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await save({ op: "setClaudeKey", apiKey: claudeKey }, "API key Claude disimpan.")) setClaudeKey("");
        }}
      >
        <h3 className="text-sm font-semibold">Claude</h3>
        <label className="block text-sm">
          API key ({keyStatus(settings.claude)})
          <input
            className={`${inputClass} mt-1`}
            type="password"
            autoComplete="off"
            value={claudeKey}
            onChange={(e) => setClaudeKey(e.target.value)}
            placeholder={settings.claude.hasKey ? "Isi untuk mengganti" : "Tempel API key"}
          />
        </label>
        <div className="flex gap-2">
          <button className={primaryClass} disabled={busy || !claudeKey.trim()}>
            Simpan
          </button>
          {settings.claude.hasKey && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => save({ op: "setClaudeKey", apiKey: "" }, "API key Claude dihapus.")}
            >
              Hapus kunci
            </button>
          )}
        </div>
      </form>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Model lain (API kompatibel OpenAI)</h3>
        {settings.connections.length === 0 && <p className="text-sm opacity-60">Belum ada koneksi.</p>}
        <ul className="space-y-2">
          {settings.connections.map((connection) => (
            <li key={connection.id} className="rounded-md border border-current/15 p-2 text-sm">
              <p className="font-medium">{connection.name}</p>
              <p className="break-all text-xs opacity-60">
                {connection.model} · {connection.baseUrl} · kunci {keyStatus(connection)}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  className={buttonClass}
                  onClick={() => {
                    const { id, name, baseUrl, model } = connection;
                    setForm({ id, name, baseUrl, model, apiKey: "" });
                  }}
                >
                  Ubah
                </button>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(`Hapus koneksi "${connection.name}" beserta kuncinya?`)) return;
                    const removed = await save({ op: "deleteConnection", id: connection.id }, "Koneksi dihapus.");
                    if (removed && form.id === connection.id) setForm(EMPTY);
                  }}
                >
                  Hapus
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const { id, ...fields } = form;
          const connection = id ? { id, ...fields } : fields;
          if (await save({ op: "saveConnection", connection }, "Koneksi disimpan. Pilih di tab AI.")) setForm(EMPTY);
        }}
      >
        <h3 className="text-sm font-semibold">{editing ? `Ubah: ${editing.name}` : "Tambah koneksi"}</h3>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button key={preset.name} type="button" className={buttonClass} onClick={() => setForm({ ...form, ...preset })}>
                {preset.name}
              </button>
            ))}
          </div>
        )}
        {(
          [
            ["name", "Nama", "text", "Contoh: OpenRouter"],
            ["baseUrl", "Alamat API (base URL)", "url", "https://…/v1"],
            ["model", "Nama model", "text", "ID model dari penyedia"],
            ["apiKey", "API key", "password", editing?.hasKey ? "Kosongkan bila tidak diganti" : "Boleh kosong untuk Ollama"],
          ] as const
        ).map(([field, label, type, placeholder]) => (
          <label key={field} className="block text-sm">
            {label}
            <input
              className={`${inputClass} mt-1`}
              type={type}
              autoComplete="off"
              required={field !== "apiKey"}
              placeholder={placeholder}
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          </label>
        ))}
        <div className="flex gap-2">
          <button className={primaryClass} disabled={busy}>
            {editing ? "Simpan perubahan" : "Tambah"}
          </button>
          {editing && (
            <button type="button" className={buttonClass} onClick={() => setForm(EMPTY)}>
              Batal
            </button>
          )}
        </div>
      </form>

      <p className="text-xs opacity-60">
        Kunci disimpan sebagai teks biasa di komputer ini (.data/settings.json, tidak masuk git) dan tidak dikirim
        balik ke browser. Kunci hanya dipakai server untuk memanggil penyedianya.
      </p>
    </div>
  );
}
