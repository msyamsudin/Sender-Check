# Panduan kontribusi

Terima kasih sudah tertarik. Proyek ini punya satu aturan yang mengalahkan semua aturan
lain, jadi lebih baik disebut di awal.

## Aturan utama: presisi di atas cakupan

Release gate menuntut **precision ≥ 95%** pada `INCONSISTENT`+HIGH dan **nag rate ≤ 3%**
pada kasus yang tidak mencurigakan. Arti praktisnya:

> Menambahkan deteksi baru boleh menurunkan recall. Menurunkan precision tidak boleh.

Alasannya bukan estetika. Sebuah alat yang menandai email sah sebagai mencurigakan akan
dimatikan pengguna dalam hitungan hari, dan setelah itu ia tidak berguna sama sekali —
termasuk untuk email yang benar-benar berbahaya. Karena itu:

- **Jangan menurunkan ambang untuk menaikkan recall.** Kalau sebuah typosquat tidak
  tertangkap, perbaiki logikanya, bukan ambangnya.
- **Setiap rule baru wajib disertai kasus sah yang paling mungkin dipicunya.** Lihat
  bagian berikut.

## Alur adversarial-first

Ini cara kerja yang terbukti menemukan tiga false positive yang tidak terlihat oleh
corpus umum sama sekali.

Sebelum menambahkan rule atau menaikkan strength:

1. Tulis dulu kasus **sah** yang paling mungkin dipicu rule itu, di
   `tools/corpus/fixtures/adversarial.json`.
2. Jalankan `pnpm corpus`. Kalau kasus sah itu ter-flag, logikanya belum cukup tajam.
3. Baru kemudian tambahkan kasus yang memang harus terdeteksi.

Ketiga false positive yang ditemukan saat pengembangan semuanya berasal dari langkah ini:
domain pribadi yang berbeda satu huruf dari nama pemiliknya, nama perusahaan yang menjadi
komponen domainnya sendiri, dan label IDN yang bentuk Latinnya berbeda panjang dari
namanya. Tidak satu pun berasal dari corpus umum.

## Sebelum mengirim pull request

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm corpus
```

Ketiganya harus lulus, dan `pnpm corpus` harus melaporkan `Release gate lulus`. Untuk perubahan
dokumentasi, jalankan juga `pnpm docs:check` — pemeriksa itu memastikan setiap tautan dan path yang
disebut di dokumentasi benar-benar ada.

## Aturan yang ditegakkan otomatis

Beberapa hal tidak bergantung pada kebaikan hati peninjau, melainkan gagal di CI:

| Aturan | Ditegakkan oleh |
|---|---|
| `packages/core` tidak memuat DOM, `chrome.*`, jaringan, jam, RNG, atau `eval` | `packages/core/tests/architecture.test.ts` |
| Tidak ada kode rule yang mati atau tidak terpicu fixture | `tools/corpus/tests/rule-coverage.test.ts` |
| Tidak ada berkas teks yang rusak encodingnya | `tools/corpus/tests/repo-hygiene.test.ts` |
| Tautan dan path di dokumentasi benar-benar ada | `tools/corpus/tests/docs.test.ts` |
| Engine deterministik untuk seluruh corpus | `tools/corpus/tests/rule-coverage.test.ts` |

## Menambahkan rule baru

1. Tambahkan kode ke `ALL_RULE_CODES` di `packages/core/src/types.ts`.
2. Pancarkan kode itu dari `packages/core/src/evidence/rules.ts`.
3. Tambahkan fixture di `tools/corpus/fixtures/` yang memicunya, dan satu kasus sah yang
   hampir mirip di `adversarial.json`.
4. Perbarui tabel di `docs/RULES.md`. Kolom turunannya dapat dihasilkan ulang:

   ```bash
   pnpm rules
   ```

   Keluaran perintah itu adalah baris Markdown siap tempel. Kolom "arti" tetap ditulis
   manusia.
5. Naikkan `ALGORITHM_VERSION` di `packages/core/src/version.ts` dan catat di
   `CHANGELOG.md`.
6. Jalankan `pnpm test` dan `pnpm corpus`.

Kalau sebuah kode tidak dapat dipicu oleh fixture mana pun, test kelengkapan katalog akan
gagal. Itu disengaja: rule yang tidak punya kasus nyata adalah rule yang belum dipahami.

## Gaya penulisan

- **Komentar menjelaskan *mengapa*, bukan *apa*.** Kode sudah menjelaskan apa yang
  dilakukannya. Yang perlu ditulis adalah alasan di balik pilihan tersebut, terutama
  ketika pilihannya tampak aneh. Banyak komentar di repositori ini berbentuk "ini terlihat
  berlebihan, tetapi tanpa ini kasus X akan salah" — pertahankan gaya itu.
- **Jangan mengedit berkas `*.generated.ts` secara manual.** Keduanya punya generator di
  `tools/`. Lihat `README.md` bagian "Regenerasi data".
- **Jangan menambah dependensi runtime.** Engine tidak boleh punya dependensi selain
  bahasa dan API standar. Untuk data seperti PSL dan tabel confusable, gunakan generator
  build-time.

## Melaporkan false positive atau false negative

Cara paling berguna: kirim **contoh email nyata** dengan alamat dan display name
disamarkan seperlunya, bukan deskripsi abstrak.

```json
{
  "id": "suspicious-laporan-001",
  "label": "suspicious",
  "category": "reply-to-asserts-identity",
  "note": "Penjelasan singkat mengapa ini mencurigakan menurut penilaian manusia.",
  "identity": {
    "displayName": "Rise",
    "fromAddress": "no-reply@mngl.in",
    "replyTo": "support@riseworks.digital",
    "returnPath": "no-reply@mngl.in"
  }
}
```

Sertakan header Tier B (`replyTo`, `returnPath`, `authenticationResults`) bila ada.
Sertakan juga kasus sah yang paling mirip, kalau kamu punya — itu yang membuat
perbaikannya tidak menimbulkan masalah baru.

Labelnya adalah **penilaianmu sebagai manusia**, bukan keluaran engine. Itu justru
intinya: kalau ekspektasi dihasilkan oleh engine yang sedang diuji, pengujiannya tidak
membuktikan apa pun.

## Yang belum dikerjakan

Bagian 13 pada `docs/DESIGN.md` memuat status setiap phase. Yang paling dibutuhkan
sekarang adalah **snapshot DOM Gmail** (list view, thread, thread tanpa display name, dan
halaman "Show original") untuk membangun adapter. Tanpa itu, Phase 7 terblokir.
