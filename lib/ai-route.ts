import { AiError } from "./ai";
import { HttpError, respond } from "./http";
import { SettingsError } from "./settings-store";

// Batas permintaan AI bersamaan, agar kuota berbayar tidak terkuras oleh skrip atau klik ganda.
export const MAX_PARALLEL_AI = 2;
let running = 0;

export function aiRoute(action: () => Promise<unknown>) {
  return respond(async () => {
    if (running >= MAX_PARALLEL_AI) {
      throw new HttpError(429, "Masih ada permintaan AI yang berjalan. Tunggu sampai selesai.");
    }
    running += 1;
    try {
      return await action();
    } catch (error) {
      if (error instanceof AiError || error instanceof SettingsError) throw new HttpError(502, error.message);
      throw error;
    } finally {
      running -= 1;
    }
  });
}
