import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Tulis file secara atomik: isi lama tetap utuh bila proses mati di tengah penulisan.
 * Izin 600 karena folder data berisi desain dan API key.
 */
export function writeFileAtomic(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
