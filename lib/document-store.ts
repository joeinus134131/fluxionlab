import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./files";
import { log } from "./log";

// Penyimpanan satu dokumen (scene 3D atau papan PCB) untuk pemakaian lokal.
// Disimpan di .data/<nama>.json, riwayat urungkan/ulangi di .data/<nama>.history.json.

export const HISTORY_LIMIT = 30;

/** Kesalahan yang pesannya aman ditampilkan ke pengguna. */
export class DocumentError extends Error {}

type History<T> = { past: T[]; future: T[] };
type Loaded<T> = History<T> & { version: number; value: T; stamp: string };

export type DocumentStore<T> = {
  get(): { version: number; value: T };
  /** `change` menghasilkan dokumen baru, atau melempar DocumentError. */
  commit(change: (current: T) => T): { version: number; value: T };
  undo(): { version: number; value: T };
  redo(): { version: number; value: T };
};

export function createDocumentStore<T>(options: {
  name: string;
  /** Nama properti dokumen di file JSON. */
  key: string;
  schema: z.ZodType<T>;
  empty: T;
}): DocumentStore<T> {
  const { name, key, schema, empty } = options;
  const directory = path.join(process.cwd(), ".data");
  const file = path.join(directory, `${name}.json`);
  const historyFile = path.join(directory, `${name}.history.json`);

  const documentSchema = z.looseObject({ version: z.number().int().min(0) });
  const historySchema = z.object({ version: z.number().int(), past: z.array(schema), future: z.array(schema) });

  const cache = globalThis as typeof globalThis & { __fluxionDocuments?: Map<string, unknown> };
  const documents = (cache.__fluxionDocuments ??= new Map());

  /** Penanda isi file, untuk mendeteksi perubahan dari proses lain. */
  const stamp = () => {
    if (!existsSync(file)) return "";
    const info = statSync(file);
    return `${info.mtimeMs}:${info.size}:${info.ino}`;
  };

  /** Pindahkan file rusak agar tidak tertimpa diam-diam. */
  const quarantine = (target: string, error: unknown) => {
    const moved = `${target}.rusak-${Date.now()}`;
    renameSync(target, moved);
    log("error", "store.corrupt", { file: moved, reason: error instanceof Error ? error.name : "unknown" });
  };

  const readHistory = (version: number): History<T> => {
    if (!existsSync(historyFile)) return { past: [], future: [] };
    try {
      const saved = historySchema.parse(JSON.parse(readFileSync(historyFile, "utf8")));
      // Riwayat yang tidak cocok dengan versi dokumen tidak dipakai.
      return saved.version === version ? saved : { past: [], future: [] };
    } catch (error) {
      quarantine(historyFile, error);
      return { past: [], future: [] };
    }
  };

  const read = (): Loaded<T> => {
    if (existsSync(file)) {
      try {
        const raw = documentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        const value = schema.parse(raw[key]);
        return { version: raw.version, value, ...readHistory(raw.version), stamp: stamp() };
      } catch (error) {
        quarantine(file, error);
      }
    }
    return { version: 0, value: empty, past: [], future: [], stamp: "" };
  };

  const load = (): Loaded<T> => {
    const known = documents.get(file) as Loaded<T> | undefined;
    if (known && known.stamp === stamp()) return known;
    const fresh = read();
    documents.set(file, fresh);
    return fresh;
  };

  /** Simpan ke disk dulu; memori hanya berubah bila penulisan berhasil. */
  const save = (previous: Loaded<T>, value: T, history: History<T>) => {
    const version = previous.version + 1;
    writeFileAtomic(historyFile, JSON.stringify({ version, ...history }));
    writeFileAtomic(file, JSON.stringify({ version, [key]: value }, null, 2));
    documents.set(file, { version, value, ...history, stamp: stamp() });
    return { version, value };
  };

  return {
    get() {
      const { version, value } = load();
      return { version, value };
    },
    commit(change) {
      const current = load();
      const result = schema.safeParse(change(current.value));
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new DocumentError(`Perubahan tidak valid (${issue.path.join(".")}: ${issue.message}).`);
      }
      const past = [...current.past, current.value].slice(-HISTORY_LIMIT);
      return save(current, result.data, { past, future: [] });
    },
    undo() {
      const current = load();
      const previous = current.past.at(-1);
      if (previous === undefined) throw new DocumentError("Tidak ada perubahan yang bisa diurungkan.");
      return save(current, previous, {
        past: current.past.slice(0, -1),
        future: [...current.future, current.value],
      });
    },
    redo() {
      const current = load();
      const next = current.future.at(-1);
      if (next === undefined) throw new DocumentError("Tidak ada perubahan yang bisa diulangi.");
      return save(current, next, {
        past: [...current.past, current.value],
        future: current.future.slice(0, -1),
      });
    },
  };
}
