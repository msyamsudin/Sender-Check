# Menguji Sender-Check pada sesi Gmail sungguhan

Dokumen ini adalah daftar periksa untuk satu sesi pengujian di Gmail yang sudah login. Ia
ditulis karena satu hal yang tidak dapat dikerjakan dari dalam repositori: **tidak ada test
yang membuktikan ekstensi ini bekerja pada halaman Gmail hari ini.** Test menjaga engine,
adapter, dan lapisan tampilan; yang tidak dapat dijaga keduanya adalah apakah selectornya
masih cocok dengan markup yang Gmail render sekarang.

Sesi ini juga satu-satunya cara menutup butir-butir yang masih terbuka di
[`DESIGN.md`](DESIGN.md) §13.1, dan **tidak memakan nomor versi AMO**: add-on sementara
dimuat dari folder hasil build, bukan dari paket yang diunggah.

Dokumen ini sengaja memakai dua penomoran yang **tidak** bertabrakan: bagian dokumen memakai
huruf (A–I), dan langkah yang dijalankan memakai angka (Langkah 1–8, tabel di Bagian C).
Sebutan seperti "Langkah 4" karena itu selalu berarti satu baris di tabel itu, bukan judul
bagian.

| Butir yang menunggu | Yang menutupnya |
|---|---|
| Penanda "via" belum pernah terbukti bekerja | Bagian G butir a |
| `thread-no-name.html` belum dapat diambil | Bagian G butir b |
| Wadah `show-original.html` yang spesifik belum terekam | Bagian H |

Daftar inbox sengaja tidak punya langkah pengamatan sendiri: penanda baris yang pernah dipasang
di sana **dicabut pada 12 Oktober 2026** (§9 di [`DESIGN.md`](DESIGN.md)) — ia belum pernah
terlihat bekerja pada halaman sungguhan, dan ia satu-satunya bagian ekstensi yang menulis ke DOM
Gmail. Langkah 4 di bawah karena itu memeriksa justru ketiadaannya.

## Bagian A. Menyiapkan paket

```bash
pnpm install
pnpm extension:build
pnpm console:build
```

Hasilnya di `apps/extension/.output/firefox-mv3/` dan `tools/console/dist/`. Yang dimuat
adalah **folder**, bukan zip: zip hanya untuk diunggah ke AMO.

Satu hal yang mudah menjebak: berkas hasil build memakai versi rilis, dan versi itu berbeda
dari `apps/extension/package.json`. Yang benar adalah versi di `manifest.json` — pada saat
dokumen ini ditulis `0.7.2`.

## Bagian B. Memuatnya ke Firefox

