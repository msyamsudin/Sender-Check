# Memakai Sender-Check di Firefox

Dokumen ini menjawab satu pertanyaan: bagaimana memakai proyek ini di Firefox. Ia juga
menyatakan dengan jujur apa yang **belum** bisa dilakukan, supaya tidak ada yang menunggu
sesuatu yang tidak ada.

## Status hari ini

| Cara | Bisa dipakai sekarang? | Catatan |
|---|---|---|
| Skrip konsol — probe selector | ✅ | Sekitar 16 KB, ditempel ke konsol. Menjawab: selector mana yang bekerja |
| Skrip konsol — probe + analisis | ✅ | Sekitar 285 KB, ditempel ke konsol. Menampilkan verdikt untuk inbox nyata |
| Pustaka dari kode Node/TypeScript | ✅ | Lihat [`USAGE.md`](USAGE.md) |
| Ekstensi Firefox | ✅ | Ada dan dapat dimuat; panel muncul pada thread yang sedang dibuka dan pada halaman "Show original". Jalan baca pengirim, batas percakapan, dan blok header Tier B **sudah diverifikasi pada Gmail sungguhan** (lihat di bawah) |

Ekstensi itu ada di `apps/extension`, dibangun dengan WXT, dan dapat dimuat ke
`about:debugging`. Yang membuatnya belum dinyatakan selesai bukan lagi selector jalur
utamanya, melainkan dua hal: **satu snapshot DOM belum dapat diambil** — tiga lainnya sudah
tersimpan sebagai regression fixture, sehingga perubahan adapter yang mematahkan pembacaan markup
nyata gagal di CI (cara mengambilnya ada di
[`tools/corpus/dom-snapshots/`](../tools/corpus/dom-snapshots/README.md)) — dan **penanda
"via" masih belum pernah terbukti bekerja** — lihat catatan di `packages/adapters/src/gmail.ts`.

### Yang sudah terverifikasi pada Gmail sungguhan

Semuanya dari probe yang dijalankan pengguna pada halaman aslinya. Yang tercatat di sini
adalah **bentuk**, bukan isi pesan.

| Halaman | Yang diamati | Dipakai oleh |
|---|---|---|
| List view | `span[email][name]` cocok 103 kali pada satu inbox; `[data-hovercard-id]` 109; tidak ada `data-message-id` | Probe selector. Panel sengaja tidak memindai halaman ini |
| Thread terbuka | setiap pesan dibungkus `[data-message-id]`; baris pengirim (`span.gD`, `email` + `name`) mendahului chip penerima (`span.g2`, `name="saya"`) | lingkup percakapan, satu pengirim per pesan |
| Show original (`view=om`) | blok header mentah ada di `pre.raw_message_text` (di dalam `div.raw_message` / `div.bottom-area`), 23 header terbaca, termasuk `Reply-To`, `Return-Path`, `Authentication-Results` | Tier B: rule Reply-To |

Halaman Show original juga memuat **tabel ringkasan berlabel** yang sudah dilokalisasi
("Dari:", "Kepada:", "SPF:", "DKIM:", "DMARC:"). Adapter sengaja tidak membacanya: header
mentah di halaman yang sama selalu berbahasa Inggris, sehingga tidak ada gunanya mengikat
diri pada satu bahasa antarmuka.

Satu hal yang ditemukan dan sengaja **tidak** dipakai: header `X-Google-Original-From`.
Padanya terlihat From asli sebelum ditulis ulang Gmail, dan pada kasus phishing yang
diperiksa isinya domain yang berbeda dari `From`. Tetapi Gmail menambahkan header itu juga
pada pemakaian sah "kirim sebagai" alias domain sendiri, dan biaya false positive-nya belum
diukur terhadap corpus. Ia sudah terbaca dan tersedia di `headers`; yang belum ada adalah
rule-nya, dan rule dibuat dari pengukuran, bukan dari tebakan.

## Skrip konsol

### Kenapa ada dua berkas

