"use client";

import { useEffect } from "react";
import { primaryClass } from "./components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto max-w-xl space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Terjadi kesalahan</h1>
      <p className="opacity-70">
        Halaman ini gagal ditampilkan. Desain Anda tersimpan di server dan tidak terpengaruh. Coba muat lagi.
      </p>
      <button className={primaryClass} onClick={reset}>
        Muat lagi
      </button>
    </main>
  );
}
