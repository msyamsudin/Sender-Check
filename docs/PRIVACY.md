# Kebijakan privasi Sender-Check

Berlaku sejak 12 Oktober 2026, untuk ekstensi Firefox Sender-Check.

Perubahan 12 Oktober 2026 **menyempitkan** apa yang dibaca: penanda daftar inbox dicabut, sehingga
baris daftar tidak lagi dibaca sama sekali. Alasannya ada di bagian "Perubahan kebijakan" di bawah.

Halaman ini menyatakan apa yang dibaca ekstensi, apa yang tidak pernah dibaca, dan apa yang
terjadi pada yang dibacanya. Ia ditulis untuk dapat diperiksa: setiap pernyataan di sini
menunjuk kode atau test yang menegakkannya, dan test itu ada di repositori yang sama.

Kalau satu pernyataan di halaman ini berbeda dari perilaku kodenya, itu bug — dan
[`apps/extension/tests/architecture.test.ts`](../apps/extension/tests/architecture.test.ts)
ada supaya perbedaan itu ketahuan sebelum ia sampai ke pengguna.

## Ringkasan

- **Tidak ada data yang dikumpulkan, dikirim, atau dijual.** Ekstensi ini tidak punya server.
- **Tidak ada permintaan jaringan sama sekali**, bukan sekadar tidak ada pada jalur normal.
- **Tidak ada akun, telemetri, analitik, iklan, maupun pelacakan.**
- **Tidak ada yang disimpan** — ekstensi tidak meminta permission `storage` untuk sekarang.
- **Satu izin saja**: akses ke `https://mail.google.com/*`.

Semuanya berlaku pada halaman Gmail yang sedang kamu buka, di dalam perambanmu, dan berhenti
saat halaman itu ditutup.

## Yang dibaca, dan di mana

Ekstensi hanya berjalan di `mail.google.com`. Ia membaca **metadata pengirim** dari DOM halaman
yang sudah kamu buka:

| Halaman Gmail | Yang dibaca | Untuk apa |
|---|---|---|
| Daftar inbox (list view) | — | **Tidak dibaca, dan tidak disentuh.** Tidak ada panel maupun penanda di sana — §9 di [`DESIGN.md`](DESIGN.md) memuat keputusannya |
| Satu thread yang dibuka | Satu pengirim per pesan — nama dan alamatnya, ditambah indikator `via` bila Gmail menampilkannya, dan ada-tidaknya banner peringatan keamanan milik Gmail (teksnya diperiksa lebih dulu) | Isi panel penjelasan |
| Halaman "Tampilkan aslinya" (`view=om`) | Blok header mentah yang Gmail render di halaman itu, berhenti pada baris kosong pertama | `Reply-To`, `Return-Path`, dan `Authentication-Results`, yang tidak pernah Gmail tampilkan di thread |

Yang **tidak** dibaca, walaupun ada di halaman itu: isi pesan, lampiran, daftar kontak, riwayat
lain di kotak masukmu, dan apa pun di luar `mail.google.com`. Panel juga tidak pernah
menampilkan subjek maupun isi pesan.

Satu batas yang disebut apa adanya: pada halaman "Tampilkan aslinya", blok header yang diurai
memang memuat baris `Subject` di dalamnya, dan baris itu ikut terbaca sebagai teks pada saat
header diurai. Ia tidak ditampilkan, tidak dipakai dalam penilaian, dan tidak disimpan.

## Yang tidak pernah dikirim

Tidak ada satu pun jalur yang mengirim data ke mana pun. Tidak ada `fetch`, `XMLHttpRequest`,
`WebSocket`, maupun `sendBeacon` di **seluruh** berkas kode ekstensi, dan itu diperiksa test
otomatis terhadap source-nya — termasuk berkas baru, supaya tidak lolos hanya karena namanya
belum terdaftar.

