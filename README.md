# FluxionLab

Studio desain **3D** dan **PCB** berbasis AI yang berjalan di komputer sendiri. Model bisa dipilih: Claude atau layanan apa pun dengan API kompatibel OpenAI (OpenAI, OpenRouter, Ollama, dan lainnya). Keduanya juga bisa dikendalikan lewat MCP dan REST API.

## Menjalankan

Butuh Node.js 22.15 atau lebih baru.

```bash
npm ci
```

```bash
npm run dev
```

Untuk pemakaian sehari-hari, gunakan hasil build:

```bash
npm run build && npm start
```

Server hanya menerima koneksi dari komputer ini (`127.0.0.1:3000`). Isi API key Claude atau tambah koneksi model lain di tab **Pengaturan**, tanpa restart. Pemakaian API dikenai biaya oleh penyedianya.

## Fitur

### Percakapan (3D dan PCB)
- Daftar percakapan terpisah untuk 3D dan PCB, di tab **AI**: buat baru, pindah, ganti nama, hapus. Judul diambil dari prompt pertama.
- Tiap percakapan punya riwayat chat **dan desainnya sendiri**. Pindah percakapan ikut mengganti desain di layar, dan riwayat urungkan/ulangi dikosongkan.
- AI menerima paling banyak 20 pesan terakhir dari percakapan aktif, termasuk lampiran lama (yang terbaru didahulukan, dalam batas satu permintaan). Riwayat yang lebih panjang menambah pemakaian token.
- Hanya permintaan yang berhasil yang dicatat. Percakapan tidak bisa diganti dari panel selagi AI bekerja.
- MCP dan REST selalu bekerja pada desain percakapan yang sedang aktif.

### Desain 3D (`/studio`)
- Buat dan revisi scene dari tulisan, gambar, PDF, atau file teks.
- Seret objek langsung di canvas untuk memindahkan secara mendatar; tahan `Shift` (atau tombol Naik-turun) untuk mengubah tinggi. Bidang datar harus dipilih dulu sebelum bisa diseret.
- Edit manual, duplikat, urungkan/ulangi. Pintasan: `Delete`, `⌘/Ctrl+Z`, tambah `Shift` untuk ulangi.
- Ekspor GLB, OBJ, STL, JSON. STL: sumbu Z ke atas, titik terendah di Z=0, 1 satuan = 1 mm, `plane` dilewati.

### Desain PCB (`/pcb`)
- AI memilih komponen, netlist, lebar jalur per net, dan tata letak. Ada review AI dan perbaikan masalah.
- **Perbaiki otomatis** (bisa dimatikan): bila hasil gagal cek, model dipanggil satu kali lagi. Hasil perbaikan dipakai hanya jika masalahnya berkurang tanpa membuang komponen.
- Bentuk pad berasal dari pustaka footprint (`lib/pcb.ts`), bukan dari AI.
- Autorouter dua lapis dengan lebar jalur per net, dijalankan di Web Worker.
- DRC geometris yang terpisah dari router: korsleting, jarak tembaga, jarak ke tepi, net terputus.
- Ekspor ZIP: Gerber (tembaga, mask, silkscreen dengan teks dan penanda pin 1, garis papan), bor Excellon, BOM, posisi komponen, ringkasan fabrikasi.
- Canvas 2D: seret latar untuk geser, roda/cubit untuk zoom, putar tampilan per 90° (tidak mengubah desain), seret komponen untuk memindahkan.
- Canvas 3D: seret untuk memutar, klik kanan untuk geser, roda untuk zoom, seret komponen untuk memindahkan, plus posisi Miring/Atas/Bawah. Bentuk komponen hanya ilustrasi.
- Pintasan: `R` putar, `Delete` hapus, panah geser 0,5 mm (`Shift` 2,54 mm), urungkan/ulangi.

## Integrasi

**MCP** (Streamable HTTP):

```bash
claude mcp add --transport http fluxion3d http://localhost:3000/api/mcp
```

| Bagian | Tool MCP | REST |
|---|---|---|
| 3D | `get_scene`, `set_scene`, `add_objects`, `update_object`, `remove_objects`, `undo`, `redo` | `GET/POST /api/scene` (`add`, `update`, `remove`, `replace`, `undo`, `redo`) |
| PCB | `get_board`, `set_board`, `move_component`, `remove_component`, `undo_board`, `redo_board` | `GET/POST /api/pcb` (`replace`, `move`, `remove`, `rules`, `undo`, `redo`) |

`GET /api/health` untuk pengecekan hidup.

## Data dan keamanan

- Semua data ada di `.data/` (tidak masuk git, file berizin 600): `scene.json`, `pcb.json`, riwayatnya, `settings.json`, riwayat chat (`conversations-*.json`), dan lampiran yang pernah dikirim (`attachments/`, terhapus bersama percakapannya). Penulisan bersifat atomik; file rusak dipindahkan ke `*.rusak-*`, tidak ditimpa. Cadangkan folder ini bila desainnya penting.
- **API key disimpan sebagai teks biasa** di `.data/settings.json`. Kunci tidak dikirim balik ke browser dan disensor dari pesan galat.
- API menolak permintaan lintas situs dan host non-lokal. `FLUXION_API_TOKEN` (di `.env.local`) mengizinkan akses scene/PCB/MCP dengan `Authorization: Bearer …`; pengaturan dan riwayat percakapan selalu hanya lokal.
- Ukuran badan permintaan dibatasi, paling banyak 2 permintaan AI bersamaan, batas waktu AI 280 detik, pengalihan dari penyedia model ditolak, dan header keamanan (termasuk CSP) dipasang.
- Log server berupa satu baris JSON per kejadian, termasuk pemakaian token, tanpa kunci, prompt, atau lampiran.

**Ini aplikasi untuk satu pengguna di komputer sendiri.** Jangan di-deploy publik: belum ada login, pemisahan data antar-pengguna, atau pembatasan per pengguna.

## Pengembangan

```bash
npm run check
```

Menjalankan typecheck, lint, test, dan build. CI (`.github/workflows/ci.yml`) menjalankan hal yang sama ditambah `npm audit`. Test memakai `node:test`, penyedia model tiruan, dan folder data sementara, jadi tidak menyentuh `.data/` dan tidak memanggil API berbayar. Termasuk uji acak 150 papan yang hasil routing-nya wajib lolos DRC.

## Sebelum memesan PCB

Cek di aplikasi tidak menilai benar tidaknya rangkaian. Cocokkan pinout dan nilai komponen dengan datasheet, buka ZIP di penampil Gerber, lalu jalankan DFM pabrik.

## Batasan yang diketahui

- PCB: komponen hanya di lapisan atas; footprint terbatas pada pustaka; tanpa copper pour, editor jalur manual, ERC, simulasi, atau impor/ekspor KiCad. Router bisa gagal pada papan padat (dilaporkan sebagai "belum tersambung").
- 3D: bentuk masih primitif; belum ada operasi boolean. Bentuk bertumpuk tidak digabung saat ekspor STL.
- Hanya satu percakapan aktif per bagian (3D dan PCB); semua tab browser, MCP, dan REST berbagi yang aktif itu. Paling banyak 50 percakapan per bagian dan 200 pesan per percakapan.
