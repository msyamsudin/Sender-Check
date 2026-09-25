# Sender-Check

[![CI](https://github.com/msyamsudin/Sender-Check/actions/workflows/ci.yml/badge.svg)](https://github.com/msyamsudin/Sender-Check/actions/workflows/ci.yml)
[![Lisensi: MIT](https://img.shields.io/badge/Lisensi-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](package.json)

Memeriksa apakah **display name pengirim konsisten dengan alamat emailnya**, lalu menjelaskan
bukti di balik kesimpulannya.

Dijalankan sepenuhnya di sisi klien. Tanpa network request, tanpa AI/ML, tanpa database brand
runtime.

> Ini bukan alat yang menentukan apakah sebuah email aman. Ia adalah *second pair of eyes*: ia
> menunjukkan hubungan antara nama yang ditampilkan dan alamat yang sebenarnya, beserta alasannya,
> lalu menyerahkan penilaiannya kepadamu.

---

## Status

| Bagian | Status |
|---|---|
| Engine analisis (`packages/core`) | **selesai dan terukur** |
| Adapter Gmail (`packages/adapters`) | **selesai**, selectornya belum diverifikasi terhadap Gmail hari ini |
| Skrip konsol Firefox | **selesai** — `pnpm console:build`, lalu tempel ke konsol |
| Corpus 404 kasus berlabel + release gate | **selesai** |
| UI ekstensi browser | belum |

Belum ada ekstensi yang bisa dipasang di Firefox. Yang ada sekarang: engine yang sudah
terbukti, adapter Gmail, dan skrip konsol untuk memverifikasi selector terhadap Gmail
sungguhan. Lihat **[`docs/FIREFOX.md`](docs/FIREFOX.md)** untuk cara memakainya di
Firefox, dan bagian 13 pada [`docs/DESIGN.md`](docs/DESIGN.md) untuk status setiap phase.

## Masalah yang dipecahkan

Sebuah email phishing nyata yang **tidak** diberi peringatan oleh webmail:

```
dari:                Rise <no-reply@mngl.in>
balas ke:            support@riseworks.digital
dikirim oleh:        mngl.in
ditandatangani oleh: mngl.in
```

Domain pengirim (`mngl.in`) tidak memuat "rise" sama sekali. Domain tujuan balasan
(`riseworks.digital`) memuatnya. SPF, DKIM, dan DMARC semuanya lulus untuk `mngl.in` — dan itu
memang benar, `mngl.in` menandatangani pesannya sendiri. Jadi tidak ada satu pun hasil autentikasi
yang bertentangan, dan webmail tidak punya alasan menampilkan peringatan.

Sender-Check menangkapnya:

```
⚠ Sender identity mismatch

Name      Rise
Email     no-reply@mngl.in
Reply-To  support@riseworks.digital

Why?
• "rise" muncul di domain tujuan balasan "riseworks.digital",
  tetapi tidak di domain pengirim "mngl.in"
• balasan diarahkan ke "riseworks.digital", berbeda dari domain pengirim "mngl.in"

Authentication: SPF, DKIM dan DMARC semuanya lulus — untuk mngl.in.
Itu membuktikan domain tersebut menandatangani pesannya sendiri.
Itu tidak membuat nama yang ditampilkan menjadi benar.

Consistency of a display name is not proof of authenticity.
This does not prove the email is malicious.
```

## Cara kerjanya

Dua hal membedakannya dari pemeriksa "apakah nama cocok dengan domain" yang biasa.

### 1. Ia menolak menilai ketika tidak ada dasar

Ini keputusan yang paling menentukan. Mayoritas email sah **memang** tidak punya hubungan antara
display name dan alamatnya — "Budi Santoso" dari alamat acak bukan anomali. Sebuah alat yang
menandai semua itu akan dimatikan pengguna dalam hitungan hari, dan setelah itu tidak berguna
sama sekali.

Jadi ada **gate klaim identitas**: engine hanya menilai bila display name memuat klaim yang dapat
diperiksa (G1–G7 pada [`docs/DESIGN.md`](docs/DESIGN.md) bagian 5). Di luar itu hasilnya
`UNASSESSABLE`, dan tidak ada yang ditampilkan.

### 2. Ia menghasilkan bukti, bukan skor

Tidak ada satu pun angka di keluaran. Yang ada adalah daftar bukti, masing-masing dengan arah
(`polarity`) dan bobot (`strength`), lalu sebuah decision table yang dievaluasi berurutan:

| State | Arti |
|---|---|
| `CONSISTENT` | Nama sejalan dengan alamat |
| `UNCLEAR` | Ada bukti yang saling bertentangan, atau bukti terlalu lemah |
| `INCONSISTENT` | Ada bukti kuat bahwa nama dan alamat tidak sejalan |
| `UNASSESSABLE` | Tidak ada dasar untuk menilai. **Bukan** berarti mencurigakan |

Begitu ada satu angka skor, seluruh keputusan akan mulai bergantung padanya dan penjelasan yang
dapat diverifikasi hilang. Karena itu angka tersebut tidak pernah ada.

## Hasil terukur

404 kasus berlabel buatan manusia, dijalankan di Node tanpa browser:

| Gate | Ambang | Hasil |
|---|---|---|
| Precision `INCONSISTENT`+HIGH | ≥ 95% | **100%** |
| Nag rate pada kasus tidak mencurigakan | ≤ 3% | **0,0%** |
| Recall pada kasus mencurigakan | sekunder | 76,4% |
| Test | — | **238 lulus** |

Presisi diutamakan di atas cakupan, dan itu dijalankan sebagai gate di CI: pull request yang
menurunkan presisi di bawah ambang akan gagal.

## Instalasi

```bash
git clone https://github.com/msyamsudin/Sender-Check.git
cd Sender-Check
pnpm install
```

Butuh Node.js ≥ 22.18 dan pnpm 11. Versi Node tersebut diperlukan karena proyek ini menjalankan
berkas TypeScript langsung tanpa langkah build, memanfaatkan type stripping bawaan Node.

## Menjalankan

```bash
pnpm example        # contoh pemakaian engine, dengan keluaran yang dapat dibaca
pnpm test           # 238 test: unit, property, end-to-end, adapter, arsitektur, dokumentasi
pnpm typecheck      # tsc, termasuk test arsitektur
pnpm corpus         # jalankan corpus + release gate, tulis laporan markdown
pnpm rules          # cetak tabel katalog rule sebagai baris Markdown
pnpm console:build  # bundel skrip konsol Firefox ke tools/console/dist/
pnpm docs:check     # periksa tautan dan path di dokumentasi
```

`pnpm corpus` keluar dengan kode 1 bila release gate gagal, sehingga dapat dipakai langsung di CI.
Tambahkan `-- --verbose` untuk melihat daftar lengkap false positive dan false negative.

## Pemakaian sebagai pustaka

```ts
import { analyze } from '@sender-check/core';

const verdict = analyze({
  displayName: 'Rise',
  fromAddress: 'no-reply@mngl.in',
  replyTo: 'support@riseworks.digital',
  returnPath: 'no-reply@mngl.in',
});

console.log(verdict.state);       // 'INCONSISTENT'
console.log(verdict.confidence);  // 'HIGH'

for (const item of verdict.evidence) {
  console.log(item.code, item.polarity, item.strength, item.trace);
}
```

Engine tidak pernah menghasilkan kalimat jadi. Ia menghasilkan `code` + `args`, dan kalimatnya
dibentuk di lapisan tampilan — sehingga teks dapat diterjemahkan tanpa menyentuh engine.

Panduan lengkap, termasuk arti setiap medan keluaran dan cara menyusun teksnya, ada di
**[`docs/USAGE.md`](docs/USAGE.md)**. Referensi seluruh 31 kode rule ada di
**[`docs/RULES.md`](docs/RULES.md)**.

## Memakai di Firefox

Belum ada ekstensi yang bisa dipasang, tetapi engine dan adapter sudah dapat dijalankan di
Gmail-mu hari ini lewat skrip konsol:

```bash
pnpm console:build
```

Menghasilkan dua berkas di `tools/console/dist/`:

| Berkas | Ukuran | Kegunaan |
|---|---|---|
| `sender-check.probe.js` | 13 KB | Melaporkan selector mana yang bekerja pada Gmail hari ini |
| `sender-check.console.js` | 281 KB | Probe + analisis lengkap untuk inbox nyata |

Tempel ke konsol Firefox saat Gmail terbuka. Firefox memblokir penempelan kode secara
default, jadi ketik `allow pasting` lebih dulu. Skrip ini tidak mengirim apa pun ke mana
pun; ia hanya membaca halaman dan mencetak ke konsol serta clipboard lokal.

Ini bukan sekadar alat diagnostik. Ia juga cara tercepat melihat alat ini bekerja pada
inbox-mu sendiri sebelum UI-nya ada.

Panduan lengkapnya, termasuk cara memuat ekstensi sementara via `about:debugging` dan dua
jebakan khas Firefox yang sudah diketahui, ada di **[`docs/FIREFOX.md`](docs/FIREFOX.md)**.

## Batasan yang diketahui

Tanpa database brand, `"Gojek"` dan `"Rizky"` tidak dapat dibedakan secara struktural. Konsekuensi
nyata:

| Kasus | Hasil | Sebab |
|---|---|---|
| `"KlikBCA" <cs@bca-klik.com>` | `CONSISTENT`/MEDIUM | Domain memang memuat "klik" dan "bca" |
| `"BNI" <cs@bnl.co.id>` | `UNCLEAR`/MEDIUM | Substitusi huruf juga merupakan varian ejaan nama orang Indonesia (Rizky/Rizki) |
| `"Apple" <support@apple-verify.com>` | `CONSISTENT`/MEDIUM | "Apple" memang ada di domainnya; hanya pengetahuan merek yang dapat memutuskan |

Daftar lengkapnya ada di [`docs/DESIGN.md`](docs/DESIGN.md) bagian 15.4 dan di laporan corpus.
Sengaja ditampilkan, bukan disembunyikan: menyembunyikannya akan membuat metrik terlihat lebih baik
daripada kenyataannya.

## Struktur repositori

```
packages/core/            engine murni: tanpa DOM, tanpa chrome.*, tanpa network, tanpa jam/RNG
  src/normalize/          skeleton TR39, punycode RFC 3492, fold digit/huruf, deteksi aksara
  src/domain/             algoritma PSL, taksonomi 6 kelas domain, penguraian alamat
  src/name/               tokenisasi, klasifikasi token, klaim domain, klaim organisasi
  src/similarity/         Jaro-Winkler, Damerau-Levenshtein, LCS, aturan ambang panjang
  src/evidence/           pencocokan token, gate klaim identitas, katalog rule, parser auth
  src/classification/     decision table yang dievaluasi berurutan
  src/data/               freemail, disposable, ESP, milis, token, penjaga fold, PSL, confusables

packages/adapters/        DOM webmail menjadi EmailIdentity. Bekerja pada antarmuka DOM
                          yang dipersempit, sehingga dapat diuji di Node tanpa jsdom
tools/corpus/             404 fixture berlabel + harness CLI + laporan otomatis
tools/console/            skrip konsol Firefox: probe selector dan analisis
tools/gen-psl/            generator PSL dari daftar resmi (build-time)
tools/gen-unicode/        generator tabel confusable dari confusables.txt (build-time)
examples/                 contoh pemakaian yang dapat dijalankan
docs/                     DESIGN.md, USAGE.md, RULES.md, FIREFOX.md
```

Dua invariant ditegakkan oleh test yang membaca source-nya sendiri, bukan sekadar
dijanjikan di dokumen: `packages/core` tidak boleh memuat DOM, `chrome.*`, jaringan, jam,
RNG, atau `eval`; dan `packages/adapters` wajib bekerja pada antarmuka DOM yang
dipersempit sehingga tidak ada satu pun berkasnya yang menyentuh `document` secara
langsung.

## Regenerasi data

Dua berkas di `packages/core/src/data/*.generated.ts` dihasilkan dari sumber resmi dan **tidak boleh
diedit manual**. Keduanya build-time saja; extension tidak pernah melakukan network request.

```bash
# PSL — https://publicsuffix.org/list/public_suffix_list.dat
# Unduh ke tools/gen-psl/public_suffix_list.dat, lalu:
node tools/gen-psl/generate.ts

# Tabel confusable — https://www.unicode.org/Public/security/latest/confusables.txt
# Unduh ke tools/gen-unicode/confusables.txt, lalu:
node tools/gen-unicode/generate.ts
```

`pslVersion` disertakan pada setiap verdikt dan menjadi bagian dari cache key, sehingga perubahan
data tidak pernah membuat hasil lama menghantui.

## Dokumentasi

| Berkas | Isi |
|---|---|
| [`docs/FIREFOX.md`](docs/FIREFOX.md) | Cara memakai di Firefox: skrip konsol, cara memuat ekstensi, dan jebakan khas Firefox |
| [`docs/USAGE.md`](docs/USAGE.md) | Cara memakai, arti keluaran, cara menambah fixture, pemecahan masalah |
| [`docs/RULES.md`](docs/RULES.md) | Referensi seluruh kode rule beserta contoh fixture yang memicunya |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design record: keputusan, alasan, dan catatan implementasi |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Cara berkontribusi, termasuk alur adversarial-first |
| [`CHANGELOG.md`](CHANGELOG.md) | Riwayat perubahan |
| [`THIRD_PARTY.md`](THIRD_PARTY.md) | Lisensi data pihak ketiga yang dibundel |

## Kontribusi

Kontribusi terbuka, dan yang paling dibutuhkan sekarang adalah **contoh email nyata** yang lolos
deteksi — itu jauh lebih berharga daripada kasus sintetis.

Satu aturan mengalahkan yang lain: presisi di atas cakupan. Menambahkan deteksi baru boleh
menurunkan recall; menurunkan presisi tidak boleh. Ada prosedur **adversarial-first** yang terbukti
menemukan tiga false positive yang tidak terlihat oleh corpus umum sama sekali. Selengkapnya di
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Lisensi

[MIT](LICENSE) © 2026 msyamsudin.

Repositori ini membundel dua berkas data pihak ketiga dengan lisensinya masing-masing: Public Suffix
List (MPL-2.0) dan Unicode `confusables.txt` (Unicode License v3). Rinciannya di
[`THIRD_PARTY.md`](THIRD_PARTY.md).
