import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./files";
import type { PublicSettings, SettingsOperation } from "./settings";

// Kunci disimpan sebagai teks biasa di komputer ini; hanya pemilik file yang bisa membacanya.
const FILE = path.join(process.cwd(), ".data", "settings.json");

const settingsSchema = z.object({
  claudeApiKey: z.string(),
  connections: z.array(
    z.object({ id: z.string(), name: z.string(), baseUrl: z.string(), model: z.string(), apiKey: z.string() }),
  ),
});

type Settings = z.infer<typeof settingsSchema>;

export class SettingsError extends Error {}

export function readSettings(): Settings {
  if (!existsSync(FILE)) return { claudeApiKey: "", connections: [] };
  try {
    return settingsSchema.parse(JSON.parse(readFileSync(FILE, "utf8")));
  } catch {
    // Jangan sertakan isi file di pesan atau log karena berisi kunci.
    throw new SettingsError(".data/settings.json rusak. Perbaiki atau hapus file tersebut.");
  }
}

function writeSettings(settings: Settings) {
  writeFileAtomic(FILE, JSON.stringify(settings, null, 2));
}

const describeKey = (key: string) => ({
  hasKey: key.length > 0,
  hint: key.length >= 12 ? `…${key.slice(-4)}` : "",
});

export function publicSettings(): PublicSettings {
  const settings = readSettings();
  return {
    claude: describeKey(settings.claudeApiKey),
    connections: settings.connections.map(({ apiKey, ...connection }) => ({ ...connection, ...describeKey(apiKey) })),
  };
}

export function applySettings(operation: SettingsOperation): PublicSettings {
  const settings = readSettings();
  if (operation.op === "setClaudeKey") {
    settings.claudeApiKey = operation.apiKey;
  } else if (operation.op === "deleteConnection") {
    settings.connections = settings.connections.filter((c) => c.id !== operation.id);
  } else {
    const { id, apiKey = "", ...fields } = operation.connection;
    if (!id) {
      if (settings.connections.length >= 30) throw new SettingsError("Maksimal 30 koneksi.");
      settings.connections.push({ ...fields, apiKey, id: randomUUID().slice(0, 8) });
    } else {
      const existing = settings.connections.find((c) => c.id === id);
      if (!existing) throw new SettingsError("Koneksi tidak ditemukan.");
      // Kunci lama tidak boleh ikut terkirim ke alamat baru.
      if (!apiKey && existing.apiKey && existing.baseUrl !== fields.baseUrl) {
        throw new SettingsError("Alamat API berubah. Masukkan lagi API key-nya.");
      }
      Object.assign(existing, fields, { apiKey: apiKey || existing.apiKey });
    }
  }
  writeSettings(settings);
  return publicSettings();
}