| Berkas | Ukuran | Menjawab |
|---|---|---|
| `sender-check.probe.js` | sekitar 16 KB | Selector mana yang bekerja? |
| `sender-check.console.js` | sekitar 285 KB | Apa hasil analisisnya? |

Ukurannya disebut "sekitar" dengan sengaja: angka pastinya berubah setiap kali kode
berubah, dan `pnpm console:build` mencetak ukuran sebenarnya. Dokumentasi yang menyebut
angka pasti akan tertinggal — itu sudah pernah terjadi di sini, ketika probe masih ditulis
13 KB setelah ia menjadi 15 KB.

Perbedaannya besar karena tabel Public Suffix List berukuran 211 KB, dan hanya
`analyze()` yang membutuhkannya. Menempelkan 285 KB ke konsol hanya untuk menjawab
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
sempit: satu content script dan satu popup, tanpa background, tanpa halaman opsi.

### Yang dilakukannya

| Keadaan | Yang terjadi |
|---|---|
| Satu thread sedang dibuka | Panel muncul di sudut kanan bawah: state, identitas pengirim, alasan, hasil autentikasi, dan disclaimer |
| Halaman "Show original" | Panel yang sama, dengan sinyal Tier B: `Reply-To`, `Return-Path`, `Authentication-Results` |
| List view, hasil pencarian, halaman pengaturan | **Tidak ada panel.** Pada list view hanya muncul penanda kecil pada baris yang memenuhi syarat (lihat di bawah); di halaman lain tidak ada apa-apa |
| Ikon toolbar ditekan | Popup menampilkan analisis pesan yang sedang terbuka — isi yang sama dengan panel — plus tombol "Analisis header lengkap" dan langkah manualnya. Di luar thread yang terbuka, popup hanya menyatakan belum ada yang dapat dianalisis |

Popup tidak menganalisis halaman sendiri: ia meminta isi panel kepada content script yang
sudah berada di halaman Gmail, lewat kontrak pesan di `apps/extension/src/lib/messaging.ts`.
Karena itu jawabannya selalu sama dengan yang sedang dilihat di halaman, dan popup tidak
memerlukan permission apa pun di luar yang sudah diminta manifesnya.

Panel hanya muncul ketika pengguna membuka satu pesan. Di **list view** yang muncul bukan
panel melainkan penanda per baris, dan syaratnya sengaja sempit: hanya `INCONSISTENT` dengan
bukti `strong`, hanya bila nama di daftar **tidak dipotong Gmail**, dan tidak ada tanda sama
sekali untuk `UNCLEAR` maupun `UNASSESSABLE`. Pemotongan nama itu yang membuatnya perlu
sempit: nama di daftar berbeda dari nama yang dinilai panel saat thread dibuka, sehingga
menilainya akan membuat pengirim yang sama memperoleh dua state berbeda — keputusannya ada di
`docs/DESIGN.md` bagian 12.1 butir 6. Penanda berada di DOM halaman, bukan di dalam panel,
karena yang ditandai adalah baris milik Gmail.

### Yang dibaca panel: satu pengirim per pesan

Halaman Gmail memuat **lebih dari satu elemen beralamat**, dan tidak semuanya pengirim. Pada
satu percakapan yang terbuka, probe nyata menemukan: avatar pengirim (`data-hovercard-id`
saja), baris pengirim (`email` + `name`), chip penerima yang ditulis Gmail sebagai "to saya"
(`email` + `name`), dan avatar akun di luar pesan mana pun. Karena panel memilih temuan
terberat, membaca semuanya berarti panel dapat menjelaskan pengirim yang salah — termasuk
alamat pengguna sendiri — untuk setiap email yang dibuka.

Karena itu panel membaca dengan dua batas:

| Batas | Caranya | Alasannya |
|---|---|---|
| Hanya pesan di dalam percakapan yang terbuka | elemen ber-`data-message-id` | baris list view membawa `data-legacy-thread-id`, bukan `data-message-id`, sehingga daftar inbox tidak ikut terbaca |
| Hanya satu pengirim per pesan | elemen beralamat **pertama** di dalam pesan itu | pada header Gmail, baris pengirim mendahului baris penerima; urutan dokumen yang membedakannya, bukan nama kelas |

