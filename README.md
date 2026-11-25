This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Desain 3D (AI + MCP)

Buka menu **Desain 3D** (`/studio`). Jalankan dengan `npm run dev`; server hanya menerima koneksi dari komputer ini.

1. Isi API key Claude atau tambah koneksi model lain (API kompatibel OpenAI) di tab **Pengaturan**. Tidak perlu restart. Kunci disimpan sebagai teks biasa di `.data/settings.json` (tidak masuk git, izin 600). Pemakaian API dikenai biaya oleh penyedianya.
Prompt AI (3D dan PCB) menerima lampiran: tempel (⌘/Ctrl+V), seret, atau tombol **Lampirkan**. Gambar (PNG/JPG/WEBP/GIF, diperkecil otomatis; GIF besar hanya diambil satu frame), PDF maksimal 10 MB (khusus Claude), dan file teks; maksimal 5 file. Model lain harus mendukung gambar. Video dan audio belum didukung.

2. Hubungkan lewat MCP (sesuaikan port): `claude mcp add --transport http fluxion3d http://localhost:3000/api/mcp`. Contoh untuk aplikasi lain ada di tab **Koneksi**.
3. REST API: `GET /api/scene` dan `POST /api/scene` dengan `op`: `add`, `update`, `remove`, `replace`, atau `undo`.
4. Ekspor: GLB, OBJ, STL, JSON.
5. Cetak 3D: STL diekspor dengan Z ke atas, titik terendah di Z=0, 1 satuan = 1 mm; `plane` dilewati. Bentuk bertumpuk tidak digabung (belum ada operasi boolean/lubang). Desain buatan AI di aplikasi memakai skala meter, jadi perbesar di slicer atau minta ukuran dalam mm lewat MCP.

Batasan: satu scene bersama, disimpan di `.data/scene.json` (riwayat urungkan hilang saat server restart). Bentuk masih berupa primitif. Dirancang untuk pemakaian lokal; jangan di-deploy publik tanpa menambahkan autentikasi.

## Desain PCB (AI + MCP)

Buka menu **Desain PCB** (`/pcb`). Pengaturan model sama dengan studio 3D.

1. Tab **AI**: rancang dari deskripsi, revisi, review, atau minta perbaiki masalah. AI memilih komponen, netlist, dan tata letak.
2. Bentuk pad diambil dari pustaka footprint (`lib/pcb.ts`), bukan dari AI. Jalur dibuat oleh autorouter dua lapis (`lib/pcb-router.ts`).
3. Seret komponen untuk memindahkan; tombol `R` memutar 90°. Jalur dihitung ulang.
4. Ekspor Gerber (ZIP): tembaga, solder mask, silkscreen, garis papan, bor Excellon, BOM, posisi komponen. Ada juga ekspor/impor JSON.
5. MCP (alamat yang sama dengan studio 3D): `get_board`, `set_board`, `move_component`, `remove_component`, `undo_board`.
6. REST API: `GET /api/pcb` dan `POST /api/pcb` dengan `op`: `replace`, `move`, `remove`, atau `undo`.

Batasan: komponen hanya di lapisan atas; footprint terbatas pada daftar; satu lebar jalur untuk semua net; tidak ada copper pour atau editor jalur manual; silkscreen hanya kotak komponen (tanpa teks dan penanda pin 1); tidak ada simulasi atau ERC. Cek di aplikasi hanya mencakup tata letak, netlist, dan sambungan. Sebelum memesan: periksa Gerber di penampil Gerber, cocokkan pinout dengan datasheet, dan jalankan DFM pabrik. Satu papan bersama, disimpan di `.data/pcb.json`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
