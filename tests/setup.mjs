// Agar test bisa mengimpor file TypeScript seperti Next: alias "@/" dan tanpa ekstensi.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base;
    if (specifier.startsWith("@/")) base = path.join(root, specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    if (base && existsSync(`${base}.ts`)) return nextResolve(pathToFileURL(`${base}.ts`).href, context);
    return nextResolve(specifier, context);
  },
});

process.env.FLUXION_LOG ??= "silent";
