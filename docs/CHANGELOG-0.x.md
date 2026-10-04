# Riwayat rilis 0.1.0 – 0.3.0

Arsip beku. Ketiga versi ini dirilis **sebelum repositori ini memakai tag**, sehingga tidak ada
tag maupun GitHub Release yang menaunginya: isi di bawah adalah satu-satunya catatan yang ada, dan
ia dipindahkan ke sini apa adanya agar `CHANGELOG.md` dapat menyusut menjadi indeks.

Catatan rilis versi berikutnya tidak lagi ditulis di berkas mana pun di repositori ini — ia hidup
di **pesan tag** dan GitHub Releases, dan disusun otomatis dari judul serta badan pull request.
Prosedurnya ada di `CONTRIBUTING.md`, bagian "Merilis versi".

## Koreksi yang tercatat sebelum rilis otomatis diaktifkan

Daftar ini berasal dari bagian `[Unreleased]` `CHANGELOG.md` sebelum berkas itu menjadi indeks.
Ia dipindahkan ke sini supaya tidak hilang, dan **tidak** dipelihara lagi: untuk rilis berikutnya,
kalimat seperti ini ditulis di badan pull request, lalu ikut ke catatan rilis apa adanya.

- Panel pernah menjelaskan orang yang salah — chip penerima ("to saya") ikut dibaca sebagai
  pengirim; kini hanya pengirim di dalam percakapan yang terbuka.
- Klaim palsu tentang selector penanda "via" (`span.zx`) dicabut: 0 kecocokan pada setiap probe
  nyata, dan pembacaan "via" kini disebut *best-effort* yang belum pernah terbukti.
- Satu sebutan untuk pengirim tanpa nama (`NO_NAME_LABEL`), dipakai panel, `examples/`, dan probe
  konsol — sebelumnya panel memakai dua bunyi berbeda untuk keadaan yang sama.
- Kalimat bukti disatukan ke `packages/presentation`; **sebelas** kalimat yang dicetak skrip konsol
  berubah karena dua salinannya sudah menyimpang.
- Percobaan "ekstensi mengambil halaman header sendiri" dicabut: janji tanpa permintaan jaringan
  dikembalikan dan dijaga test.
- Bagian preventif pada state `UNASSESSABLE`: panel menyebut mengapa ia tidak menilai, dan langkah
  aman yang dapat dikerjakan pengguna.
- Penjaga arsitektur ekstensi dan penjaga kutipan/angka dokumentasi ditambahkan.
- Angka dan ukuran di dokumen yang sudah basi diperbaiki (`docs/USAGE.md` 400 → 404 kasus; ukuran
  bundel di README).

## [0.3.0] — 2026-09-24

Adapter webmail dan skrip konsol Firefox. `ALGORITHM_VERSION` **tidak berubah** (tetap `0.2.0`),
karena tidak ada rule, ambang, maupun decision table yang disentuh.

### Ditambahkan

- `packages/adapters`: Tier A (`scanGmailInbox()` membaca display name dan alamat dari atribut
  `email`, `name`, dan `data-hovercard-id`) dan Tier B (`scanGmailShowOriginal()` mengurai header
  mentah). Bekerja pada `DocumentLike`/`ElementLike` yang dipersempit, sehingga teruji di Node
  dengan DOM tiruan tanpa jsdom dan tanpa browser.
- `probe()` melaporkan berapa elemen yang cocok untuk **setiap** kandidat selector, sehingga
  selector diverifikasi terhadap Gmail sungguhan alih-alih ditebak.
- `tools/console`: dua bundel yang dapat ditempel ke konsol Firefox, tanpa permintaan jaringan;
  keluarannya hanya ke konsol dan clipboard lokal.
- Decoder *encoded-word* RFC 2047, sehingga display name non-ASCII (`=?UTF-8?B?...?=`) dapat
  dianalisis; tanpa itu nama seperti "José Álvarez" tiba sebagai teks sampah dan perbandingan nama
  menjadi tidak berarti.
- `docs/FIREFOX.md`: cara memakai di Firefox, dua jebakan khasnya, dan cara memuat ekstensi
  sementara lewat `about:debugging`.
- Test arsitektur adapters: tidak menyentuh global DOM secara langsung, dan tidak mengimpor
  `analyze`.

### Diperbaiki

- **Penjaga encoding berkas memeriksa seluruh berkas JSON**, bukan hanya fixture; versi sebelumnya
  tidak menangkap enam `package.json` ber-BOM akibat `Set-Content -Encoding utf8` PowerShell, dan
  BOM membuat `JSON.parse` gagal.
- **Indikator "via" tidak pernah terbaca**: adapter menaiki `parentElement`, padahal penandanya
  bersaudara di dalam `tr`; ditambah batas 400 karakter yang selalu terlampaui panjang baris
  Gmail. Pencarian kini dimulai dari wadah baris dan dilakukan ke dalam.
- **Bukti berpolarity `context` tidak pernah terlihat di skrip konsol**, sehingga keterangan
  seperti "via sendgrid.net" tidak akan tampil walaupun adapter sudah membacanya. Kini ikut
  dicetak, dan pengirim yang tidak ditandai tetap menampilkan keterangannya.
- **`fromAddress` dari halaman Show original berisi nilai header utuh**, bukan alamat saja,
  sehingga pemanggil yang mencetak `displayName <fromAddress>` menghasilkan alamat bersarang
  (`Rise <Rise <no-reply@mngl.in>>`). Kedua jalur kini menghasilkan bentuk yang sama.
