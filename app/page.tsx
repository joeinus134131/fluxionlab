import Link from "next/link";

const FEATURES = [
  {
    title: "Desain dengan AI",
    text: "Tulis deskripsi objek, lalu revisi dengan perintah lanjutan. Pakai Claude atau model lain yang kompatibel dengan API OpenAI.",
  },
  {
    title: "Edit manual",
    text: "Tambah bentuk dasar, klik objek di tampilan 3D, lalu atur posisi, rotasi, ukuran, warna, dan material.",
  },
  {
    title: "Terhubung lewat MCP",
    text: "Asisten AI seperti Claude Code bisa membaca dan mengubah scene. Tersedia juga REST API untuk aplikasi lain.",
  },
  {
    title: "Ekspor dan cetak 3D",
    text: "Unduh GLB, OBJ, JSON, atau STL dengan sumbu Z ke atas dan 1 satuan = 1 mm.",
  },
  {
    title: "Desain PCB dengan AI",
    text: "AI memilih komponen, menyambungkan pin, dan menata papan. Jalur dua lapis dibuat otomatis, lalu ekspor Gerber, bor, dan BOM.",
  },
  {
    title: "Review PCB",
    text: "Minta AI mengulas rangkaian, atau memperbaiki tabrakan komponen dan sambungan yang gagal.",
  },
];

const STEPS = [
  "Buka studio, lalu buat objek lewat AI, tombol bentuk, atau MCP.",
  "Periksa bentuk dan ukurannya, lalu revisi.",
  "Ekspor STL, kemudian periksa pratinjau lapisan di slicer sebelum mencetak.",
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">Desain objek 3D dan PCB dengan bantuan AI</h1>
      <p className="mt-4 max-w-2xl text-lg opacity-70">
        FluxionLab adalah studio desain yang berjalan di komputer Anda, dari ide sampai file untuk mesin cetak 3D dan pabrik PCB.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/studio"
          className="rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-500"
        >
          Buka Studio 3D
        </Link>
        <Link href="/pcb" className="rounded-md border border-current/25 px-5 py-2.5 font-medium hover:bg-current/5">
          Buka Desain PCB
        </Link>
      </div>

      <ul className="mt-14 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="rounded-lg border border-current/15 p-5">
            <h2 className="font-semibold">{feature.title}</h2>
            <p className="mt-2 text-sm opacity-70">{feature.text}</p>
          </li>
        ))}
      </ul>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Cara pakai</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 opacity-80">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm opacity-60">
          Untuk fitur AI, isi API key di tab Pengaturan. Bentuk 3D masih tersusun dari primitif dan belum bisa
          dilubangi atau digabung. Desain PCB dari AI wajib dicocokkan dengan datasheet sebelum dipesan.
        </p>
      </section>
    </main>
  );
}
