# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), dan versi
mengikuti [Semantic Versioning](https://semver.org/lang/id/).

Catatan penting tentang dua nomor versi di proyek ini:

- **Versi paket** (`package.json`) mengikuti riwayat repositori.
- **`ALGORITHM_VERSION`** (`packages/core/src/version.ts`) menyatakan versi keputusan
  analisis. Nilai ini ikut disertakan pada setiap verdikt dan menjadi bagian dari cache
  key, sehingga hasil lama tidak pernah dipakai ulang setelah algoritma berubah.

Keduanya wajib dinaikkan setiap kali rule, ambang, atau decision table berubah.

## [Unreleased]

Tidak ada rule, ambang, maupun decision table yang disentuh, dan tidak ada perilaku yang
berubah. `ALGORITHM_VERSION` **tidak berubah** (tetap `0.2.0`), dan versi paket juga tidak
dinaikkan.

### Ditambahkan

- **`packages/presentation`** — lapisan penyajian murni: `code` + `args` dari engine menjadi
  kalimat dan struktur tampilan. Tanpa DOM, tanpa `chrome.*`, tanpa network, sehingga dapat
  diuji di Node. Dipakai skrip konsol, contoh pemakaian, generator tabel rule, dan — pada
  langkah berikutnya — panel ekstensi. Paket ini lahir karena panel ekstensi membutuhkan
  kalimat yang sama, dan salinan yang dibuat untuknya pasti menyimpang.
- **Penjaga argumen kalimat.** `tools/corpus/tests/presentation.test.ts` merender **setiap**
  kode rule memakai `args` yang benar-benar dipancarkan fixture, lalu menolak kalimat yang
  memuat `undefined`, `NaN`, `[object Object]`, atau `${`. Ini satu-satunya cara menangkap
  template yang menyebut nama argumen yang salah: test kelengkapan hanya dapat membuktikan
  bahwa sebuah template ada, bukan bahwa ia membaca argumen yang benar.
- **Penjaga kutipan dokumentasi.** Test yang sama memastikan README dan `docs/USAGE.md`
  benar-benar memuat kalimat yang dihasilkan untuk kasus Reply-To, sehingga dokumentasi tidak
  dapat menyimpang dari keluaran tanpa ada yang gagal.
- **Tiga kode Tier B akhirnya punya kalimat.** `RETURN_PATH_NULL_OR_MISMATCH`, `AUTH_SPF_FAIL`,
  dan `AUTH_DKIM_FAIL` sebelumnya tidak punya template sama sekali di mana pun, sehingga
  pengguna melihat `trace` mentah yang ditulis untuk pengembang. Untuk Return-Path, kalimatnya
  membedakan dua keadaan yang berbeda arti: headernya tidak ada, atau domainnya berbeda.

- **Penjaga untuk angka keluaran corpus yang dikutip dokumentasi.**
  `tools/corpus/tests/docs.test.ts` kini membandingkan blok "Arti keluaran" di
  `docs/USAGE.md` dengan keluaran corpus yang sebenarnya. Ringkasannya diambil dari
  `summaryLines()` di `tools/corpus/src/harness.ts`, yaitu fungsi yang sama yang dipakai CLI,
  sehingga tidak ada dua versi kebenaran. Sebelumnya CLI menyusun ringkasannya sendiri dan
  dokumentasi menyalinnya dengan tangan — dan salinan itu memang menyimpang. Keluarannya
  sudah dipastikan tidak berubah setelah pemindahan itu.
  Dua hal dijaga: **setiap angka** yang dikutip harus sama dengan kenyataan, dan **daftar
  kuncinya** dipatok, supaya metrik yang ditambahkan atau baris yang dihapus tidak lewat
  tanpa disadari. `state` dibandingkan sebagai himpunan, bukan urutan, agar menata ulang
  fixture tidak menghasilkan kegagalan palsu.
  Penjaganya diuji dengan sengaja merusak satu angka: test gagal dan menyebutkan nilai
  dokumen beserta nilai sebenarnya. Penjaga yang belum pernah terbukti gagal belum
  membuktikan apa pun.

### Diubah

- **Kalimat bukti disatukan, dan dua salinannya ternyata sudah menyimpang.** Template hidup di
  `tools/console/src/main.ts` **dan** `examples/analyze-emails.ts`. Untuk
  `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`, yang pertama menulis "ada di domain tujuan
  balasan" dan yang kedua "muncul di" — sementara README dan `docs/USAGE.md` mengutip versi
  kedua, dan test skrip konsol menuntut versi pertama. Dokumentasi repositori ini menuntut dua
  hal yang tidak dapat benar bersamaan. Yang bertahan adalah versi yang sudah dikutip
  dokumentasi, karena ia juga lebih informatif pada beberapa kode (mis.
  `DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS` menyertakan alamatnya, bukan hanya menyatakan bahwa
  alamat itu ada). Akibatnya **sebelas kalimat** yang dicetak skrip konsol berubah; test
  laporannya ikut diperbarui, dan perubahannya disengaja.
- **`MARK`, `shortPolarity`, dan `POLARITY_LABEL` kini hanya ada satu salinannya.** Sebelumnya
  ketiganya ada di skrip konsol dan di contoh pemakaian, dengan `POLARITY_LABEL` muncul sekali
  lagi di generator tabel rule sebagai peta yang bentuknya berbeda untuk arti yang sama.
  Semuanya sekarang berasal dari `packages/presentation`; keluaran `pnpm rules` dipastikan
  tidak berubah.
- **`docs/DESIGN.md` bagian 12 tidak lagi menyebut `packages/adapters` sebagai "belum ada".**
  Paket itu sudah ada sejak 0.3.0. Yang benar-benar tersisa hanyalah ekstensinya, dan alasan
  tertahannya bukan penulisan kode melainkan verifikasi selector.

### Diperbaiki

- **Klaim palsu tentang selector penanda "via".** `packages/adapters/src/gmail.ts` menyatakan
  `span.zx` "dilaporkan cocok 1 pada probe halaman inbox sungguhan". Angka 1 itu sebenarnya
  milik `[role="alert"]` pada keluaran yang sama, dan contoh keluaran nyata di `docs/FIREFOX.md`
  mencatat `span.zx` justru sebagai "tidak cocok". Pada setiap probe nyata yang tercatat — dua
  halaman inbox (47 dan 12 baris), satu thread terbuka, dan satu tampilan Promotions — selector
  itu melaporkan **0 kecocokan**. Klaimnya dicabut dan diganti keterangan bahwa pembacaan "via"
  adalah *best-effort* yang belum pernah terbukti bekerja. Perilakunya tidak berubah, karena
  jalur itu memang belum pernah menyala; yang berubah adalah kejujuran dokumennya. Klaim salah
  yang tampak terverifikasi lebih berbahaya daripada tidak ada klaim, sebab ia menghentikan
  orang berikutnya dari memeriksa.
- Test yang membangun DOM tiruan berisi `span.zx` kini menyatakan bahwa yang diuji adalah
  **mekanismenya, bukan asumsi kelasnya**. Sebelumnya test itu terbaca seolah membuktikan bahwa
  Gmail memakai kelas tersebut, padahal DOM tiruannya dibangun dari asumsi itu sendiri.
- `docs/DESIGN.md` bagian 12.1, `docs/USAGE.md`, dan `docs/FIREFOX.md` tidak lagi menyatakan
  struktur penanda "via" sebagai fakta. Ketiganya menandainya sebagai hipotesis beserta
  akibatnya, dan menyebutkan apa yang dibutuhkan untuk menyelesaikannya: satu pengamatan pada
  halaman Gmail yang benar-benar menampilkan "via".
- **Angka `state` pada contoh keluaran `pnpm corpus` di `docs/USAGE.md` sudah basi**, dan basi
  sejak sebelum perubahan ini: angkanya berjumlah 400 sementara `kasus` di baris atasnya
  menyebut 404. Nilainya kini disamakan dengan keluaran sebenarnya (404 kasus, jumlah barisnya
  ikut cocok). Ketahuan saat menjalankan ulang release gate untuk perubahan ini.

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