Ekstensi ini juga tidak punya background script, tidak punya server, dan tidak punya API key.
Firefox mewajibkan setiap ekstensi baru menyatakan pengumpulan datanya, dan manifes ekstensi ini
menyatakan `none`. Pernyataan itu dijaga test supaya tidak dapat berubah tanpa disadari, karena
pernyataan yang salah kepada pengguna adalah masalah yang lebih serius daripada build yang gagal.

## Yang disimpan

**Untuk sekarang: tidak ada.** Ekstensi tidak meminta permission `storage`, tidak menulis cookie,
dan tidak menyentuh penyimpanan peramban. Panel hidup di dalam halaman yang sedang terbuka;
berpindah halaman atau menutup tab menghapusnya, dan mode diagnostik pun tidak disimpan.

Yang direncanakan, dan akan diumumkan **sebelum** ia dikirim: cache verdikt di
`chrome.storage.session` dengan batas ukuran, supaya pengirim yang sama tidak dinilai ulang
berkali-kali dalam satu sesi. Bentuknya sesi, artinya isinya dibuang saat peramban ditutup, tidak
pernah meninggalkan peramban, dan permission `storage` akan diminta bersama kodenya — bukan
sebelumnya. Halaman ini diperbarui lebih dulu bila itu terjadi. Rencananya tercatat di §13.1
[`DESIGN.md`](DESIGN.md), dan sampai sekarang ia belum dikerjakan.

## Izin yang diminta

| Izin | Untuk apa |
|---|---|
| `https://mail.google.com/*` | Membaca metadata pengirim pada halaman Gmail yang kamu buka. Hanya host ini; tidak ada `<all_urls>` |

Ekstensi ini tidak meminta `tabs`, `webRequest`, `cookies`, `history`, maupun permission lain.
Daftar itu diperiksa test, sehingga izin baru tidak dapat ditambahkan tanpa disadari.

Di Firefox, izin host dapat kamu cabut kapan saja lewat `about:addons` → ekstensi ini →
**Permissions**. Konsekuensinya jujur: tanpa izin itu, content script tidak pernah berjalan, dan
ekstensi tidak melakukan apa pun. Tempat memeriksanya `about:addons`, bukan konsol halaman — sebab
tidak ada kode yang tersisa di halaman untuk melaporkan alasannya.

## Pihak ketiga

Tidak ada. Tidak ada analitik, tidak ada layanan pihak ketiga, tidak ada CDN, dan tidak ada
permintaan jaringan saat ekstensi berjalan.

Dua berkas data pihak ketiga dibundel ke dalam build — Public Suffix List dan tabel confusable
Unicode — sehingga keduanya ikut terpasang dan **tidak diunduh** saat berjalan. Lisensinya
dicatat di [`THIRD_PARTY.md`](../THIRD_PARTY.md).

## Batas yang tidak disembunyikan

1. **Yang dijaga test adalah kode ekstensi ini, bukan perambanmu.** Ekstensi tidak dapat
   memverifikasi apa yang dilakukan add-on lain di halaman yang sama, dan tidak dapat menjamin
   apa pun tentang mereka.
2. **Ekstensi menambahkan elemen ke halaman** — panelnya sendiri, di dalam shadow root — tetapi
   tidak mengubah data Gmail, tidak mengubah pesanmu, dan tidak mengubah apa yang dikirim Gmail.
   Tidak ada apa pun yang disisipkan ke dalam baris pesan.
3. **Ia membaca DOM halaman dengan sesi webmail yang sedang aktif.** Itu memang cara kerja setiap
   content script, dan itulah sebabnya izin yang diminta sengaja sesempit mungkin.
4. **Ini bukan alat keamanan.** Sender-Check menjelaskan hubungan antara nama yang ditampilkan dan
   alamat pengirim, dan tidak menyatakan sebuah email aman. Batas itu dijelaskan di
   [`DESIGN.md`](DESIGN.md) bagian 15.4.
