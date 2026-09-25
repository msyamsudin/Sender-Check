# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), dan versi
mengikuti [Semantic Versioning](https://semver.org/lang/id/).

Catatan penting tentang dua nomor versi di proyek ini:

- **Versi paket** (`package.json`) mengikuti riwayat repositori.
- **`ALGORITHM_VERSION`** (`packages/core/src/version.ts`) menyatakan versi keputusan
  analisis. Nilai ini ikut disertakan pada setiap verdikt dan menjadi bagian dari cache
  key, sehingga hasil lama tidak pernah dipakai ulang setelah algoritma berubah.

Keduanya wajib dinaikkan setiap kali rule, ambang, atau decision table berubah.

## [0.3.0] — 2026-09-24

Adapter webmail dan skrip konsol Firefox. `ALGORITHM_VERSION` **tidak berubah** (tetap
`0.2.0`), karena tidak ada rule, ambang, maupun decision table yang disentuh — inilah
bedanya versi paket dan versi algoritma yang dimaksudkan sejak awal.

### Ditambahkan

- **`packages/adapters`** — jembatan antara DOM webmail dan engine.
  - Tier A: `scanGmailInbox()` membaca display name dan alamat dari atribut `email`,
    `name`, dan `data-hovercard-id`.
  - Tier B: `scanGmailShowOriginal()` mengurai header mentah dari halaman Show original.
  - `probe()` melaporkan berapa elemen yang cocok untuk **setiap** kandidat selector,
    sehingga selector dapat diverifikasi terhadap Gmail sungguhan alih-alih ditebak.
  - Bekerja pada antarmuka `DocumentLike` dan `ElementLike` yang dipersempit, sehingga
    logikanya teruji di Node dengan DOM tiruan tanpa jsdom dan tanpa browser.
- **`tools/console`** — skrip konsol Firefox. Menghasilkan dua bundel: probe selector
  (13 KB) dan probe + analisis (281 KB). Tidak ada network request; keluarannya hanya ke
  konsol dan clipboard lokal.
- Decoder *encoded-word* RFC 2047, sehingga display name non-ASCII seperti
  `=?UTF-8?B?...?=` dapat dianalisis. Tanpa ini, nama seperti "José Álvarez" tiba sebagai
  teks sampah dan seluruh perbandingan nama menjadi tidak berarti.
- `docs/FIREFOX.md`: cara memakai di Firefox, dua jebakan khas Firefox yang sudah
  diketahui, dan cara memuat ekstensi sementara lewat `about:debugging`.
- Test arsitektur untuk adapters: tidak boleh menyentuh global DOM secara langsung, dan
  tidak boleh mengimpor `analyze`.

### Diperbaiki

- Penjaga encoding berkas kini memeriksa **seluruh** berkas JSON, bukan hanya fixture.
  Versi sebelumnya tidak menangkap enam `package.json` yang ber-BOM akibat
  `Set-Content -Encoding utf8` PowerShell, dan BOM membuat `JSON.parse` gagal.
- **Indikator "via" tidak pernah terbaca.** Adapter mencarinya dengan menaiki
  `parentElement` dari elemen pengirim, padahal penandanya **bersaudara** dengannya di
  dalam `tr`; ditambah batas 400 karakter yang selalu terlampaui oleh panjang baris
  Gmail. Akibatnya `gmailViaHint` selalu kosong, dan rule `GMAIL_VIA_ESP_HINT` tidak
  pernah muncul. Pencarian kini dimulai dari wadah baris dan dilakukan ke dalam.
- **Bukti berpolarity `context` tidak pernah terlihat di skrip konsol.** Laporan
  menyaringnya keluar dari blok INCONSISTENT, sehingga keterangan seperti
  "via sendgrid.net" tidak akan tampil walaupun adapter sudah membacanya — bertentangan
  dengan `docs/USAGE.md` dan `examples/analyze-emails.ts`. Kini keterangan konteks ikut
  dicetak, dan pengirim yang tidak ditandai tetap menampilkan keterangannya.
- **`fromAddress` dari halaman Show original berisi nilai header utuh**, bukan alamat
  saja seperti pada Tier A. Pemanggil yang mencetak `displayName <fromAddress>`
  menghasilkan alamat bersarang (`Rise <Rise <no-reply@mngl.in>>`). Kedua jalur kini
  menghasilkan bentuk yang sama.
- **`gmailOwnWarning` menyala hanya karena ada elemen `[role="alert"]`.** Gmail memakai
  `role="alert"` untuk banyak hal di luar peringatan keamanan, sehingga rule
  `GMAIL_OWN_WARNING_PRESENT` dapat memberi tahu pengguna sesuatu yang tidak benar. Isi
  teks peringatannya kini diperiksa lebih dulu.
- **`pnpm docs:check` menuntut keberadaan artefak build yang diabaikan git**
  (`tools/console/dist/` dan `tools/corpus/reports/`). Akibatnya pemeriksa itu **lulus
  secara palsu** di mesin yang sudah pernah `pnpm console:build` dan gagal di CI yang
  baru saja meng-clone — kegagalan pertama repositori ini. Artefak build kini
  didaftarkan sebagai pengecualian, tetapi hanya bila generatornya benar-benar ada,
  sehingga path yang salah tulis di dalam direktori itu tetap tertangkap.
- **CI tidak pernah menjalankan `pnpm console:build`.** Bundel di `tools/console/dist/`
  diabaikan git, sehingga langkah `docs:check` yang menautkan direktori itu gagal di
  checkout bersih. Langkah build kini dijalankan sebelum pemeriksaan dokumentasi.

### Ditambahkan (revisi sebelum rilis)

- `tools/console/tests/laporan.test.ts`: penjaga untuk **teks yang dicetak** skrip konsol.
  Skrip itu hanya berjalan di halaman Gmail, sehingga dua kerusakan pelaporan di atas
  lolos tanpa satu pun error. Test ini menjalankannya pada DOM tiruan dan memeriksa
  keluarannya, termasuk memastikan bundel di `dist/` tidak tertinggal dari sumbernya.
- Penjaga kebersihan: tidak ada berkas sementara berawalan `zz-` yang tertinggal, dan
  tidak ada alamat surel pribadi di dalam repositori. Alamat pada blok header contoh
  diganti `penerima@example.com`.

### Catatan tentang model ancaman Tier B

Karena isi pesan dikendalikan penyerang, penguraian header halaman Show original dibatasi
dua penjagaan: blok header dicari lewat skor **header tepercaya** (`Return-Path`,
`Authentication-Results`, `DKIM-Signature`, `Delivered-To`, `Received` — minimal dua), dan
penguraian berhenti pada baris kosong pertama sesuai konvensi RFC 822. Tanpa keduanya,
sebuah email cukup menulis `Return-Path:` palsu di badannya untuk membalik hasil analisis,
dan alat ini berubah menjadi alat yang menipu penggunanya sendiri.

## [0.2.0] — 2026-09-24

### Ditambahkan

- **Gate G7 dan rule `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`.** Lahir dari kasus
  phishing nyata yang lolos: `Rise <no-reply@mngl.in>` dengan
  `Reply-To: support@riseworks.digital`. Domain From tidak memuat "rise" sama sekali,
  sedangkan domain tujuan balasan memuatnya, dan seluruh rantai autentikasi lulus untuk
  `mngl.in` sehingga webmail tidak menampilkan peringatan. Sebelum perubahan ini engine
  mengembalikan `UNASSESSABLE` untuk email tersebut.
- `ALL_RULE_CODES` sebagai daftar runtime, sehingga kelengkapan katalog rule dapat diuji.
- Test kelengkapan katalog: memastikan tidak ada kode rule yang mati dan tidak ada kode
  yang tidak terpicu oleh fixture mana pun.
- Test penjaga encoding berkas dan kebersihan repositori.
- Fixture `realworld.json` (pola serangan yang dilaporkan beserta varian sahnya) dan
  `coverage.json` (kelas kasus yang sebelumnya tidak terwakili sama sekali).
- `docs/USAGE.md`, `docs/RULES.md`, `CONTRIBUTING.md`, `THIRD_PARTY.md`, dan CI.

### Diubah

- `GateInput` menerima `ResolvedIdentity` utuh, bukan hanya bagian From. Sebelumnya gate
  secara struktural tidak mampu melihat header Tier B, dan itulah akar penyebab kasus di
  atas lolos.
- Ambang kecocokan homoglyph turun dari 5 menjadi 3 karakter, karena ambang 5 membuang
  akronim yang justru paling sering dipalsukan (`ovo`, `bca`, `bri`, `bni`, `dana`).
- Pencocokan fuzzy token pendek memakai syarat "berbeda tepat satu karakter", sehingga
  typosquat 5–6 huruf (`gojeg`, `bnl`, `shope`) dapat diperiksa tanpa membuka false
  positive pada varian ejaan nama orang.
- `AUTH_DMARC_FAIL` turun dari `strong` menjadi `medium`, karena DMARC mengautentikasi
  domain dan bukan display name.
- `normalizeForComparison` memakai urutan NFD → buang tanda → NFKC. Urutan sebelumnya
  membuat tahap penghapusan diakritik tidak pernah benar-benar bekerja.

### Diperbaiki

- Karakter tak terlihat tidak dibuang pada tahap normalisasi, sehingga `goog`+U+200B+`le`
  terpecah menjadi dua token dan tidak pernah cocok dengan `google`.
- `TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL` menyala untuk token yang berada di **local-part**,
  karena target gabungan local-part+domain ikut diperiksa. Akibatnya pesan sah tertekan
  menjadi `UNCLEAR`.
- `localPartCandidates` menghasilkan `smiths`; seharusnya `smithj`.
- Kode rule `DISPLAY_NAME_TOKEN_MATCHES_DOMAIN_LABEL` dideklarasikan tetapi tidak pernah
  dipancarkan. Dihapus.
- Tiga false positive pada pola sah: domain pribadi berbeda satu huruf dari nama
  pemiliknya, nama perusahaan yang menjadi komponen domainnya sendiri, dan label IDN yang
  bentuk Latinnya berbeda panjang dari namanya.

### Hasil terukur

400+ kasus berlabel: precision `INCONSISTENT`+HIGH 100%, nag rate visible 0,0%, recall
76,4%.

## [0.1.0] — 2026-09-24

### Ditambahkan

- Engine analisis lengkap di `packages/core`: normalisasi TR39 skeleton, decoder punycode
  RFC 3492, algoritma PSL lengkap dengan wildcard dan exception, taksonomi enam kelas
  domain, name analyzer, similarity engine, evidence engine, dan decision table.
- Gate klaim identitas G1–G6.
- Corpus harness CLI yang berjalan di Node tanpa browser, beserta laporan markdown
  otomatis dengan confusion matrix.
- Generator build-time untuk tabel PSL dan confusable Unicode.
- 145 test: unit, property, end-to-end, dan test arsitektur.

### Catatan

Adapter Gmail dan UI ekstensi belum ada. Lihat bagian 13 pada `docs/DESIGN.md`.
