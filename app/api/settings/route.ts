import { guard } from "@/lib/guard";
import { HttpError, readBody, respond } from "@/lib/http";
import { settingsOperationSchema } from "@/lib/settings";
import { applySettings, publicSettings, SettingsError } from "@/lib/settings-store";

export const dynamic = "force-dynamic";

// Pengaturan berisi API key: hanya dari komputer ini, token API tidak berlaku.
function settingsAction(action: () => unknown) {
  return respond(async () => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof SettingsError) throw new HttpError(400, error.message);
      throw error;
    }
  });
}

export async function GET(request: Request) {
  return guard(request, { localOnly: true }) ?? settingsAction(publicSettings);
}

export async function POST(request: Request) {
  return (
    guard(request, { localOnly: true }) ??
    settingsAction(async () => applySettings(await readBody(request, settingsOperationSchema, 16 * 1024)))
  );
}