5. **Pembacaan yang pernah lebih lebar sudah dicabut.** Pada 11 Oktober 2026 ekstensi pernah
   membaca seluruh teks satu baris daftar (di dalam mode diagnostik, lewat tombol salin markup)
   dan menyuntikkan dua baris uji ke tabel inbox untuk membuktikan penandanya jatuh di baris yang
   benar. Keduanya **tidak pernah dirilis**, dan keduanya dihapus pada 12 Oktober 2026 bersama
   penanda daftar. Yang berlaku sekarang adalah pembacaan yang sama seperti sebelum penanda ada —
   tabel di atas menyebutkannya satu per satu.

## Perubahan kebijakan

Setiap perubahan wajib memperbarui tanggal di halaman ini, dan perubahan yang melebarkan apa yang
dibaca atau disimpan akan disebutkan pada catatan rilis versi yang membawanya. Riwayat lengkap
perubahan berkas ini ada di riwayat git repositori ini.

**12 Oktober 2026.** Penanda daftar inbox dicabut, dan cakupan pembacaannya ikut menyempit: nama
dan alamat pada baris daftar tidak lagi dibaca, karena tidak ada lagi yang ditampilkan di sana.
Penanda itu sendiri belum pernah terlihat bekerja pada halaman sungguhan, dan ia satu-satunya
bagian ekstensi yang menulis ke dalam DOM Gmail — dua alasan yang dicatat di §9
[`DESIGN.md`](DESIGN.md). Yang pernah disiapkan untuk membuktikannya — mode diagnostik khusus
daflar, tombol salin markup satu baris, dan uji baris sintetis — tidak pernah dirilis, dan kodenya
dihapus bersama penandanya. Yang tersisa adalah pembacaan yang sama seperti sebelum penanda ada:
satu pengirim per pesan pada thread yang dibuka, dan blok header pada halaman "Tampilkan aslinya".

## Pertanyaan atau laporan

Ada yang tidak cocok dengan apa yang kamu amati di perambanmu? Laporkan lewat
[GitHub Issues](https://github.com/msyamsudin/Sender-Check/issues), dengan menyertakan versi
ekstensi dan apa yang kamu lihat. Ketidakcocokan seperti itu dianggap bug, bukan penjelasan yang
perlu dilunakkan.

---

## English summary

Sender-Check is a Firefox extension that explains whether an email sender's display name is
consistent with the address it was sent from. This page is authoritative in Indonesian; the
summary below states the same commitments for reviewers and users who read English.

- **No data is collected, transmitted, or sold.** The extension has no server.
- **No network requests of any kind.** There is no `fetch`, `XMLHttpRequest`, `WebSocket`, or
  `sendBeacon` anywhere in the extension's source, and an automated test enforces that for every
  file, including new ones.
- **No accounts, telemetry, analytics, ads, or tracking.** The manifest declares
  `data_collection_permissions: none`, and a test keeps that declaration in step with the code.
- **Nothing is stored.** No `storage` permission is requested. Panel state lives in the open page
  and disappears when the tab is closed.
- **One permission only:** host access to `https://mail.google.com/*`. No `<all_urls>`, `tabs`,
  `webRequest`, `cookies`, or `history`.

What it reads is sender metadata from the Gmail page you already have open: the sender name and
address on message headers, a `via` indicator when Gmail renders one, whether Gmail's own warning
banner is present, and — on the "Show original" page — the raw header block, from which it takes
`Reply-To`, `Return-Path`, and `Authentication-Results`. It never reads message bodies,
attachments, contacts, or anything outside `mail.google.com`, and it never displays the subject or
the body. Inbox rows are not read at all: there is no panel and no marker in the list view. It does
not modify your mail or Gmail's data; it only adds its own panel.

A wider experiment, added on 11 October 2026 and withdrawn on 12 October 2026 before it ever
shipped, would have read the full visible text of a single inbox row (diagnostic mode only) and
would have injected two synthetic rows into the inbox table for about two seconds. Both were
deleted together with the list marker they existed to verify.

Planned and not yet shipped: a session-scoped verdict cache in `chrome.storage.session`, which
will be announced here and will request the `storage` permission together with the code that uses
it.

Contact: [GitHub Issues](https://github.com/msyamsudin/Sender-Check/issues).
