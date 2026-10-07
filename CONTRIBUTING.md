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
pnpm verify
```

`pnpm verify` menjalankan seluruh pemeriksa dalam urutan yang sama dengan CI: typecheck, build
konsol dan ekstensi, pemeriksa tautan dokumentasi, test beserta laporannya, pemeriksa klaim
dokumentasi, pemeriksa indeks CHANGELOG terhadap tag, dan corpus + release gate. Ia ada supaya
kamu tidak perlu menghafal daftar di bawah — kegagalan muncul di mesinmu dulu, bukan di CI.

Urutannya penting, bukan kosmetik: `docs:claims` membaca laporan JSON yang ditulis `test:report`,
dan pemeriksa dokumentasi membaca hasil build dua bundel. Bila kamu hanya ingin menjalankan ulang
yang relevan dengan perubahanmu, ini perintah per satuan:

- `pnpm corpus` — harus melaporkan `Release gate lulus`.
- `pnpm docs:check` — perubahan dokumentasi: pemeriksa ini memastikan setiap tautan dan path yang
  disebut di dokumentasi benar-benar ada.
- `pnpm changelog:check` — perubahan `CHANGELOG.md` atau apa pun yang berkaitan dengan rilis: ia
  membandingkan setiap baris indeks dengan tag yang benar-benar ada, beserta `ALGORITHM_VERSION`
  yang disebut pesan tag itu. Ia membaca tag, jadi `git fetch --tags` lebih dulu bila checkout-mu
  dangkal.
- `pnpm test:report` lalu `pnpm docs:claims` — perubahan yang menambah atau menghapus test: yang
  kedua membandingkan angka yang dikutip dokumentasi — jumlah test, jumlah berkasnya, jumlah kasus
  corpus — dengan hasil test yang benar-benar berjalan, dan kegagalannya menyebut angka baru yang
  seharusnya ditulis. CI menjalankan keduanya dengan urutan itu, jadi pull request yang menambah
  test tanpa memperbarui angkanya akan gagal di sana, bukan setelah di-merge.

## Aturan yang ditegakkan otomatis

Beberapa hal tidak bergantung pada kebaikan hati peninjau, melainkan gagal di CI:

| Aturan | Ditegakkan oleh |
|---|---|
| `packages/core` tidak memuat DOM, `chrome.*`, jaringan, jam, RNG, atau `eval` | `packages/core/tests/architecture.test.ts` |
| Tidak ada kode rule yang mati atau tidak terpicu fixture | `tools/corpus/tests/rule-coverage.test.ts` |
| Angka dan klaim keadaan di dokumentasi cocok dengan kenyataan | `pnpm docs:claims` |
| Setiap baris indeks CHANGELOG cocok dengan tag yang benar-benar ada dan pesannya | `pnpm changelog:check` |
| Setelan repositori yang diandalkan rilis (pemelihara — tidak di CI, `GITHUB_TOKEN` tidak boleh membacanya) | `pnpm repo:settings` |
| Tidak ada berkas teks yang rusak encodingnya | `tools/corpus/tests/repo-hygiene.test.ts` |
| Tautan dan path di dokumentasi benar-benar ada | `tools/corpus/tests/docs.test.ts` |
| Engine deterministik untuk seluruh corpus | `tools/corpus/tests/rule-coverage.test.ts` |

## Menambahkan rule baru

1. Tambahkan kode ke `ALL_RULE_CODES` di `packages/core/src/types.ts`.
2. Pancarkan kode itu dari `packages/core/src/evidence/rules.ts`.
3. Tambahkan fixture di `tools/corpus/fixtures/` yang memicunya, dan satu kasus sah yang
   hampir mirip di `adversarial.json`.
4. Perbarui tabel di `docs/RULES.md`. Kode dan polaritasnya dijaga test
   (`tools/corpus/tests/docs.test.ts`), jadi rule baru membuat test gagal sampai barisnya
   ditambahkan. Kolom "arti" ditulis manusia, dan sel `Strength` boleh menulis rentang
   (`strong / medium`) bila bobotnya memang berubah menurut kasus.

   ```bash
   pnpm rules
   ```

   Perintah itu mencetak tabel audit: kode, polaritas, strength, tier, dan contoh fixture.
   Ia untuk membandingkan katalog dengan dokumen, **bukan** untuk ditempel ke
   `docs/RULES.md` — bentuk kolomnya berbeda, dan alasannya ada di
   `tools/corpus/src/rules-table.ts`.
5. `ALGORITHM_VERSION` **tidak perlu disentuh**: rilis otomatis menaikkannya sendiri bila ada
   berkas di `packages/core/src` yang berubah. Lihat "Merilis versi" di bawah.
6. Jalankan `pnpm test` dan `pnpm corpus`.

Kalau sebuah kode tidak dapat dipicu oleh fixture mana pun, test kelengkapan katalog akan
gagal. Itu disengaja: rule yang tidak punya kasus nyata adalah rule yang belum dipahami.

## Merilis versi

**Rilis berjalan otomatis, dan tidak ada langkah manual.** Itu disengaja: yang tidak dikerjakan
manusia tidak dapat terlupa, dan versi yang tertinggal adalah kegagalan yang tidak terlihat —
tidak ada yang gagal, hanya ada perubahan yang tidak pernah sampai ke pengguna.

Catatan rilis **tidak** ditulis di berkas mana pun di repositori ini. Ia hidup di **pesan tag** dan
GitHub Release, sehingga hanya dibaca saat ditanya, dan tidak ada salinan kedua yang bisa
menyimpang. `CHANGELOG.md` hanya indeks: satu baris per versi, ditambahkan otomatis. Riwayat
0.1.0–0.3.0, yang dirilis sebelum tag dan rilis otomatis dipakai, dibekukan di
`docs/CHANGELOG-0.x.md`.

### Apa yang terjadi saat `main` menerima push

1. Job `verify` menjalankan typecheck, test, build ekstensi, pemeriksaan dokumentasi, dan release
   gate corpus.
2. Kalau lulus, job `release` menjalankan `node tools/release/src/prepare.ts`, yang:

   - menghitung versi paket dari tipe commit sejak tag terakhir: `feat` → minor, perubahan yang
     merusak (`!` atau `BREAKING CHANGE:`) → major, selebihnya patch;
   - menaikkan `ALGORITHM_VERSION` satu patch bila ada berkas di `packages/core/src` yang berubah.
     Aturan itu lebih luas daripada definisi "rule, ambang, atau decision table", dan sengaja
     begitu: menaikkannya terlalu sering hanya membuang cache verdikt pengguna, sedangkan
     melewatkannya membuat hasil analisis lama terus dipakai. Alasannya ada di komentar
     `tools/release/src/version.ts`;
   - memperbarui `DATA_UPDATED_AT` bila data non-generated berubah;
   - menyusun catatan rilis dari judul **dan badan** commit, lalu menulisnya di luar repositori;
   - menambahkan satu baris di tabel indeks `CHANGELOG.md`.

3. Commit `chore(release): <versi>` didorong, tag `v<versi>` dibuat dengan catatan rilis sebagai
   pesannya, lalu GitHub Release dibuat dari pesan tag itu.

Job `release` bergantung pada `verify` (`needs: verify`), sehingga tag tidak pernah dibuat untuk
commit yang gagal. Perhatikan juga: commit yang didorong `GITHUB_TOKEN` **tidak memicu workflow
lain**, jadi tag yang dibuat otomatis tidak menjalankan job `release-check` — job itu ada untuk tag
yang ditandai tangan, dan job `release` sudah memeriksa hal yang sama lewat `needs`.

### Yang tersisa untuk manusia

Dua hal saja, dan keduanya sudah dikerjakan sambil menulis perubahannya:

- **Judul pull request** menentukan jenis kenaikan versi. Judul yang tidak mengikuti bentuk
  konvensional tetap menghasilkan rilis `patch`: perubahan yang tidak pernah dirilis lebih buruk
  daripada rilis yang nomornya kurang tepat.
- **Badan pull request** menjadi isi catatan rilis. Di situlah kalimat yang tidak dapat dihasilkan
  mesin ditulis — klaim yang dicabut, angka yang dikoreksi, alasan sebuah keputusan berubah. Pada
  squash merge, badan itu ikut ke badan commit, sehingga tidak ada catatan kedua yang harus
  diperbarui. Badan yang panjang dipotong di catatan rilis, dan penunjuknya memakai nomor pull
  request bila judulnya memuat `(#N)` — karena itu jangan menghapus akhiran itu saat squash merge
  dari CLI; bila tidak ada, penunjuknya memakai SHA commit.

### Memeriksa dan menghentikan

Untuk melihat apa yang **akan** dirilis, tanpa membuat tag dan tanpa mengubah berkas apa pun:

```bash
node tools/release/src/prepare.ts --dry-run
```

Untuk menghentikan rilis sementara, matikan job `release` di `.github/workflows/ci.yml`. Menandai
versi secara manual tetap mungkin, dan tetap diperiksa job `release-check`: tag harus sama dengan
`v` + versi di `package.json`, dan pesan tag harus memuat baris `ALGORITHM_VERSION: <nilai>` yang
cocok dengan `packages/core/src/version.ts`.

Tag manual wajib **dianotasi** (`git tag -a`). Catatan rilis hidup di pesan tag, dan tag ringan
tidak punya pesan sama sekali; `release-check` menolaknya sambil menyebut sebabnya, bukan melaporkan
pesan yang "tidak memuat" sesuatu yang memang tidak ada.

### Satu prasyarat, sekali

Job `release` meminta `permissions: contents: write` untuk mendorong commit dan tag. GitHub
membatasinya lewat pengaturan repositori: **Settings → Actions → General → Workflow permissions**
harus "Read and write permissions". Tanpa itu, `needs: verify` tetap lulus tetapi langkah
`git push` gagal — dan kegagalannya adalah satu-satunya cara rilis otomatis ini diam.

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

Bagian 13 pada `docs/DESIGN.md` memuat status setiap phase. Selector adapter sudah diverifikasi pada
Gmail sungguhan, dan tiga dari empat snapshot DOM-nya sudah tersimpan di
`tools/corpus/dom-snapshots/`. Yang belum dapat diambil adalah snapshot pengirim **tanpa display
name** — alasannya, termasuk bentuk markup yang benar bila suatu saat ditemukan, ada di README
direktori itu. Di luar itu, yang menunggu bukan lagi pengamatan melainkan pekerjaan kode: cache
`storage.session` dan `IntersectionObserver` untuk indikator list view, i18n, halaman
privasi, dan packaging.