- **`gmailOwnWarning` menyala hanya karena ada elemen `[role="alert"]`**, padahal Gmail memakainya
  untuk banyak hal di luar peringatan keamanan; isi teks peringatannya kini diperiksa lebih dulu.
- **`pnpm docs:check` menuntut keberadaan artefak build yang diabaikan git**, sehingga lulus
  secara palsu di mesin yang sudah pernah build dan gagal di CI yang baru meng-clone. Artefak
  build kini pengecualian, tetapi hanya bila generatornya benar-benar ada.
- **CI tidak pernah menjalankan `pnpm console:build`**, padahal `docs:check` menautkan direktori
  bundelnya. Langkah build kini dijalankan sebelum pemeriksaan dokumentasi.

### Ditambahkan (revisi sebelum rilis)

- `tools/console/tests/laporan.test.ts` menjaga **teks yang dicetak** skrip konsol, yang hanya
  berjalan di halaman Gmail; dua kerusakan pelaporan lolos tanpa satu pun error. Test ini juga
  memastikan bundel di `tools/console/dist/` tidak tertinggal dari sumbernya.
- Penjaga kebersihan: tidak ada berkas sementara berawalan `zz-`, dan tidak ada alamat surel
  pribadi di dalam repositori.

### Catatan tentang model ancaman Tier B

Isi pesan dikendalikan penyerang, sehingga penguraian header dibatasi dua penjagaan: blok header
dicari lewat skor header tepercaya (`Return-Path`, `Authentication-Results`, `DKIM-Signature`,
`Delivered-To`, `Received` — minimal dua), dan penguraian berhenti pada baris kosong pertama.
Tanpa keduanya, email cukup menulis `Return-Path:` palsu di badannya untuk membalik hasil
analisis, dan alat ini berubah menjadi alat yang menipu penggunanya sendiri.

## [0.2.0] — 2026-09-24

### Ditambahkan

- **Gate G7 dan rule `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`**, lahir dari kasus phishing nyata
  yang lolos: `Rise <no-reply@mngl.in>` dengan `Reply-To: support@riseworks.digital`. Domain From
  tidak memuat "rise", domain tujuan balasan memuatnya, dan seluruh rantai autentikasi lulus untuk
  `mngl.in` sehingga webmail tidak memperingatkan apa pun.
- `ALL_RULE_CODES` sebagai daftar runtime, test kelengkapan katalog (tidak ada kode mati atau kode
  yang tidak terpicu fixture), serta penjaga encoding berkas dan kebersihan repositori.
- Fixture `realworld.json` (pola serangan yang dilaporkan beserta varian sahnya) dan
  `coverage.json` (kelas kasus yang sebelumnya tidak terwakili).
- `docs/USAGE.md`, `docs/RULES.md`, `CONTRIBUTING.md`, `THIRD_PARTY.md`, dan CI.

### Diubah

- `GateInput` menerima `ResolvedIdentity` utuh, bukan hanya bagian From — akar penyebab kasus di
  atas lolos.
- Ambang kecocokan homoglyph turun 5 → 3 karakter, karena ambang 5 membuang akronim yang justru
  paling sering dipalsukan (`ovo`, `bca`, `bri`, `bni`, `dana`).
- Pencocokan fuzzy token pendek memakai syarat "berbeda tepat satu karakter", sehingga typosquat
  5–6 huruf (`gojeg`, `bnl`, `shope`) dapat diperiksa tanpa membuka false positive pada varian
  ejaan nama orang.
- `AUTH_DMARC_FAIL` turun `strong` → `medium`: DMARC mengautentikasi domain, bukan display name.
- `normalizeForComparison` memakai urutan NFD → buang tanda → NFKC; urutan sebelumnya membuat
  tahap penghapusan diakritik tidak pernah benar-benar bekerja.

### Diperbaiki

- Karakter tak terlihat tidak dibuang, sehingga `goog`+U+200B+`le` terpecah menjadi dua token dan
  tidak pernah cocok dengan `google`.
- `TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL` menyala untuk token yang berada di **local-part**,
  sehingga pesan sah tertekan menjadi `UNCLEAR`.
- `localPartCandidates` menghasilkan `smiths`; seharusnya `smithj`.
- Kode `DISPLAY_NAME_TOKEN_MATCHES_DOMAIN_LABEL` dideklarasikan tetapi tidak pernah dipancarkan;
  dihapus.
- Tiga false positive pada pola sah: domain pribadi berbeda satu huruf dari nama pemiliknya, nama
  perusahaan yang menjadi komponen domainnya sendiri, dan label IDN yang bentuk Latinnya berbeda
  panjang dari namanya.

### Hasil terukur

400+ kasus berlabel: precision `INCONSISTENT`+HIGH 100%, nag rate visible 0,0%, recall 76,4%.

## [0.1.0] — 2026-09-24

- Engine analisis lengkap di `packages/core`: skeleton TR39, decoder punycode RFC 3492, PSL dengan
  wildcard dan exception, taksonomi enam kelas domain, name analyzer, similarity engine, evidence
  engine, dan decision table. Gate klaim identitas G1–G6.
- Corpus harness CLI di Node tanpa browser, laporan markdown otomatis dengan confusion matrix, dan
  generator build-time untuk tabel PSL dan confusable Unicode.
- 145 test: unit, property, end-to-end, dan arsitektur. Adapter Gmail dan UI ekstensi belum ada —
  lihat bagian 13 pada `docs/DESIGN.md`.