**Bila kedua batas itu tidak dapat ditegakkan, panel tidak muncul sama sekali — dan itu
disengaja.** URL Gmail dapat menunjuk sebuah thread sementara DOM-nya masih berisi daftar
inbox: satu probe nyata pada keadaan itu menemukan **103 elemen pengirim**, termasuk alamat
penerima (alias masking milik pengguna sendiri) yang Gmail render di baris daftar. Membaca
seluruh halaman di keadaan itu berarti menjelaskan pengirim yang temuannya paling berat,
bukan pengirim pesan yang sedang dibaca. Panel kosong lebih baik daripada panel yang salah.

Konsekuensinya perlu diketahui: pada halaman Gmail yang bentuk DOM-nya benar-benar berubah
sehingga `data-message-id` hilang dari percakapan, panelnya akan diam. Itu terlihat di
`notes` bila Anda menjalankan `sender-check.probe.js` di halaman tersebut, dan itulah yang
perlu dikirimkan supaya adapter dapat disesuaikan.

Skrip konsol sengaja **tidak** memakai lingkup ini: probe memang harus membaca seluruh
halaman, karena pertanyaannya "selector mana yang cocok di halaman ini". Karena itu probe
pada halaman thread akan tetap menampilkan chip penerima maupun alamat penerima pada daftar
`senders` — keduanya bukan pengirim, dan sekarang Anda tahu mengapa ia ada di sana.

### Tombol "Periksa header asli" — dicoba, lalu dicabut

`Reply-To` dan hasil autentikasi **tidak pernah dirender** Gmail di DOM thread, sehingga dari
halaman itu panel hanya dapat berhenti pada "tidak ada dasar untuk menilai pengirim ini".
Panel sempat menawarkan tombol yang mengambil halaman header pesan itu sendiri (`fetch` ke
origin Gmail yang sama, dengan kredensial sesi, hanya setelah diklik) lalu menampilkan
verdikt Tier B di panel yang sama.

Tombol itu **sudah tidak ada lagi**, dan alasannya bukan teknis: janji "tanpa permintaan
jaringan" adalah alasan utama alat ini boleh menyentuh kotak masuk orang, dan menukarnya
dengan satu tombol tidak sebanding. Yang menggantikannya memperbaiki masalah yang sama di
sisi lain — lihat bagian berikutnya. Batas itu kembali ditegakkan
`apps/extension/tests/architecture.test.ts`: tidak ada `fetch`, `XMLHttpRequest`, `WebSocket`,
maupun `sendBeacon` di **seluruh** berkas `src`, dan berkas baru ikut diperiksa otomatis
supaya tidak lolos hanya karena namanya belum terdaftar.

### Yang preventif pada state "belum dapat dinilai"

Panel yang hanya berkata "tidak ada dasar untuk menilai pengirim ini" terbaca seperti "tidak
ada yang perlu dikhawatirkan", padahal artinya kebalikan: **belum ada yang diperiksa**. Pada
state itu panel sekarang menampilkan dua kalimat:

1. **Mengapa ia tidak menilai** — nama yang ditampilkan tidak memuat klaim yang dapat diuji
   terhadap alamatnya, sehingga pengirimnya belum dapat dipastikan dari tampilan pesan.
2. **Langkah aman** — sebelum menekan tautan atau mengisi data di email itu, periksa header
   aslinya: menu ⋮ → **Tampilkan aslinya**. Di halaman itu panel menilai ulang memakai
   `balas ke` dan hasil autentikasi.

Bagian ini sengaja **tidak** diwarnai seperti peringatan. `UNASSESSABLE` berarti belum dapat
dipastikan, bukan mencurigakan, dan mewarnainya sebagai temuan akan membuat setiap email
dengan nama orang biasa tampak berbahaya — persis yang membuat alat seperti ini dimatikan
penggunanya.

### Yang belum dilakukannya

Dua hal, dan keduanya disengaja agar batas kemampuannya jelas:

