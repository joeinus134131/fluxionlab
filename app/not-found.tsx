import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl space-y-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Halaman tidak ditemukan</h1>
      <Link href="/" className="underline">
        Kembali ke beranda
      </Link>
    </main>
  );
}
