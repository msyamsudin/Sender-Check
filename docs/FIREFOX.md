# Memakai Sender-Check di Firefox

Dokumen ini menjawab satu pertanyaan: bagaimana memakai proyek ini di Firefox. Ia juga
menyatakan dengan jujur apa yang **belum** bisa dilakukan, supaya tidak ada yang menunggu
sesuatu yang tidak ada.

## Status hari ini

| Cara | Bisa dipakai sekarang? | Catatan |
|---|---|---|
| Skrip konsol — probe selector | ✅ | Sekitar 15 KB, ditempel ke konsol. Menjawab: selector mana yang bekerja |
| Skrip konsol — probe + analisis | ✅ | Sekitar 283 KB, ditempel ke konsol. Menampilkan verdikt untuk inbox nyata |
| Pustaka dari kode Node/TypeScript | ✅ | Lihat [`USAGE.md`](USAGE.md) |
| Ekstensi Firefox | ⚠️ | Ada dan dapat dimuat, tetapi **hanya di thread yang sedang dibuka**, dan selectornya belum diverifikasi. Lihat [bagian ekstensi](#ekstensi-firefox) |

Ekstensi itu kini ada di `apps/extension`, dibangun dengan WXT, dan dapat dimuat ke
`about:debugging` hari ini. Yang membuatnya belum dinyatakan selesai bukan kelengkapan
kodenya, melainkan satu hal yang tidak dapat dikerjakan dari sini: **selectornya belum
pernah diverifikasi terhadap Gmail sungguhan** — sama seperti adapter yang mendasarinya.
Selector yang bekerja pada hari ini dapat berubah kapan saja, dan sampai ada snapshot DOM
nyata di [`tools/corpus/dom-snapshots/`](../tools/corpus/dom-snapshots/README.md), tidak ada
yang memberi tahu kita kalau itu terjadi.

## Skrip konsol

### Kenapa ada dua berkas

| Berkas | Ukuran | Menjawab |
|---|---|---|
| `sender-check.probe.js` | sekitar 15 KB | Selector mana yang bekerja? |
| `sender-check.console.js` | sekitar 283 KB | Apa hasil analisisnya? |

Ukurannya disebut "sekitar" dengan sengaja: angka pastinya berubah setiap kali kode
berubah, dan `pnpm console:build` mencetak ukuran sebenarnya. Dokumentasi yang menyebut
angka pasti akan tertinggal — itu sudah pernah terjadi di sini, ketika probe masih ditulis
13 KB setelah ia menjadi 15 KB.

Perbedaannya besar karena tabel Public Suffix List berukuran 211 KB, dan hanya
`analyze()` yang membutuhkannya. Menempelkan 283 KB ke konsol hanya untuk menjawab
pertanyaan tentang selector adalah pemborosan sekaligus menambah risiko penempelan gagal.
**Mulai dari yang kecil.**

### Membangunnya

```bash
pnpm install
pnpm console:build
```

Hasilnya di `tools/console/dist/`, bersama berkas `CARA-PAKAI.txt` berisi ringkasan
langkah di bawah.

### Menjalankannya

1. Buka Gmail di Firefox.
2. Buka konsol: **Ctrl+Shift+K**, atau menu aplikasi → **More tools** → **Web Developer
   Tools** → **Console**.
3. Firefox memblokir penempelan kode secara default. Di konsol, ketik persis ini lalu
   tekan Enter:

   ```
   allow pasting
   ```

   Kata kuncinya literal `allow pasting`, tidak diterjemahkan, dan hanya perlu sekali
   per sesi.

4. Buka `tools/console/dist/sender-check.probe.js` dengan editor teks, salin **seluruh**
   isinya, tempel ke konsol, lalu Enter.
5. Untuk **Tier B**: buka sebuah pesan → menu lainnya (⋮) → **Show original**
   (**Tampilkan aslinya**), lalu jalankan skrip yang sama di halaman itu.
6. Di akhir keluaran, laporan JSON disalin otomatis ke clipboard lewat `copy()`.

Skrip ini tidak mengirim apa pun ke mana pun. Ia hanya membaca halaman dan mencetak ke
konsol serta clipboard lokal.

### Seperti apa keluarannya

Halaman inbox, bila selector bekerja:

```
==========================================================================
SENDER-CHECK · PROBE SELECTOR
halaman : inbox
url     : https://mail.google.com/mail/u/0/#inbox
==========================================================================

selector digunakan: span[email][name]

probe selector (inilah yang tidak dapat saya verifikasi tanpa Gmail-mu):
  span[email][name]          cocok 47        <- berkontribusi
  [email][name]              cocok 47        <- berkontribusi
  span[email]                cocok 47        <- berkontribusi
  [email]                    cocok 94        <- berkontribusi
  [data-hovercard-id]        cocok 47
  span.zx                    tidak cocok
      (penanda "via" pada baris pengirim)
  [role="alert"]             tidak cocok
      (banner peringatan berperan alert)

--- pengirim terbaca (47) ---
  Rise <no-reply@mngl.in>
  Budi Santoso <budi.santoso@gmail.com>
  ...
```

Halaman Show original, bila blok header berhasil diurai:

```
blok header ditemukan: ya

  return-path                <no-reply@mngl.in>
  from                       Rise <no-reply@mngl.in>
  reply-to                   support@riseworks.digital
  authentication-results     mx.google.com; dkim=pass header.i=@mngl.in; …
```

### Yang perlu dikirim kembali

Yang paling berharga adalah bagian **`probes`** pada JSON — itulah yang memberi tahu saya
selector mana yang masih bekerja pada Gmail hari ini. Bagian itu tidak memuat isi
pesanmu.

Bagian `senders` memuat alamat pengirim yang nyata. Ia berguna karena menunjukkan apakah
penguraian nama dan alamatnya benar, tetapi **kalau kamu tidak ingin membagikannya, hapus
saja isi array `senders`**. Selector tetap dapat diverifikasi sepenuhnya dari `probes`.

Kirimkan salah satu dari:

- JSON yang sudah tersalin ke clipboard, atau
- seluruh keluaran konsol sebagai teks.

Tanpa mengubah struktur atau nama atributnya. Struktur itulah yang sedang diperiksa.

## Ekstensi Firefox

Ekstensi ada di `apps/extension`, dibangun dengan [WXT](https://wxt.dev). Bentuknya sengaja
sempit: satu content script, tanpa background, tanpa popup, tanpa halaman opsi.

### Yang dilakukannya

| Keadaan | Yang terjadi |
|---|---|
| Satu thread sedang dibuka | Panel muncul di sudut kanan bawah: state, identitas pengirim, alasan, hasil autentikasi, dan disclaimer |
| Halaman "Show original" | Panel yang sama, dengan sinyal Tier B: `Reply-To`, `Return-Path`, `Authentication-Results` |
| List view, hasil pencarian, halaman pengaturan | **Tidak ada panel.** Disengaja — lihat di bawah |

Panel hanya muncul ketika pengguna membuka satu pesan. Indikator di list view berarti sinyal
muncul tanpa diminta pada puluhan baris sekaligus, dan itu menuntut presisi yang belum
dimiliki alat ini. Panel yang muncul saat pengguna memang sedang memeriksa satu pesan jauh
lebih mudah dipertanggungjawabkan.

### Yang belum dilakukannya

Tiga hal, dan ketiganya disengaja agar batas kemampuannya jelas:

1. **Satu panel per thread, bukan per pesan.** Bila sebuah thread memuat beberapa pengirim,
   yang ditampilkan adalah temuan yang paling perlu diperiksa. Memetakan tiap temuan ke
   elemen pesannya sendiri menuntut adapter mengembalikan elemen DOM, dan adapter sengaja
   hanya mengembalikan data.
2. **Tanpa cache.** `docs/DESIGN.md` merencanakan cache `storage.session` bersama list view.
   Selama panel hanya bekerja pada satu thread, cache belum dibutuhkan, dan permission
   `storage` belum diminta.
3. **Tanpa mode diagnostik.** Selector yang bekerja, jumlah elemen yang cocok, dan versi
   algoritma masih hanya ada di keluaran skrip konsol.

### Membangun dan memuatnya

```bash
pnpm install
pnpm extension:build
```

Hasilnya ada di `apps/extension/.output/firefox-mv3/`. Lalu:

1. Buka `about:debugging#/runtime/this-firefox`
2. Klik **Load Temporary Add-on…** (**Muat Add-on Sementara…**)
3. Pilih berkas `manifest.json` di dalam folder hasil build

Add-on sementara **hilang saat Firefox ditutup**, dan harus dimuat ulang setiap kali.
Untuk pengembangan, `pnpm --filter @sender-check/extension run dev` menjalankan `wxt dev`
yang meluncurkan Firefox dengan muat ulang otomatis, sehingga langkah manual di atas hanya
dipakai untuk mencoba hasil build.

### Kalau ingin permanen

Firefox versi rilis menolak add-on yang tidak ditandatangani. Ada dua jalan:

| Jalan | Caranya |
|---|---|
| Ditandatangani Mozilla | Unggah ke [addons.mozilla.org](https://addons.mozilla.org) dan pilih pendistribusian sendiri (*unlisted*), lalu pasang berkas `.xpi` hasilnya. `pnpm extension:zip` menghasilkan berkas itu |
| Firefox tanpa pemeriksaan tanda tangan | Pakai Firefox **Developer Edition**, **Nightly**, atau **ESR**, lalu set `xpinstall.signatures.required` ke `false` di `about:config` |

Firefox biasa (release) dan Beta tidak menyediakan jalan kedua, karena Mozilla menghapus
kemampuan itu dari saluran rilis.

### Dua hal khas Firefox yang sudah diketahui

Keduanya ditemukan saat menyiapkan adapter, dan keduanya mudah menjebak:

**1. Firefox tidak mendukung `background.service_worker`.**

Manifest V3 di Firefox memakai `background.scripts` (event page), bukan service worker
([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)).
Manifest gaya Chrome yang hanya menulis `service_worker` tidak akan berjalan sama sekali.
Kabar baiknya, untuk kasus ini background **bisa dihindari sepenuhnya**: cukup
`content_scripts`, sehingga perbedaan MV2/MV3 tidak relevan.

Bila tetap dibutuhkan agar jalan di Chrome dan Firefox sekaligus, tulis keduanya dalam
satu manifest — Firefox memakai `scripts`, Chrome memakai `service_worker`.

**2. Host permission di Firefox dapat dicabut per situs.**

Sejak Firefox 127 izin yang diminta lewat `host_permissions` dan `content_scripts`
ditampilkan di prompt instalasi, tetapi pengguna dapat mencabutnya kapan saja
([MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)).
Ekstensi ini meminta satu host saja, `https://mail.google.com/*`, dan tidak meminta
permission lain sama sekali.

Ada satu konsekuensi yang perlu diketahui, dan nasihat lama "periksa dengan
`permissions.contains`" **tidak berlaku** untuk desain ini. Ekstensi ini sengaja tidak punya
background script, dan content script hanya disuntikkan pada host yang izinnya masih ada.
Artinya bila pengguna mencabut izinnya, content script-nya **tidak pernah berjalan**, dan
tidak ada kode kita yang tersisa di halaman itu untuk melaporkan alasannya. Tempat
memeriksanya adalah `about:addons` → ekstensi ini → **Permissions**, bukan konsol halaman.

Ini juga penyebab paling umum ekstensi "tidak muncul apa-apa": bukan bug, melainkan izin
yang hilang.

## Tier A dan Tier B: kenapa keduanya perlu

| | Sumber | Yang didapat |
|---|---|---|
| **Tier A** | DOM inbox | display name, alamat From, indikator "via", banner peringatan Gmail |
| **Tier B** | Halaman "Show original" | `Reply-To`, `Return-Path`, `Authentication-Results` |

`Reply-To` dan `Return-Path` **tidak dirender** di DOM inbox. Ketiganya hanya ada di
halaman Show original.

Ini bukan detail teknis kecil. Ada kelas penipuan yang hanya dapat ditangkap lewat Tier B:
email dengan display name "Rise" dikirim dari `no-reply@mngl.in`, dengan
`Reply-To: support@riseworks.digital`. Domain pengirim tidak memuat "rise" sama sekali,
sedangkan domain tujuan balasan memuatnya — dan seluruh rantai autentikasi lulus untuk
`mngl.in`, sehingga webmail tidak menampilkan peringatan.

Tanpa header Show original, engine mengembalikan `UNASSESSABLE` untuk email itu, dan itu
hasil yang benar: tidak ada dasar untuk menilai. Karena itu **jalankan skrip konsol di
kedua halaman**, bukan hanya di inbox.

## Pemecahan masalah

| Gejala | Sebab dan penanganan |
|---|---|
| Konsol menolak penempelan, muncul peringatan | Ketik `allow pasting` lalu Enter lebih dulu. Kata kuncinya literal, tidak diterjemahkan |
| Penempelan 283 KB terasa berat atau terpotong | Pakai `sender-check.probe.js` (sekitar 15 KB). Itu sudah cukup untuk pertanyaan selector |
| Semua selector melaporkan "tidak cocok" | Justru inilah hasil yang berguna: kirimkan keluarannya. Berarti Gmail mengubah DOM-nya, dan adapter perlu disesuaikan dengan data nyata, bukan dengan tebakan |
| `copy()` tidak tersedia | Laporan JSON tetap dicetak ke konsol; salin manual |
| Halaman Show original: "blok header tidak ditemukan" | Kirimkan keluarannya. Berarti cara Gmail menampilkan header mentah berubah, dan pencarian wadahnya perlu diperbaiki |
| Skrip melaporkan "Halaman ini bukan Gmail" | Jalankan di `mail.google.com/mail/u/N/...`, bukan di halaman lain |
| `pnpm console:build` gagal dengan `ERR_PNPM_IGNORED_BUILDS` | Jalankan `pnpm install` lebih dulu; esbuild perlu menjalankan postinstall |
| `viaHint` tidak pernah terisi, `span.zx` selalu "tidak cocok" | Diharapkan, sampai ada bukti sebaliknya. Selector penanda "via" **belum pernah cocok** pada satu pun halaman Gmail yang diuji, jadi keluarannya memang `undefined`. Kalau kamu sendiri **melihat** `via <domain>` pada baris pengirim di Gmail, kirimkan keluaran probe halaman itu: hanya pengamatan seperti itu yang dapat menentukan selector mana yang benar |
| Panel ekstensi tidak muncul | Tiga sebab yang mungkin, berurutan dari yang paling sering: halamannya bukan thread yang terbuka (list view memang tidak menampilkan panel), tidak ada pengirim yang terbaca sehingga tidak ada yang ditampilkan, atau URL-nya tidak dikenali sebagai thread. Buka konsol halaman dan cari pesan berawalan `[Sender-Check]` |
| Panel muncul di halaman yang bukan thread | Kirimkan URL-nya. Pengenalan thread memakai bentuk hash URL, dan halaman Gmail yang tidak lazim dapat salah dikenali. Aturannya ada di `apps/extension/src/lib/view.ts` beserta testnya |
| Panel muncul tetapi isinya kosong | Kirimkan tangkapan layarnya. Kemungkinan besar ada elemen yang gagal dibuat, dan itu kesalahan di lapisan tampilan, bukan di analisis |

## Yang masih menunggu

Langkah berikutnya, berurutan menurut apa yang menghambat:

1. **Adapter diuji terhadap DOM nyata.** Hasil probe dipakai untuk memperbaiki daftar
   selector di `packages/adapters/src/gmail.ts` dan `gmail-headers.ts`. Pertanyaan yang
   masih terbuka: **apakah Gmail merender penanda "via" sama sekali**, dan dengan markup
   apa. Keluaran probe pada halaman yang menampilkannya adalah satu-satunya cara
   menjawabnya.
2. **Snapshot DOM disimpan** di [`tools/corpus/dom-snapshots/`](../tools/corpus/dom-snapshots/README.md)
   sebagai canary test, yang gagal di CI ketika Gmail mengubah strukturnya.
3. **Panel diverifikasi di thread sungguhan.** Bentuk panelnya sudah ada dan logikanya
   teruji tanpa browser, tetapi tiga hal hanya dapat diperiksa pada halaman asli: apakah
   panelnya terbaca, apakah ia muncul pada saat yang tepat, dan apakah deteksi thread-nya
   tepat.
4. **List view, cache, dan mode diagnostik** — lihat "Yang belum dilakukannya" di atas.

Cara mengambil snapshot untuk langkah 2, termasuk cara menyamarkan isi pesannya, ada di
[`tools/corpus/dom-snapshots/README.md`](../tools/corpus/dom-snapshots/README.md).