1. **Satu panel per thread, bukan per pesan.** Pengirim dibaca satu per pesan (lihat
   [di atas](#yang-dibaca-panel-satu-pengirim-per-pesan)), tetapi bila sebuah thread memuat
   beberapa pengirim, yang ditampilkan tetap hanya satu: temuan yang paling perlu diperiksa.
   Menampilkan satu panel per pesan menuntut adapter mengembalikan elemen DOM, dan adapter
   sengaja hanya mengembalikan data.
2. **Tanpa cache dan tanpa `IntersectionObserver`.** `docs/DESIGN.md` merencanakan cache
   `storage.session` (LRU ~500) bersama pembatasan analisis pada baris yang terlihat. Keduanya
   belum dikerjakan: penanda list view kini menilai seluruh baris yang ada di daftar, dan
   selama daftarnya satu layar hal itu tidak terasa. Meminta permission `storage` sebelum ia
   dipakai akan membuat tinjauan izin menanyakan sesuatu yang belum dapat dijelaskan.

### Mode diagnostik

Panel biasa menjelaskan **apa** yang ditemukan. Mode diagnostik menjelaskan **atas dasar apa**,
dan ia ada karena nilai-nilainya sudah dihitung engine sejak awal tetapi tidak punya jalur ke
layar: `confidence` keseluruhan, keputusan `gate`, seluruh baris decision table, versi
algoritma dan PSL, `provenance`, catatan adapter (`notes`), dan setiap bukti apa adanya —
termasuk `args` dan `trace` mentahnya.

Ada dua cara membukanya, dan keduanya tindakan yang disengaja:

| Cara | Keterangan |
|---|---|
| `Alt+Shift+D` | Pintasan, berlaku selama halaman itu terbuka |
| Tombol **diagnostik** | Tombol kecil di kepala panel, sebelah tombol tutup |

Modenya **tidak** mengubah penilaian apa pun: kepala kartu, medan identitas, dan disclaimer
tetap sama, dan yang berganti hanya bagian tengahnya. Isinya diberi tipografi monospace dan
latar gelap supaya sekali pandang terlihat sebagai bahan mentah, bukan sebagai temuan. Modenya
juga tidak disimpan: berpindah halaman atau menutup tab berarti kembali ke panel biasa.

Satu hal yang paling sering berguna dari bagian ini adalah pertanyaan "kenapa email ini tidak
ditandai apa-apa?". Jawabannya ada di baris `gate` — mis. `no_display_name` berarti webmail
tidak merender nama sama sekali, sedangkan `personal_name_on_personal_domain` berarti namanya
ada, tetapi ia nama orang di alamat perorangan, dan itu bukan anomali. Keduanya dulu tampil
sebagai satu kalimat yang sama di panel biasa.

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

### Menerbitkan ke addons.mozilla.org

`pnpm extension:zip` menghasilkan dua berkas di `apps/extension/.output/`: satu untuk diunggah ke
AMO, dan satu berisi sumber untuk peninjau. Yang diunggah adalah yang berakhiran `-firefox`.

Empat hal menentukan apakah peninjauannya berjalan lancar, dan semuanya sudah diperiksa di sini
sebelum ada yang dikirim:

| Yang diperiksa | Keadaannya sekarang |
|---|---|
| Versi add-on | Diambil dari versi rilis repositori, jadi ia sama dengan tag dan `CHANGELOG.md`. AMO menuntut setiap unggahan **lebih tinggi** daripada seluruh versi yang pernah terbit di sana, dan membandingkannya sebagai angka per komponen — bukan sebagai teks |
| Halaman privasi | [`docs/PRIVACY.md`](PRIVACY.md), dan tautan publiknya dapat dipakai langsung di formulir |
| Pernyataan pengumpulan data | Manifes menyatakan `none`. Nilai itu harus sama dengan yang diisi di formulir AMO, dan test menjaga agar pernyataannya tidak menyimpang dari perilaku kode |
| Sumber untuk peninjau | **Bukan** zip sumber buatan WXT: berkas itu hanya memuat berkas di dalam `apps/extension`, sedangkan ekstensinya bergantung pada tiga paket workspace, sehingga peninjau tidak dapat membangunnya dari sana |

**Sumber yang dilampirkan** harus dapat dibangun ulang oleh peninjau, karena kode ekstensinya
dibundel dan diminifikasi. Arsip repositori pada tag rilis sudah cukup: GitHub menyediakan
**Code → Download ZIP** untuk setiap tag, dan di dalamnya sudah ada `pnpm-lock.yaml`, seluruh
paket workspace, serta konfigurasi buildnya. Yang perlu ditulis di catatan peninjau hanya
perintahnya — Node sesuai `engines` di `package.json`, pnpm, `pnpm install --frozen-lockfile`,
lalu `pnpm extension:build` — dan hasilnya ada di `apps/extension/.output/firefox-mv3/`.

**Dua hal tidak dapat diubah setelah terbit**, sehingga keduanya harus diputuskan sebelum
unggahan pertama: id add-on di manifes (id yang berbeda adalah add-on yang berbeda, dan pengguna
tidak dapat dimigrasikan otomatis), dan nomor versi yang sudah terpakai — versi yang pernah
diterbitkan tidak dapat ditarik dari daftar versi AMO.

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
| Penempelan 285 KB terasa berat atau terpotong | Pakai `sender-check.probe.js` (sekitar 16 KB). Itu sudah cukup untuk pertanyaan selector |
| Semua selector melaporkan "tidak cocok" | Justru inilah hasil yang berguna: kirimkan keluarannya. Berarti Gmail mengubah DOM-nya, dan adapter perlu disesuaikan dengan data nyata, bukan dengan tebakan |
| `copy()` tidak tersedia | Laporan JSON tetap dicetak ke konsol; salin manual |
| Halaman Show original: "blok header tidak ditemukan" | Kirimkan keluarannya. Berarti cara Gmail menampilkan header mentah berubah, dan pencarian wadahnya perlu diperbaiki |
| Skrip melaporkan "Halaman ini bukan Gmail" | Jalankan di `mail.google.com/mail/u/N/...`, bukan di halaman lain |
| `pnpm console:build` gagal dengan `ERR_PNPM_IGNORED_BUILDS` | Jalankan `pnpm install` lebih dulu; esbuild perlu menjalankan postinstall |
| `viaHint` tidak pernah terisi, `span.zx` selalu "tidak cocok" | Diharapkan, sampai ada bukti sebaliknya. Selector penanda "via" **belum pernah cocok** pada satu pun halaman Gmail yang diuji, jadi keluarannya memang `undefined`. Kalau kamu sendiri **melihat** `via <domain>` pada baris pengirim di Gmail, kirimkan keluaran probe halaman itu: hanya pengamatan seperti itu yang dapat menentukan selector mana yang benar |
| Panel ekstensi tidak muncul | Empat sebab yang mungkin, berurutan dari yang paling sering: halamannya bukan thread yang terbuka (list view memang tidak menampilkan panel), halaman itu belum memuat wadah percakapan (`[data-message-id]`) sehingga panel sengaja diam, tidak ada pengirim yang terbaca, atau URL-nya tidak dikenali sebagai thread. Jalankan `sender-check.probe.js` di halaman itu: `notes` menyebutkan batas mana yang gagal |
| Panel muncul di halaman yang bukan thread | Kirimkan URL-nya. Pengenalan thread memakai bentuk hash URL, dan halaman Gmail yang tidak lazim dapat salah dikenali. Aturannya ada di `apps/extension/src/lib/view.ts` beserta testnya |
| Penanda tidak muncul di list view | Periksa tiga syaratnya, berurutan: barisnya memang `INCONSISTENT` berbukti `strong`? nama di daftar tidak dipotong (tepat 20 karakter dan berakhir titik)? dan halamannya memang daftar? Ketiganya disengaja — penanda yang tidak muncul lebih baik daripada penanda yang menilai nama potong |
| Panel muncul tetapi isinya kosong | Kirimkan tangkapan layarnya. Kemungkinan besar ada elemen yang gagal dibuat, dan itu kesalahan di lapisan tampilan, bukan di analisis |
| Panel menampilkan alamat yang sama — misalnya alamat Anda sendiri — untuk setiap email yang dibuka | Sebelum lingkup percakapan ada, chip penerima ("to saya") di dalam pesan yang sama ikut dibaca sebagai pengirim, dan `pickPrimary` memilihnya karena temuan terberat. Sekarang yang dibaca hanya elemen beralamat pertama pada baris pengirim. Bila masih terjadi, jalankan `sender-check.probe.js` di halaman itu dan kirimkan keluarannya: probe sengaja membaca seluruh halaman, sehingga ia menunjukkan elemen mana yang cocok |
| Panel menampilkan pengirim yang benar, tetapi panelnya tidak berubah setelah berpindah email | Berbeda dari baris di atas: yang salah bukan yang dibaca, melainkan apakah panel digambar ulang. Buka konsol halaman, cari pesan berawalan `[Sender-Check]`, lalu kirimkan keluaran `console.warn` yang muncul beserta URL tiap email |
| Tombol "Periksa header asli" tidak ada | Benar: tombol itu dicabut. Yang tersedia adalah langkah manual di bagian "Yang preventif pada state 'belum dapat dinilai'" — menu ⋮ → "Tampilkan aslinya", dan panel menilai ulang di halaman itu |
| Popup menulis "Panel belum terpasang di halaman ini" | Content script belum berjalan di tab itu: umumnya terjadi setelah ekstensi dipasang pertama kali tanpa memuat ulang tab Gmail. Muat ulang tab-nya. Isi popup juga memang kosong di luar thread yang terbuka — itu keadaan yang benar, bukan kegagalan |
| Tombol "Analisis header lengkap" hanya membuka menu, tanpa membuka halaman | Item menunya tidak dikenali pada bahasa Gmail yang dipakai. Menunya memang sudah terbuka, jadi pilih "Tampilkan aslinya" di situ. Nama item yang dikenali kini hanya Indonesia dan Inggris; kirimkan nama aslinya kalau bahasamu berbeda, supaya daftarnya dapat ditambah |

## Yang masih menunggu

Langkah berikutnya, berurutan menurut apa yang menghambat:

1. **Adapter diuji terhadap DOM nyata.** Jalur yang dipakai panel sudah terverifikasi pada
   Gmail sungguhan — lihat [tabel di atas](#yang-sudah-terverifikasi-pada-gmail-sungguhan).
   Pertanyaan yang masih terbuka: **apakah Gmail merender penanda "via" sama sekali**, dan
   dengan markup apa. Keluaran probe pada halaman yang menampilkannya adalah satu-satunya
   cara menjawabnya.
2. **Snapshot DOM disimpan** di [`tools/corpus/dom-snapshots/`](../tools/corpus/dom-snapshots/README.md)
   sebagai regression fixture. Test-nya sudah ada di `packages/adapters/tests/gmail-snapshots.test.ts`
   dan assertion-nya masih di-skip sampai keempat berkasnya diambil. Yang memberi tahu bahwa Gmail
   berubah tetap probe di halaman sungguhan; snapshot menjaga agar perubahan adapter tidak
   diam-diam mematahkan pembacaan markup yang sudah terbukti.
3. **Panel diverifikasi di thread sungguhan.** Bentuk panelnya sudah ada dan logikanya
   teruji tanpa browser, tetapi tiga hal hanya dapat diperiksa pada halaman asli: apakah
   panelnya terbaca, apakah ia muncul pada saat yang tepat, dan apakah deteksi thread-nya
   tepat.
4. **List view, cache, dan mode diagnostik** — lihat "Yang belum dilakukannya" di atas.

Cara mengambil snapshot untuk langkah 2, termasuk cara menyamarkan isi pesannya, ada di
[`tools/corpus/dom-snapshots/README.md`](../tools/corpus/dom-snapshots/README.md).