1. Buka `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → pilih `manifest.json` di dalam
   `apps/extension/.output/firefox-mv3/`.
3. Periksa add-on itu muncul dengan versi yang benar dan izin hanya `mail.google.com`.
4. **Muat ulang tab Gmail.** Content script disuntikkan saat dokumen dimuat; tab yang sudah
   terbuka sebelum add-on dipasang tidak mendapatkannya. Ini penyebab paling umum
   "tidak muncul apa-apa", dan bukan bug.

Add-on sementara hilang saat Firefox ditutup. Untuk pengembangan, `wxt dev` memuat ulang
otomatis; untuk sesi uji ini cara di atas sudah cukup.

## Bagian C. Urutan pengujian

Kerjakan berurutan: tiap langkah mengandaikan langkah sebelumnya berhasil. Bagian A dan B
adalah syaratnya, bukan langkah di tabel ini: tanpa add-on dimuat **dan tab Gmail dimuat
ulang**, Langkah 1 hanya akan tampak seperti tidak ada apa-apa.

Nomor di kolom pertama itulah yang disebut "Langkah" di seluruh dokumen ini.

| # | Langkah uji | Yang harus terlihat |
|---|---|---|
| 1 | Buka satu thread dari inbox | Panel di sudut kanan bawah: state, identitas pengirim, alasan, hasil autentikasi, disclaimer |
| 2 | Tekan `Alt+Shift+D` | Bagian tengah panel berganti menjadi bahan mentah; baris `gate` menyebut alasan keputusan |
| 3 | Tekan `Alt+Shift+D` lagi | Kembali ke panel biasa |
| 4 | Buka list view inbox | **Tidak ada apa pun dari ekstensi** — tanpa panel, tanpa elemen yang ditambahkan ke baris. Rinciannya di Bagian D |
| 5 | Pindah ke pesan lain | Panel menilai ulang pengirim pesan itu, bukan yang sebelumnya |
| 6 | Tutup panel, lalu pindah pesan | Panel muncul lagi untuk pesan yang baru |
| 7 | Menu ⋮ → **Tampilkan aslinya** | Panel yang sama, kini dengan sinyal Tier B: `balas ke`, `return-path`, hasil autentikasi |
| 8 | Tekan ikon toolbar | Popup berisi isi panel yang sedang tampil, plus langkah manual header |

## Bagian D. Daftar inbox: yang seharusnya tidak terjadi

Tidak ada panel dan tidak ada penanda di daftar inbox. Yang diperiksa di Langkah 4 karena itu
adalah kebalikannya — bahwa ekstensi tidak menambahkan apa pun ke halaman itu:

- tidak ada titik, ikon, atau elemen baru di dalam baris pesan;
- daftar tidak berkedip atau bergeser setelah tab dibiarkan beberapa detik — tidak ada elemen
  yang dipasang lalu dicabut ulang;
- panel tetap tidak muncul, walaupun ada baris yang jelas mencurigakan (mis.
  `Bank BCA <bca.customer.service@gmail.com>`).

Alasannya dicatat di §9: penilaian yang muncul tanpa diminta tetap hanya satu panel per thread,
dan satu-satunya elemen yang ekstensi tambahkan ke halaman adalah panelnya sendiri, di dalam
shadow root. Penanda titik 7 px yang pernah dipasang ke baris daftar — beserta alat diagnostik
dan uji baris yang dibangun untuk membuktikannya — dihapus seluruhnya pada 12 Oktober 2026.

Kalau kamu justru menemukan ekstensi mengubah sesuatu di baris daftar, itu bug, dan yang perlu
dikirim kembali ada di Bagian F.

## Bagian E. Kalau panel tidak muncul

Panel sengaja diam pada empat keadaan, dan membedakannya perlu satu perintah. Tempel isi
`tools/console/dist/sender-check.probe.js` ke konsol halaman (ketik `allow pasting` lebih
dulu), lalu baca bagian `notes`:

| Kalau panel diam karena… | Jalankan probe di | Yang menunjukkannya |
|---|---|---|
| tidak ada wadah pesan (`[data-message-id]`), sehingga batas percakapan tidak dapat ditegakkan | halaman thread | probe memakai lingkup halaman penuh, jadi ia tetap melaporkan pengirim yang terbaca; yang membuktikan sebabnya adalah `document.querySelectorAll('[data-message-id]').length` — nol berarti memang tidak ada wadah percakapan |
| tidak ada pengirim yang terbaca | halaman thread | `selector digunakan: TIDAK ADA`, dan setiap kandidat selector melaporkan nol kecocokan |
| nama dibaca dari teks, bukan atribut `name` | halaman mana pun | `notes` memuat *"display name … dibaca dari teks"* |
| halamannya bukan thread | halaman itu | judul keluaran menyebut halaman lain, mis. `halaman : inbox` |

Bedanya penting dan mudah salah dibaca: `notes` yang berbunyi *"lingkup percakapan diminta,
tetapi tidak ada `[data-message-id]`"* **tidak akan pernah muncul di keluaran probe**, karena
probe sengaja membaca seluruh halaman (pertanyaannya "selector mana yang cocok di sini").
Catatan itu hanya ada di `notes` mode diagnostik panel.

## Bagian F. Yang dikirim kembali

Yang paling berharga adalah bagian **`probes`** pada laporan JSON — ia menyebut berapa
elemen yang cocok untuk setiap kandidat selector, dan **tidak memuat isi pesan**. Bagian
`senders` memuat alamat nyata; kalau tidak ingin membagikannya, hapus saja isinya, selector
tetap dapat diverifikasi sepenuhnya.

| Keadaan | Yang dikirim |
|---|---|
| Semua selector melaporkan nol kecocokan | Laporan probe halaman itu apa adanya |
| Ada elemen tambahan di baris daftar inbox | `outerHTML` baris itu, sudah disamarkan, plus versi ekstensi yang dipakai |
| Panel menjelaskan pengirim yang salah | Laporan probe halaman itu; ia sengaja membaca seluruh halaman, sehingga menunjukkan elemen mana yang cocok |
| Panel tidak berubah setelah berpindah pesan | Keluaran konsol yang berawalan `[Sender-Check]` beserta URL tiap email |

## Bagian G. Dua pengamatan yang hanya bisa datang dari sesi nyata

**a. Penanda "via".** `span.zx` dipakai sebagai kandidat pertama, tetapi pada setiap probe
yang tercatat selector itu melaporkan nol kecocokan — jadi pembacaan "via" adalah
best-effort yang **belum pernah terbukti bekerja** (§12.1 butir 4). Kalau Anda melihat
`via <domain>` pada baris pengirim di Gmail, jalankan probe di halaman itu dan simpan
laporannya: hanya pengamatan seperti itu yang dapat menentukan selector yang benar.
Kalau Gmail memang tidak merendernya, hasilnya `undefined` dan tidak ada rule yang terpicu —
itu keadaan yang benar, bukan bug.

**b. Pengirim tanpa nama.** Slot `thread-no-name.html` di direktori snapshot masih kosong
karena Gmail tidak merender pengirim tanpa nama pada akun pemelihara. Kalau Anda menemukan
satu — pesan yang menampilkan **alamatnya** sebagai pengganti nama — salin `outerHTML`
elemen pengirim itu, samarkan isinya, dan simpan ke slot itu. Bentuk yang benar adalah
**teks elemennya sama dengan alamatnya**, bukan sekadar atribut `name` yang dihapus; tanpa
mengubah teks, berkasnya tidak menguji keadaan yang dimaksud. Assertion-nya sudah ada dan
menyala sendiri begitu berkasnya terisi.

## Bagian H. Snapshot yang layak direkam ulang

`show-original.html` saat ini memuat halaman header apa adanya. Kalau wadah spesifiknya
ingin ikut teruji, rekam ulang dari `div[role="main"] pre` — cara mengambil dan menyamarkan
isinya ada di [`tools/corpus/dom-snapshots/README.md`](../tools/corpus/dom-snapshots/README.md).
Ini opsional: yang sekarang sudah cukup untuk membuktikan selector Tier B cocok.

## Bagian I. Setelah sesi ini

Hasilnya menentukan langkah berikutnya, dan tidak ada satu pun yang perlu ditebak:

| Hasil | Yang berubah di repo |
|---|---|
| Semua langkah 1–8 sesuai harapan | Phase 7 berhenti disebut "sebagian" di §13, dan unggahan ke AMO tidak lagi menunggu apa pun |
| Ada elemen ekstensi muncul di daftar inbox | Kasusnya dicatat sebagai bug §9: penanda yang dicabut tidak boleh kembali tanpa alasan yang lebih kuat daripada alasan pencabutannya |
| Selector tidak cocok lagi | Adapter disesuaikan dengan markup nyata, lalu snapshot diperbarui sebagai regression fixture |
| Penanda "via" ditemukan | Selector yang benar menggantikan `span.zx`, dan butir §12.1 4 berhenti disebut best-effort |

Satu hal yang **tidak** diubah oleh sesi ini: batas "satu panel per thread" dan ketiadaan
cache serta `IntersectionObserver`. Keduanya keputusan yang sudah dicatat, bukan kelalaian
yang menunggu ditemukan.
