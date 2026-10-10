# Sender-Check — Design & Decision Record

Status: **locked for v1** · Dokumen ini adalah spec yang dikodekan oleh Phase 1+.
Setiap perubahan pada angka threshold atau decision table wajib menaikkan `algorithmVersion`.

---

## 1. Tujuan & batas

> Mengidentifikasi apakah **display name konsisten dengan alamat email**, lalu menjelaskan buktinya.
> Bukan menentukan apakah email aman, dan bukan mendeteksi phishing.

### Non-goals eksplisit (wajib ditampilkan di UI)

| Tidak dilakukan | Alasan |
|---|---|
| Mendeteksi akun yang dikompromikan | Butuh data perilaku/historis yang tidak dimiliki |
| Mendeteksi BEC dengan display name = nama CEO asli dari domain luar | Kita tidak tahu siapa pemilik identitas yang sah |
| Verifikasi kriptografis DKIM | Kita hanya *membaca* hasil dari header, bukan memverifikasi tanda tangan |
| Menganalisis isi/body/link email | Di luar cakupan; permukaan privasi membesar tanpa perlu |
| Menyimpulkan "aman" / "verified" / "legitimate" | Konsistensi nama ≠ autentisitas |

### Prinsip

1. Client-side, tanpa network request, tanpa AI/ML, tanpa database brand runtime. Janji ini
   pernah dilonggarkan untuk satu tombol di panel, lalu **dicabut kembali** — lihat D1.
2. Tidak ada satu `phishing_score`. Hanya rule eksplisit + decision table.
3. `UNASSESSABLE` dipakai saat dasar penilaian tidak cukup — **bukan** dianggap mismatch.
4. Detector berperan sebagai *second pair of eyes*, bukan antivirus.

---

## 2. Keputusan arsitektur (ADR)

### D1 — Analisis dua tier atas permintaan · **ACCEPTED**

`Reply-To`, `Return-Path`, dan `Authentication-Results` **tidak dirender** di DOM inbox Gmail.
Karena itu:

- **Tier A** — selalu, tanpa network request. Sumber: DOM list/thread Gmail
  (atribut `name`, `email`, `data-hovercard-id`, indikator `via`, banner peringatan Gmail).
  Menghasilkan: display name, From address, kelas domain, info ESP dari teks `via`.
- **Tier B** — dari header asli, yang hanya dirender Gmail di halaman **"Show original"**
  (`mail.google.com/mail/u/N/?...&view=om&permmsgid=msg-f:...`). Content script juga di-inject ke
  halaman itu dan mem-parse raw header dari DOM-nya. **Nol network request dari extension** — user
  yang membuka halamannya, extension hanya membaca.
  Menambah: `Reply-To`, `Return-Path`, `Authentication-Results`, `Received-SPF`.

  **Dicoba, lalu dicabut: extension mengambil halaman header sendiri.** Harga dari aturan
  "hanya user yang membuka" ternyata terasa: kelas penipuan yang paling perlu ditangkap —
  display name yang ditegakkan domain tujuan balasan — tidak pernah terlihat oleh pengguna
  yang tidak tahu harus membuka apa. Karena itu panel sempat punya tombol "Periksa header
  asli" yang mengambil halaman itu dengan `fetch`, menilainya ulang, dan menampilkan
  verdiktnya di panel yang sama; batasnya ditegakkan test arsitektur (satu berkas, tanpa
  literal host, wajib berkredensial, tidak dipanggil dari jalur pemindaian).

  Tombol itu **dicabut kembali**, dan alasannya bukan teknis: janji "tanpa permintaan
  jaringan" adalah alasan utama alat yang menyentuh kotak masuk orang ini boleh dipercaya,
  dan menukarnya dengan satu tombol tidak sebanding. Yang menggantikannya justru memperbaiki
  masalah aslinya di sisi yang selama ini lemah: state `UNASSESSABLE` kini **menjelaskan
  mengapa** ia tidak menilai dan **menyebut langkah aman** yang dapat dikerjakan pengguna
  (menu ⋮ → "Tampilkan aslinya", tempat panel menilai ulang dengan header lengkap). Panel
  yang berkata "belum dapat dipastikan" disertai jalan keluarnya lebih jujur daripada panel
  yang diam-diam mengambil apa yang tidak pernah ia janjikan untuk ambil.

Tidak ada Tier C (Gmail API + OAuth) di v1: biaya consent/verifikasi Google tidak sepadan.

**Konsekuensi:** `EmailIdentity` wajib membawa `provenance`. Classifier tidak boleh menilai sinyal
Tier B ketika provenance = `dom-inbox` (ketidakhadiran data ≠ ketidakcocokan).

### D2 — Mode UI hybrid · **ACCEPTED**

Sinyal di list view hanya muncul untuk `strength: strong`. Penjelasan penuh muncul sebagai panel
saat thread dibuka, plus popup untuk pesan aktif. Mode default = tenang.

### D3 — Stack: pnpm workspace + TypeScript + Vitest + WXT · **ACCEPTED**

Tanpa remote code. Tanpa dependency yang mengeksekusi string.

### D4 — Cakupan v1: Gmail saja · **ACCEPTED**

Outlook menyusul setelah presisi Gmail terbukti. Tidak ada "generic DOM adapter" — tidak mungkin
presisi tanpa selector per-webmail.

### D5 — Nama state: `CONSISTENT / UNCLEAR / INCONSISTENT / UNASSESSABLE` · **ACCEPTED**

Mengganti `MATCH/MISMATCH` yang secara psikologis terdengar seperti vonis.

### D6 — Determinisme engine · **ACCEPTED**

`packages/core` tidak boleh memanggil `Date.now()`, `Math.random()`, `chrome.*`, atau DOM.
Waktu dan konfigurasi di-inject. Syarat wajib agar corpus test reproducible dan bisa jalan di Node CLI.

---

## 3. Model data

```ts
type Provenance = 'dom-inbox' | 'dom-original';

interface EmailIdentity {
  provenance: Provenance;
  displayName: string | null;   // null = atribut name tidak ada di DOM
  fromAddress: string;
  replyTo?: string;             // hanya ada bila provenance === 'dom-original'
  returnPath?: string;          // idem
  authenticationResults?: string; // idem
  gmailViaHint?: string;        // teks "via <esp>" yang dirender Gmail (Tier A)
  gmailOwnWarning?: boolean;    // banner peringatan milik Gmail terdeteksi (Tier A)
}

type Polarity =
  | 'supports_consistency'
  | 'supports_inconsistency'
  | 'neutral'
  | 'context';

type Strength = 'strong' | 'medium' | 'weak';

interface Evidence {
  code: RuleCode;
  polarity: Polarity;
  strength: Strength;
  tier: 'A' | 'B';
  args: Record<string, string | number>; // untuk i18n template, bukan kalimat jadi
  trace: string;                          // bukti mentah, mis. `"rise" ⊂ "risehq"`
}

type State = 'CONSISTENT' | 'UNCLEAR' | 'INCONSISTENT' | 'UNASSESSABLE';
type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

interface Verdict {
  state: State;
  confidence: Confidence;
  evidence: Evidence[];
  gate: GateResult;          // kenapa dinilai / tidak dinilai (§5)
  algorithmVersion: string;
  pslVersion: string;
}
```

Aturan: engine **tidak pernah** menghasilkan string bahasa Inggris. Semua teks UI dibentuk dari
`code` + `args` lewat template per-locale.

---

## 4. Pipeline

```
EmailIdentity
  → Normalization      (original + normalized + skeleton disimpan)
  → Domain Analyzer    (PSL: hostname, registrable, suffix, subdomain, kelas domain)
  → Name Analyzer      (tokenisasi, bobot generic, kandidat local-part)
  → Similarity Engine  (kanal independen, max meaningful signal)
  → Identity-Claim Gate (§5)  ← gerbang, bukan skor
  → Evidence Engine    (rule catalog §7)
  → Decision Table     (§8, evaluasi berurutan)
  → Verdict
  → UI Renderer        (i18n, evidence-first)
```

---

## 5. Identity-Claim Gate — pengungkit presisi terbesar

Mayoritas email sah **memang** tidak punya hubungan display name ↔ alamat. Menganalisis semuanya
menghasilkan kelelahan false positive dan extension dimatikan user.

> **Analisis hanya dijalankan bila display name memuat *identity claim* yang dapat diverifikasi.**

Gate lolos bila salah satu benar:

| # | Kondisi | Catatan |
|---|---|---|
| G1 | Display name memuat alamat email **lain** | Bandingkan langsung ke From. Spoof-rendering klasik. |
| G2 | Display name memuat token berformat domain (`kata.tld`) | Divalidasi lewat PSL, bukan daftar TLD manual |
| G3 | Ada token display name yang cocok dengan local-part atau label domain From | Kandidat `CONSISTENT` |
| G4 | Ada token display name yang **confusable** / hasil digit-fold terhadap local-part atau label domain | Kandidat `INCONSISTENT` |
| G5 | Display name mengklaim organisasi (bukan pola nama manusia) **dan** domainnya freemail/disposable | `bankbca` <bcaindonesia@gmail.com> |
| G6 | Display name mengklaim organisasi **dan** domainnya corporate/subdomain-delegated | Ditambahkan saat implementasi; lihat catatan |
| G7 | Identitas display name muncul di domain **Reply-To** tetapi tidak di domain From | Ditambahkan setelah kasus nyata; lihat catatan |

**G7 ditambahkan setelah sebuah kasus penipuan nyata lolos.** Email yang dilaporkan:
`Rise <no-reply@mngl.in>` dengan `Reply-To: support@riseworks.digital`. Domain From
(`mngl.in`) tidak memuat "rise" sama sekali; domain tujuan balasan
(`riseworks.digital`) memuatnya. SPF, DKIM, dan DMARC semuanya lulus untuk `mngl.in`,
jadi autentikasi tidak memberi sinyal apa pun dan webmail pun tidak menampilkan peringatan.

Sebelum G7, engine mengembalikan `UNASSESSABLE` untuk email itu — kegagalan total pada
jenis penipuan yang justru paling perlu ditangkap. Seluruh sinyalnya berada di header
Show original, sedangkan G1–G6 hanya melihat domain From.

Dua keputusan penting pada G7:

- **Dikecualikan bila domain From adalah kelas `esp`.** Sebagian ESP mengirim dengan
  domainnya sendiri sebagai From atas nama klien; itu konfigurasi lazim dan sah.
- **TIDAK ditekan oleh indikator "via".** "Via" menjelaskan mengapa Return-Path berbeda
  dari From, tetapi tidak menjelaskan mengapa identitas yang diklaim justru muncul di
  domain tujuan balasan dan bukan di domain pengirim. Menekannya karena "via" akan
  membuka kembali persis kasus yang paling perlu ditangkap.

**G6 ditambahkan saat implementasi.** Tanpa G6, rule `ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN`
menjadi kode mati: ia hanya dapat berjalan bila gate lolos, sedangkan seluruh kondisi gate yang lain
mensyaratkan adanya kecocokan token atau freemail. Akibatnya
`"Bank BCA" <cs@totally-unrelated.xyz>` berhenti sebagai "tidak dapat dinilai" padahal ada sesuatu
yang layak dikatakan. G6 aman terhadap false positive karena rule yang dipicu berstrength menengah,
sehingga paling jauh menghasilkan `UNCLEAR` dan tidak pernah muncul di list view.

Gate **gagal** → `UNASSESSABLE`, dan **UI tidak menampilkan apa pun** (bukan kuning, bukan badge).

Wajib `UNASSESSABLE` (bukan `INCONSISTENT`), meski gate lolos sebagian:

- `displayName === null` atau kosong → tidak ada yang dibandingkan.
- Domain mailing-list/grup (`googlegroups.com`, `lists.*`) → arsitektur pengiriman memutus hubungan.
- Nama manusia multi-kata + domain corporate → normal dan sangat umum.
- Nama manusia + alamat acak (`"Budi Santoso" <x7k2@randomisp.co.id>`) → tidak ada dasar untuk menilai.

**Koreksi terhadap contoh UI di bagian 11.** `"Rise" <john123@gmail.com>` **bukan** `INCONSISTENT`.
Tidak satu pun kondisi G1–G6 terpenuhi, sehingga hasilnya `UNASSESSABLE`. Contoh itu bertentangan
dengan prinsip bagian ini sendiri, dan prinsipnya yang benar: menandai setiap nama tunggal dengan
alamat pribadi sebagai mismatch adalah persis kebisingan yang hendak dihindari.

Kebalikannya juga perlu dicatat: `"Andi" <andi@gmail.com>` menghasilkan `CONSISTENT` karena token
"andi" cocok persis dengan local-part-nya. Ini bukan flag, tidak muncul di list view, dan
pernyataannya memang benar — nama konsisten dengan alamat.

**Metrik yang dijaga:** `nagRate` = % baris inbox yang memunculkan sinyal **visible** (state
`INCONSISTENT`). **Target v1 < 3%.**

---

## 6. Normalization & Domain

### 6.1 Skeleton confusable

Gunakan **TR39 skeleton**, bukan NFKC. NFKC **tidak** memetakan Cyrillic `а` (U+0430) → Latin `a`.

```
skeleton(x) = NFD( map_confusables( NFD(x) ) ) dengan default-ignorable dibuang
```

- Tabel confusable **di-generate saat build** dari `confusables.txt` Unicode ke
  `packages/core/src/data/confusables.generated.ts`.
- Jangan menulis tabel homoglyph manual.
- Uji: skeleton harus konsisten dengan `confusables.txt` untuk sampel acak.

**Sumber ASCII harus dibuang dari tabel, dan ini ditemukan saat implementasi.**
`confusables.txt` resmi ternyata memuat `U+0030 "0" -> "o"`, `U+0031 "1" -> "l"`,
`U+0049 "I" -> "l"`, dan `U+006D "m" -> "rn"`. Kalau keempatnya ikut masuk ke skeleton:

- substitusi digit naik menjadi bukti berstrength **kuat**, padahal desain menetapkannya lemah;
- `"modern"` dan `"modem"` menjadi setara, karena `m` di-fold menjadi `rn` — dan memang keduanya
  confusable menurut Unicode, tetapi bukan itu yang ingin kita deteksi.

Karena itu generator menyaring seluruh sumber ASCII (8 entri) dan hanya menyisakan 1.786 mapping
non-ASCII. Substitusi digit dan huruf ditangani di `normalize/fold.ts` sebagai kanal terpisah yang
berstrength lebih rendah, dengan penjaga kamus.

### 6.2 Punycode

Browser tidak mengekspos decode: `new URL('https://xn--80ak6aa92e.com').hostname` tetap `xn--`.
`URL.domainToUnicode` hanya ada di Node. → Implementasikan **RFC 3492 decode** di core.

`PUNYCODE_DOMAIN` berstrength **weak/context**, bukan bukti kejahatan: IDN sah banyak (termasuk `.id`).
Implementasi akhirnya membuatnya **selalu context**, tidak pernah naik menjadi kuat, karena seluruh
kasus homoglyph berpunycode sudah tertangkap kanal `CONFUSABLE_MATCH_TO_TOKEN` yang bekerja pada label
hasil decode. Menaikkannya hanya akan menggandakan bukti yang sama.

Satu catatan penting untuk pemanggil di luar: `punycodeToUnicode` mengembalikan hostname **apa adanya**
bila ada satu label yang gagal didekode. Ini disengaja, supaya pemanggil tidak pernah membandingkan
campuran bentuk ASCII dan Unicode.

### 6.3 Digit / letter folding — aturan ketat

`rn→m`, `vv→w`, `0→o`, `1→l/i`, `3→e`, `4→a`, `5→s`, `8→b`, `@→a`.

- **Satu arah.** Hanya kandidat yang di-fold; target tidak pernah di-fold.
- **Wajib ada target konkret** untuk dibandingkan. Tidak ada fold global.
- `foldVariants` **tidak pernah** mengembalikan bentuk asli, supaya pemanggil tidak salah melaporkan
  kecocokan persis sebagai kecocokan substitusi.
- Hasilnya rule tersendiri yang berstrength lebih rendah dari kecocokan persis.

**Penjaga kamus — dilingkupi lebih sempit daripada rencana awal.** Rencana menyebut wordlist EN+ID
~20k kata. Yang diimplementasikan adalah daftar kurasi ±200 kata yang mengandung `rn` atau `vv`,
karena hanya dua bigram itulah yang berisiko: digit praktis tidak muncul di dalam kata, sehingga
kehadiran digit pada token brand memang sebuah sinyal dan tidak perlu dijaga.

Alasannya bisa diukur. `DIGIT_SUBSTITUTION_MATCH` berstrength `weak` di luar label registrable, dan
`weak` paling jauh menghasilkan `UNCLEAR/LOW` — yang tidak pernah ditampilkan di list view. Jadi
kesalahan di penjaga ini berbiaya sangat rendah, sementara kamus 20k kata berbiaya nyata pada ukuran
bundel dan provenance lisensinya. Karena itu daftar kurasi dipilih, dengan konsekuensi `modern`,
`internet`, `pernah`, dan `turnamen` terlindungi sementara kata langka ber-`rn` mungkin tidak.

### 6.4 Mixed-script

Cek **per-label**, pakai **Script_Extensions**, bukan sekadar "jumlah script > 1".
Kombinasi sah yang di-whitelist: Han+Hiragana+Katakana (JA), Hangul+Han (KO).
Yang mengkhawatirkan: Latin + Cyrillic/Greek **di dalam satu label**, atau Latin + Arab/Devanagari.
Latin+Aksara Arab bisa muncul pada nama Indonesia — perlakukan sebagai `medium`, bukan `strong`,
kecuali confusable terhadap token lain.

### 6.5 Taksonomi domain — 6 kelas

Freemail vs corporate saja tidak cukup; ESP akan memicu `REPLY_TO_MISMATCH` palsu.

| Kelas | Contoh | Kebijakan |
|---|---|---|
| `freemail` | gmail.com, outlook.com, yahoo.com, icloud.com, proton.me | Jalur scoring berbeda; G5 aktif |
| `corporate` | domain organisasi | Jalur normal |
| `esp` | sendgrid.net, mailgun.org, amazonses.com, mcsv.net, ccsend.com | Return-Path/Reply-To mismatch **di-suppress** |
| `mailing-list` | googlegroups.com, lists.* | `UNASSESSABLE` |
| `disposable` | mailinator, tempmail, dsb. | Perlakukan seperti freemail tapi lebih tegas |
| `subdomain-delegated` | `brand.com.host.co.id` | Jangan anggap `BRAND_IN_SUBDOMAIN_ONLY` |

### 6.6 PSL

Di-bundle lokal. **PSL bukan security boundary** — ICANN/SSAC
([SAC070](https://itp.cdn.icann.org/en/files/planning/resolution-implementation-recommendations-ssac-advice-documents-08jun17-en.pdf))
dan PSL sendiri menyatakan hal ini. Wildcard (`*.compute.amazonaws.com`) harus didukung.
Sertakan `pslVersion` + `pslUpdatedAt` di footer UI. Update lewat script build, bukan runtime network.

---

## 7. Rule catalog

Threshold similarity (menggantikan "min token length ≥3" yang terlalu longgar):

| Operasi | Syarat panjang | Alasan |
|---|---|---|
| Exact token equality | `min(len) ≥ 3` | Equality adalah bukti kuat |
| Awalan/akhiran | `min(len) ≥ 3` | Hubungan batas kata; kekuatannya ditentukan rasio panjang |
| Ambang kemiripan (JW / Damerau) | `min(len) ≥ 6` | JW meledak pada string pendek karena common prefix |
| Jarak tepat satu karakter | `min(len) ≥ 3` | Untuk token 3–5 huruf, ambang persentase terlalu kasar |
| Homoglyph (skeleton) | `min(len) ≥ 3` | "Aksara berbeda, bentuk sama" tetap bermakna pada akronim seperti OVO/BCA/BRI |
| Fold digit/huruf | `min(len) ≥ 4` | FP-prone; kuat hanya pada label registrable |

Dua baris terakhir berasal dari pengukuran, bukan dari rencana awal. Ambang 5 untuk homoglyph dan
fold membuang justru akronim yang paling sering dipalsukan di Indonesia (`ovo`, `bca`, `bri`, `bni`,
`dana`); sementara ambang 6 untuk fuzzy membuat seluruh typosquat 5–6 huruf (`gojeg`, `bnl`, `shope`)
tidak pernah diperiksa sama sekali.

Jaro-Winkler **tidak pernah** menjadi satu-satunya dasar `CONSISTENT`/`INCONSISTENT`.
Yang dirender ke UI adalah bukti konkret (`"rise" ⊂ "risehq"`), bukan angka skor.

### Tier A

| Code | Polarity | Strength |
|---|---|---|
| `DISPLAY_NAME_EMBEDS_OTHER_ADDRESS` (≠ From) | inconsistency | strong |
| `DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS` (= From) | consistency | strong |
| `DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN` | inconsistency | strong |
| `DISPLAY_NAME_MATCHES_LOCALPART_EXACT` | consistency | strong\* |
| `DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL` | consistency | strong / medium |
| `DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT` | inconsistency | strong |
| `LOOKALIKE_NEAR_MISS` | inconsistency | strong / medium |
| `DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY` | inconsistency | strong / medium |
| `FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME` | inconsistency | strong |
| `ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN` | inconsistency | medium |
| `CONFUSABLE_MATCH_TO_TOKEN` | inconsistency | strong |
| `MIXED_SCRIPT_WITHIN_LABEL` | inconsistency | strong / medium |
| `DIGIT_SUBSTITUTION_MATCH` | inconsistency | strong / weak |
| `TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL` | inconsistency | weak |
| `PUNYCODE_DOMAIN` | context | weak |
| `DISPOSABLE_DOMAIN` | context | weak |
| `GENERIC_TOKEN_ONLY_DISPLAYNAME` | context | weak |
| `HUMAN_NAME_PATTERN` | context | weak |
| `RANDOM_LOCAL_PART` | context | weak |
| `NO_DISPLAY_NAME` | context | weak |
| `MAILING_LIST_DOMAIN` | context | weak |
| `GMAIL_VIA_ESP_HINT` | context | weak |
| `GMAIL_OWN_WARNING_PRESENT` | context | weak |

\* `DISPLAY_NAME_MATCHES_LOCALPART_EXACT` turun menjadi **medium** bila display name mengklaim
sebuah organisasi. Alasannya: untuk orang, local-part adalah tempat namanya berada; untuk organisasi,
identitas harus hidup di **domain**, karena local-part bebas dibentuk pengirim. Tanpa aturan ini,
`"Netflix Billing" <netflixbilling@streamingpartners.co>` akan dilaporkan sebagai konsisten.

Catatan strength pada `DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL`: cocok persis dengan **seluruh**
label registrable adalah strong; cocok persis dengan salah satu **komponennya** saja adalah medium,
karena `apple-verify.com` memang memuat kata "apple" tetapi bukan domain Apple.

### Tier B (hanya bila `provenance === 'dom-original'`)

| Code | Polarity | Strength |
|---|---|---|
| `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT` | inconsistency | strong\*\* |
| `REPLY_TO_DOMAIN_MISMATCH` | inconsistency | medium |
| `REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE` | inconsistency | strong |
| `RETURN_PATH_NULL_OR_MISMATCH` | context | weak |
| `AUTH_DMARC_FAIL` | inconsistency | medium\* |
| `AUTH_SPF_FAIL` / `AUTH_DKIM_FAIL` | context | weak |
| `AUTH_ALIGNED_PASS` | consistency | medium |

\*\* `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT` adalah kanal terkuat di Tier B, dan satu-satunya
rule yang lahir langsung dari laporan pengguna. Ia menyala ketika ada token identitas yang menempel
pada bagian registrable domain Reply-To (persis, awalan, akhiran, atau sebagai komponen berpenyekat)
tetapi tidak menempel pada domain From. Hanya kanal kecocokan biasa yang dihitung; kanal homoglyph
dan near-miss dikecualikan karena keduanya sudah punya rule sendiri dengan severity masing-masing.

\* `AUTH_DMARC_FAIL` diturunkan menjadi **medium**, bukan strong seperti rencana awal. DMARC
mengautentikasi **domain**, bukan display name. Pada strength medium, kegagalan DMARC sendirian
menghasilkan `UNCLEAR`/MEDIUM — yang memang seharusnya. Ia baru ikut mendorong `INCONSISTENT`
bila sudah ada inkonsistensi nama↔alamat dari Tier A. Jangan pernah memperlakukan authentication
PASS sebagai bukti bahwa organisasi yang diklaim display name adalah asli.

`GMAIL_VIA_ESP_HINT` dan kelas domain `esp` men-suppress `RETURN_PATH_*`, `REPLY_TO_DOMAIN_MISMATCH`,
dan `REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE`. Penekanan `REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE`
juga berlaku saat ESP terbukti: mengarahkan balasan ke mailbox pribadi sambil mengirim lewat ESP
adalah konfigurasi yang lazim, dan tanpa penekanan ini Tier B akan menjadi sumber derau.

---

## 8. Decision table — evaluasi berurutan, bukan penjumlahan bobot

Ini yang membedakan "rules" dari "skor terselubung". Implementasi sebagai
`const DECISION_TABLE: DecisionRow[]` yang dievaluasi top-down; baris pertama yang cocok menang.
Setiap baris punya unit test sendiri, dan `trace` mencatat baris yang dievaluasi.

| # | Kondisi | State | Confidence |
|---|---|---|---|
| 1 | Gate gagal (§5) | `UNASSESSABLE` | LOW |
| 2 | `NO_DISPLAY_NAME` \| `MAILING_LIST_DOMAIN` | `UNASSESSABLE` | LOW |
| 3 | ≥1 strong inconsistency **dan** 0 strong consistency | `INCONSISTENT` | HIGH |
| 4 | ≥1 strong inconsistency **dan** ≥1 strong consistency | `UNCLEAR` | MEDIUM |
| 5 | ≥1 medium inconsistency **dan** 0 strong inconsistency | `UNCLEAR` | MEDIUM |
| 6 | ≥1 strong consistency **dan** tidak ada inkonsistensi apa pun | `CONSISTENT` | HIGH |
| 7 | ≥1 medium consistency **dan** tidak ada inkonsistensi | `CONSISTENT` | MEDIUM |
| 8 | ≥1 weak inconsistency | `UNCLEAR` | LOW |
| 9 | Tidak ada bukti bermakna | `UNASSESSABLE` | LOW |

Baris 5 adalah penambahan saat implementasi, dan ia menutup lubang yang penting: tanpa baris itu,
inkonsistensi menengah tidak punya tempat, sehingga `AUTH_DMARC_FAIL` dan
`ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN` akan jatuh ke baris terakhir dan dilaporkan sebagai
`UNASSESSABLE` — padahal justru keduanya adalah alasan utama `UNCLEAR` ada.

Peringkat baris juga penting: baris 5 harus dievaluasi **sebelum** baris 6 dan 7. Kalau tidak,
sebuah pesan yang punya konsistensi kuat sekaligus inkonsistensi menengah akan dilaporkan
`CONSISTENT`, dan sinyal menengahnya hilang tanpa jejak.

`ruleTrace` disimpan di hasil untuk debugging dan ditampilkan di mode diagnostik.

---

## 9. Spesifikasi UI

- **List view:** indikator halus **hanya** untuk `INCONSISTENT` + `strength: strong`.
  Tidak ada badge untuk `UNASSESSABLE`/`UNCLEAR`. Nama pengirim yang **dipotong Gmail
  dilewati sama sekali** — keputusannya ada di §12.1 butir 6 beserta alasannya, dan ia
  menjaga agar pengirim yang sama tidak memperoleh dua state berbeda antara daftar dan
  thread.
- **Thread terbuka:** panel penuh, evidence-first, dengan tombol "Copy report" yang menyalin
  isi panel apa adanya sebagai teks. Pada state `UNASSESSABLE` panel **menjelaskan mengapa** ia tidak
  menilai dan **menyebut langkah aman** yang dapat dikerjakan pengguna: periksa header asli
  lewat menu ⋮ → "Tampilkan aslinya", tempat panel menilai ulang dengan `Reply-To` dan hasil
  autentikasi. Ekstensi tidak mengambil halaman itu sendiri (D1), dan bagian ini sengaja
  tidak diwarnai seperti peringatan: `UNASSESSABLE` berarti belum dapat dipastikan, bukan
  mencurigakan — mewarnainya akan membuat setiap email dengan nama orang biasa tampak
  berbahaya.
- **Popup:** analisis pesan aktif + tombol "Analisis header lengkap" (mengarahkan/membuka Tier B).
- **Mode diagnostik:** menampilkan `provenance`, selector yang match, `ruleTrace`, versi algoritma/PSL.

Struktur panel. Contoh pertama adalah kasus nyata yang dilaporkan pengguna; contoh lama
(`"Rise" <john123@gmail.com>`) sudah dikoreksi di bagian 5 karena ternyata `UNASSESSABLE`.

```
⚠ Sender identity mismatch

Name         Rise
Email        no-reply@mngl.in
Reply-To     support@riseworks.digital

Why?
• "rise" appears in the reply-to domain "riseworks.digital", but not in the
  sending domain "mngl.in"
• Replies are routed to a domain other than the sender's

Authentication: SPF, DKIM and DMARC all pass — for mngl.in.
That proves the domain signed its own message. It does not make the
displayed name true.

Display name consistency is not proof of authenticity.
This does not prove the email is malicious.
```

Untuk match:

```
✓ Name consistent with address

Name    Rise
Email   support@rise.com

• "rise" matches the domain
• "support" is a generic service token

Display name consistency is not proof of authenticity.
```

Dua catatan tentang panel ini:

- Pada kasus Reply-To, baris autentikasi **wajib ditampilkan**. Justru karena SPF/DKIM/DMARC
  semuanya lulus, pengguna perlu tahu bahwa kelulusan itu tidak bertentangan dengan temuan ini —
  dan bahwa webmail memang tidak punya alasan menampilkan peringatan. Menyembunyikannya akan membuat
  temuan tampak bertentangan dengan indikator keamanan yang sudah dilihat pengguna.
- Panel tidak pernah menampilkan **subjek** atau isi pesan, sesuai batas privasi yang ditetapkan.

- Disclaimer **permanen di semua state, termasuk `CONSISTENT`** — risiko over-trust terbesar
  justru ada di sana.
- Token generic harus punya padanan ID: `tim, dukungan, tagihan, keamanan, resmi, notifikasi,
  halo, pajak, pengiriman`.
- i18n sejak awal (ID + EN). Jangan pernah menaruh kalimat Inggris di engine.
- Jangan pakai nama/logo Gmail·Outlook. Sebut "kompatibel dengan". Sertakan halaman privasi:
  tanpa network request, tanpa telemetry, hanya metadata pengirim dibaca.

**Status implementasi.** Yang sudah berlaku di `apps/extension`: disclaimer permanen di
setiap state, lambang yang menyertai warna sehingga warna bukan satu-satunya pembawa arti,
tidak ada `innerHTML` di lapisan tampilan (dijaga test), dan tidak ada nama maupun logo
webmail di dalam produk. **Halaman privasi** juga sudah ditulis dan ada di
[`PRIVACY.md`](PRIVACY.md) — setiap pernyataannya menunjuk kode atau test yang menegakkannya,
sehingga ia tidak dapat menjadi lebih longgar daripada perilaku ekstensinya tanpa ada yang gagal. **Indikator list view** kini juga ada: penanda hanya dipasang pada
baris `INCONSISTENT` berbukti kuat dengan nama utuh, dan ia berada di DOM halaman (bukan di
shadow root) karena yang ditandai adalah baris milik Gmail. **Popup** juga ada: ia tidak menganalisis sendiri melainkan
meminta isi panel yang sama ke content script lewat pesan runtime (`lib/messaging.ts`),
sehingga analisisnya identik dengan panel halaman; tombolnya membuka halaman header dengan
mendorong menu Gmail, dan bila itemnya tidak dikenali pada bahasa pengguna, popup menuliskan
langkah manualnya. Isi panel dapat disalin lewat tombol "Copy report", dan footer memuat
`pslVersion` + `pslUpdatedAt` sesuai bagian 6.6.

**Mode diagnostik** sudah ada, dan isinya lebih luas daripada daftar di atas — bukan karena
rencananya berubah, melainkan karena seluruh nilai yang disebut di situ sudah dihitung engine
sejak awal dan tidak satu pun punya jalur ke DOM. Bagian ini yang membukanya, dan yang
dilaporkannya adalah:

| Nilai | Asalnya | Catatan |
|---|---|---|
| `state`, `confidence` | `Verdict` | Pengguna melihat "menentang · kuat" per bukti, tetapi tidak pernah tahu apakah putusannya `HIGH` atau `MEDIUM` |
| `gate.passed`, `gate.claim`, `gate.reason` | `Verdict.gate` | Ketujuh `ClaimKind` dan kelima `GateReason`; pembedaan `no_identity_claim` dari `personal_name_on_personal_domain` dibuat justru untuk bagian ini (lihat `evidence/gate.ts`) |
| seluruh baris `trace` | `Verdict.trace` | Baris yang menang ditandai, karena `classify` berhenti di situ |
| `algorithmVersion`, `pslVersion`, `provenance` | `Verdict`, `EmailIdentity` | Versi PSL berlaku untuk hostname yang benar-benar diurai |
| `selectorUsed`, catatan adapter | `packages/adapters` | Selector yang benar-benar menghasilkan pengirim |
| setiap bukti: `code`, `polarity`, `strength`, `tier`, `args`, `trace` | `Verdict.evidence` | Termasuk bukti `neutral`, yang panel biasa buang seluruhnya |

Cara membukanya: `Alt+Shift+D`, atau tombol kecil **diagnostik** di kepala panel. Modenya
**tidak** mengubah penilaian apa pun — ia mengganti bagian tengah kartu, sementara kepala
kartu, medan identitas, dan disclaimer tetap sama. Ia juga tidak disimpan ke storage dan tidak
bertahan antar pemuatan halaman: bagian ini menyajikan istilah internal dan bukti mentah, dan
keadaan yang menempel berarti pengguna dapat menemukannya aktif tanpa pernah memintanya.

Yang **dari mode ini, dan disebutkan supaya tidak diduga**: `notes` adapter ikut ditampilkan
sebagai bagian "Catatan adapter", lengkap dengan keadaan kosongnya — "tidak ada catatan" dan
"catatan tidak ditampilkan" adalah dua hal yang berbeda, dan membedakan keduanya justru fungsi
mode ini. Ia berguna justru ketika selector gagal membaca nama, dan kegagalan itu sudah terlihat
dari `selectorUsed`.

Yang **belum**: i18n. Kalimatnya baru tersedia dalam bahasa Indonesia, dan itu disengaja —
menerjemahkan ke bahasa yang belum ada penggunanya menghasilkan teks yang tidak pernah
dibaca siapa pun, dan teks terjemahan yang tidak pernah dibaca akan menyimpang tanpa ada
yang menyadarinya. Syaratnya sudah dipenuhi sejak awal: engine tidak memuat satu pun kalimat
jadi, sehingga saat bahasa kedua dibutuhkan, hanya `packages/presentation` yang berubah.

---

## 10. Performa & privasi

- `MutationObserver` + debounce + `requestIdleCallback`; hanya analisis baris terlihat
  (`IntersectionObserver`). Jangan blokir main thread Gmail.
- Cache di `chrome.storage.session`, LRU ~500 entri.
  Key = `hash(displayName | from | replyTo | authResults | provenance | algorithmVersion | pslVersion)`.
  `algorithmVersion` **wajib** ada di key, jika tidak hasil lama menghantui setelah update.
- Permission minimal: `host_permissions` hanya `https://mail.google.com/*`.
  Tidak ada `<all_urls>`, tidak ada `tabs`, tidak ada `webRequest`.
- Multi-akun: dukung `u/0`, `u/1`, `u/2`, dst — bukan hanya `u/0`.

**Status implementasi.** `MutationObserver` dengan debounce 400 ms dan `requestIdleCallback`
sudah dipakai, sesuai butir pertama. Permission minimal sudah, dan dijaga test yang menolak
`<all_urls>`, `tabs`, `webRequest`, `cookies`, serta `history`. Multi-akun sudah: pencocokan
host maupun pengenalan thread tidak membedakan nomor `u/N`.

Yang **belum** adalah `IntersectionObserver` dan cache `storage.session`, dan sekarang alasan
menundanya sudah habis: indikator list view (§9) menilai seluruh baris pada setiap perubahan
DOM, yaitu persis keadaan yang semula disebut sebagai syarat agar keduanya bermakna. Keduanya
kini terdaftar di §13.1 sebagai pekerjaan berikutnya, beserta permission `storage` yang
menyertainya — dan permission itu baru diminta bersama kodenya, bukan lebih dulu.

---

## 11. Testing & release gate

Struktur corpus (yang benar-benar dibangun):

```
tools/corpus/fixtures/
  legit.json        172 kasus  (fokus utama)
  suspicious.json   146 kasus  (dipadankan per kategori)
  edge.json          56 kasus  (nama kosong, milis, CJK/Arab/Devanagari, token generik)
  adversarial.json   18 kasus  (ditulis tangan untuk menyerang rule lookalike)
  realworld.json      8 kasus  (pola serangan yang dilaporkan pengguna, plus varian sahnya)
  coverage.json       4 kasus  (dituntut test kelengkapan katalog; lihat catatan di bawah)
```

Keenam berkas itu berjumlah **404 kasus** — angka yang dikutip §13, README, dan laporan corpus.

Kategori wajib: personal, corporate, freemail, nama tunggal Indonesia, nama terbalik, inisial, ESP,
alias, mailing list, support/billing, typo domain, lookalike, homoglyph Unicode, punycode,
subdomain spoofing, subdomain sah, random local-part, CJK/Arab/Devanagari, Reply-To mismatch,
kombinasi SPF/DKIM/DMARC.

`adversarial.json` lahir dari temuan implementasi dan ikut di-gate. Isinya pola **sah** yang secara
struktural identik dengan typosquat: domain pribadi yang berbeda satu huruf dari nama pemiliknya
(varian ejaan Indonesia seperti Rizky/Rizki), nama perusahaan yang menjadi salah satu kata di
domainnya sendiri, nama yang salah eja relatif terhadap domainnya sendiri, dan domain berupa akronim
institusi. Tanpa berkas ini, ketiga false positive yang ditemukan saat implementasi tidak akan
pernah terukur, karena semuanya berada di luar cakupan corpus awal.

`realworld.json` menyimpan pola serangan yang dilaporkan pengguna bersama varian sah yang paling
mirip dengannya. Berkas ini penting karena berisi satu fixture berlabel `unassessable` yang sengaja
dipakai untuk **mengunci batas Tier A/Tier B**: varian tanpa header Show original memang tidak dapat
dinilai, dan itu hasil yang benar.

`coverage.json` bukan kumpulan kasus yang dipilih manusia, melainkan hasil
`tools/corpus/tests/rule-coverage.test.ts`: setiap kali sebuah kode rule tidak pernah terpicu oleh
corpus mana pun, test itu menuntut satu fixture yang memicunya. Empat kasusnya menutup
`DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS` dan seluruh kelas domain `disposable`, yang sebelumnya tidak
terwakili sama sekali. Karena itu ia ikut di-gate: fixture yang lahir dari kelengkapan katalog sama
sahnya dengan fixture yang ditulis tangan.

**Release gate (precision-first):**

| Gate | Ambang | Hasil terukur |
|---|---|---|
| Precision `INCONSISTENT`+HIGH | **≥ 95%** | **100%** |
| `nagRate` visible (state `INCONSISTENT` pada non-suspicious) | **≤ 3%** | **0,0%** |
| Recall (suspicious) | sekunder | 76,4% |
| `nagRate` wide (sinyal apa pun, termasuk tak terlihat) | dipantau | 11,7% |

Angka di tabel ini adalah keluaran `pnpm corpus` pada saat dokumen ini diperbarui; yang harus
dipercaya kalau keduanya berbeda adalah keluarannya, dan `docs/USAGE.md` memuat contoh
keluaran yang sama. Nilai sebelumnya (76,1% dan 11,8%) tertinggal dari corpus yang sudah
berubah.

Artifact: laporan markdown otomatis di `tools/corpus/reports/corpus-report.md`, memuat confusion
matrix, rincian per kategori, dan daftar lengkap false positive serta false negative.

Property tests (semuanya terimplementasi). Yang dapat dihitung mesin adalah keluaran `pnpm test`:
**458 test di 27 berkas** pada saat dokumen ini diperbarui, 2 di antaranya di-skip karena
menunggu satu snapshot DOM yang belum dapat diambil (§12):

- `normalize(normalize(x)) === normalize(x)` untuk seluruh sampel sulit
- `skeleton(skeleton(x)) === skeleton(x)`
- `normalize` invarian terhadap kapitalisasi/separator/diakritik ekuivalen
- setiap entri tabel confusable idempoten dan bersumber non-ASCII
- Engine deterministik: input sama → `Verdict` deep-equal, tanpa jam/RNG
- Seluruh input tidak dapat dipercaya (5.000 karakter, NUL, `a@b@c@d`, alamat tanpa domain,
  IP literal, punycode rusak) tidak pernah melempar
- Test arsitektur: `packages/core` tidak boleh memuat DOM, `chrome.*`, jaringan, jam, RNG, atau
  `eval` — ditegakkan pada tingkat source, bukan sekadar dijanjikan di dokumen

### Klaim yang diperiksa mesin

Angka-angka di atas — jumlah test, jumlah berkasnya, jumlah kasus corpus termasuk rincian per
berkas fixture — tidak lagi bergantung pada ingatan orang yang memperbarui dokumen.
`pnpm docs:claims` membandingkan setiap angka yang dikutip dokumentasi dengan laporan test yang
benar-benar berjalan dan dengan isi `tools/corpus/fixtures`. Klaim keadaan ikut diperiksa dengan
cara yang sama: README direktori snapshot tidak boleh menyatakan dirinya kosong selama berkasnya
ada.

Pemeriksa itu **sengaja bukan** test vitest. Menambahkan test untuk memeriksa jumlah test akan
mengubah jumlah yang sedang diperiksa, sehingga penjaganya gagal pada dirinya sendiri walaupun
angkanya benar. Karena itu ia berdiri di luar suite: `pnpm test:report` menulis laporan JSON satu
kali, dan CI menjalankan `pnpm docs:claims` setelahnya. Aturan yang tidak lagi menemukan klaim
apa pun juga dilaporkan, supaya "sudah diperiksa" dan "tidak ada yang diperiksa" tidak pernah
tampak sama.

Angka yang salah pernah benar-benar hidup di sini: tiga jumlah test yang berbeda berdiri di tiga
berkas selama dua rilis, dan direktori snapshot menyatakan dirinya kosong padahal tiga berkas
sudah ada di dalamnya. Keduanya lolos dari 156 pemeriksaan tautan dan path yang sudah ada, karena
tautan dan path memang benar — yang salah angkanya.

Prinsip yang sama dipakai untuk dua klaim lain di luar dokumentasi. `pnpm changelog:check`
membandingkan **setiap** baris indeks `CHANGELOG.md` dengan tag yang benar-benar ada, jenis tag
beranotasi atau ringan, versi `package.json` pada tag itu, dan `ALGORITHM_VERSION` yang disebut
pesan tagnya — `release-check` di CI hanya memeriksa tag yang baru didorong, sehingga baris lama
tidak pernah diperiksa siapa pun setelah rilisnya lewat. `pnpm repo:settings` menyatakan setelan
repositori yang diandalkan aliran rilis (branch dihapus otomatis setelah merge, squash merge tetap
menyala), karena setelan itu hidup di luar repositori: tidak ada berkas yang memuatnya dan tidak
ada diff yang menunjukkannya berubah.

Satu batas yang disebut apa adanya: `repo:settings` **tidak berjalan di CI**. Endpoint setelan
repositori tidak memuat medan itu untuk pemanggil tanpa kredensial, dan `GITHUB_TOKEN` tidak punya
izin `administration`. Karena itu ia adalah pemeriksaan pemelihara, dan ketika tidak dapat
memeriksa ia mengatakannya lalu keluar dengan kode 1 — bukan lulus seolah-olah sudah memeriksa.

---

## 12. Struktur repo

Yang **sudah ada**:

```
packages/core/                    engine murni, tanpa DOM, tanpa chrome.*
  src/normalize/                  skeleton TR39, punycode RFC 3492, fold, deteksi aksara
  src/domain/                     algoritma PSL, taksonomi 6 kelas, penguraian alamat
  src/name/                       tokenisasi, klaim domain, klaim organisasi
  src/similarity/                 Jaro-Winkler, Damerau-Levenshtein, LCS, aturan ambang
  src/evidence/                   pencocokan token, gate, katalog rule, parser auth
  src/classification/             decision table
  src/data/                       psl + confusables (generated); freemail, esp, disposable, milis, token
  tests/                          unit, property, end-to-end, arsitektur
packages/presentation/            code + args dari engine menjadi kalimat dan struktur
                                  tampilan; dipakai konsol, contoh, dan panel ekstensi
tools/corpus/                     fixture berlabel + harness CLI + laporan + test cakupan
tools/gen-psl/                    generator build-time dari daftar PSL resmi
tools/gen-unicode/                generator build-time dari confusables.txt
examples/                         contoh pemakaian yang dapat dijalankan
docs/                             DESIGN.md, USAGE.md, RULES.md, FIREFOX.md, PRIVACY.md, CHANGELOG-0.x.md
```

Struktur lengkapnya:

```
apps/extension/                   ekstensi Firefox (WXT): content script + panel + popup
  src/entrypoints/gmail.content.ts  perekat: kapan memindai, kapan menggambar
  src/entrypoints/popup/            popup: isi panel yang sama + tombol header lengkap
  src/lib/view.ts                   jenis halaman: thread, list, show-original, lain
  src/lib/scan.ts                   adapter + engine menjadi temuan siap tampil
  src/lib/panel-model.ts            isi panel sebagai data, tanpa DOM
  src/lib/panel-view.ts             menuangkan model ke elemen
  src/lib/messaging.ts              kontrak pesan popup <-> content script
  src/lib/clipboard.ts              menyalin laporan, dengan fallback execCommand
  src/lib/panel.css                 gaya panel
  src/lib/popup.css                 penyesuaian kartu untuk jendela popup
  tests/                            75 test tanpa browser
```

`packages/adapters`, `tools/console`, dan ekstensinya sudah ada. Jadi **tidak ada lagi paket
yang belum dibuat**. Satu kandidat selector masih disebut apa adanya sebagai hipotesis:
`VIA_ELEMENT_CLASSES` di `packages/adapters/src/gmail.ts` belum pernah cocok pada probe nyata mana
pun, dan catatan di berkas itu menjelaskan mengapa klaim lama tentangnya dicabut alih-alih
dibiarkan tampak terverifikasi.

Dua batas cakupan ekstensi yang disengaja, dan keduanya dijelaskan di
[`FIREFOX.md`](FIREFOX.md#ekstensi-firefox): panel hanya muncul pada thread yang sedang
dibuka, dan belum ada cache. Yang pertama karena indikator di list view menuntut presisi yang
belum terbukti; yang kedua karena cache baru bermakna bersama list view, dan meminta permission
`storage` sebelum ia dipakai akan membuat tinjauan izin menanyakan sesuatu yang belum dapat
dijelaskan. **Mode diagnostik tidak lagi termasuk batas ini** — ia sudah ada sejak 0.5.0 dan
isinya diuraikan di §9.

Satu batas yang **bukan** pilihan melainkan syarat kebenaran: panel hanya membaca pesan di
dalam percakapan yang terbuka, satu pengirim per pesan. Alasannya ada di bagian 12.1 butir 5,
dan akibat mengabaikannya bukan panel kosong melainkan panel yang salah dengan yakin.

Adapter **tidak punya** fungsi `probe()` dan tidak pernah menghasilkan `confidence` — keduanya
pernah ditulis di sini seolah kode, dan kodenya tidak pernah ada. Yang benar-benar ada adalah
dua laporan di `packages/adapters/src/types.ts`: `scanGmailInbox(doc, options)` mengembalikan
`AdapterReport` (`matched`, `selectorUsed`, `probes`, `senders`, `gmailOwnWarning`, `notes`),
dan `scanGmailShowOriginal(doc)` mengembalikan `HeaderReport` (`matched`, `probes`, `headers`,
`identity`, `notes`). Yang mendekati "probe" adalah skrip konsol
`tools/console/dist/sender-check.probe.js`, yang memang menjalankan pembacaan pada halaman
sungguhan dan mencetak `probes`-nya; `confidence` memang ada, tetapi milik `Verdict` di engine,
bukan milik adapter. Bila semua selector gagal, extension **no-op + diagnostic log** — jangan
diam-diam tidak berjalan. Untuk snapshot DOM,
`packages/adapters/tests/gmail-snapshots.test.ts` mengurai `outerHTML` sungguhan lewat `linkedom`;
**tiga dari empat berkasnya sudah diambil** — `list-row.html`, `thread-open.html`, dan
`show-original.html` — sementara `thread-no-name.html` belum dapat diambil dan alasannya dicatat di
[`tools/corpus/dom-snapshots/README.md`](../tools/corpus/dom-snapshots/README.md).

Satu hal yang perlu dicatat apa adanya, karena rumusan sebelumnya menyesatkan: snapshot yang
tersimpan **tidak** gagal ketika Gmail mengubah DOM-nya — ia gagal ketika adapter berhenti cocok
dengan markup yang sudah terekam. Canary yang benar-benar hidup adalah `sender-check.probe.js`
yang dijalankan di halaman sungguhan, dan itulah yang memberi tahu bahwa Gmail sudah berubah;
snapshot adalah regression fixture dan tempat selector diverifikasi, bukan penjaga terhadap
perubahan Gmail.

### 12.1 Kontrak adapter: hal-hal yang mudah salah dan berakibat serius

1. **`gmailViaHint` hanya boleh diisi dari indikator "via" di tampilan pesan, BUKAN dari kolom
   "dikirim oleh" pada halaman Show original.** Keduanya berbeda arti. "Via" muncul ketika domain
   Return-Path berbeda dari domain From, dan itulah makna "dikirim atas nama" yang dipakai engine
   untuk menekan mismatch Return-Path. Kolom "dikirim oleh" pada Show original adalah domain
   Return-Path itu sendiri, yang pada pengiriman normal **sama** dengan domain From. Menyamakan
   keduanya akan mengisi `gmailViaHint` pada hampir semua email dan menekan sinyal Tier B secara
   diam-diam.
2. **Kolom "ditandatangani oleh" adalah domain `d=` pada tanda tangan DKIM.** Ia bukan identitas
   pengirim, dan tidak boleh dipakai sebagai dasar apa pun. Pada kasus phishing yang dilaporkan,
   nilainya `mngl.in` — sama dengan domain From — sehingga seluruh rantai autentikasi konsisten
   dan justru tidak memberi sinyal apa pun.
3. **`gmailOwnWarning` tidak boleh dinyalakan hanya karena ada elemen `[role="alert"]`.** Gmail
   memakai `role="alert"` untuk banyak hal di luar peringatan keamanan, sehingga keberadaan
   elemennya saja membuat flag ini menyala pada halaman yang tidak memperingatkan apa pun — dan
   rule `GMAIL_OWN_WARNING_PRESENT` memberi tahu pengguna sesuatu yang tidak benar. Isi teksnya
   harus diperiksa lebih dulu (`looksLikeGmailWarning`). Probe tetap melaporkan jumlah elemen
   yang cocok, tetapi `contributed` hanya `true` bila teks peringatannya benar-benar ada.
4. **Penanda "via" dibaca dari dalam baris pesan, bukan dengan menaiki leluhur elemen pengirim.**
   Menaiki `parentElement` tidak dapat mencapai elemen bersaudara, dan baris pesan hampir selalu
   lebih panjang daripada batas teks yang dipakai versi awal; dua hal itu membuat pembacaan lama
   tidak pernah berhasil. Pencarian **ke dalam** baris memperbaiki keduanya, dan arah itu benar
   terlepas dari nama kelas penandanya.
   **Yang belum terverifikasi justru kelasnya.** `span.zx` dipakai sebagai kandidat pertama, tetapi
   pada setiap probe nyata yang tercatat selector itu melaporkan 0 kecocokan, dan tidak ada baris
   ber-"via" yang pernah ditemukan pada tampilan inbox maupun Promotions. Jadi pembacaan "via"
   adalah **best-effort yang belum pernah terbukti bekerja**, bukan sinyal Tier A yang dapat
   diandalkan. Bila Gmail tidak merender penanda itu sama sekali, hasilnya `undefined` dan tidak ada
   rule yang terpicu — itu keadaan yang benar, bukan bug.

5. **Panel hanya boleh menilai pengirim di dalam percakapan yang sedang terbuka, satu per
   pesan — dan bila batas itu tidak dapat ditegakkan, panel tidak muncul.** Dokumen Gmail
   memuat lebih dari satu elemen beralamat: chip penerima ("to saya"), alamat penerima pada
   baris daftar inbox, avatar akun, dan hovercard sama-sama membawa
   `email`/`data-hovercard-id`, dan tidak satu pun pengirim pesan yang dibaca. Karena panel
   memilih temuan terberat (`pickPrimary`), satu calon yang salah dapat menang atas pengirim
   yang benar dan bertahan untuk **setiap** email yang dibuka. Karena itu `scanGmailInbox`
   menerima `scope: 'conversation'` — batas percakapan dari `[data-message-id]`, dan di
   dalam tiap pesan hanya elemen beralamat **pertama** (baris pengirim mendahului baris
   penerima). `scope: 'page'` tetap default untuk skrip konsol, yang memang harus membaca
   seluruh halaman.

   Versi pertama lingkup ini jatuh kembali ke seluruh halaman bila penanda pesan tidak
   ditemukan, dengan alasan "kegagalan mengenali bentuk halaman tidak boleh berarti panel
   kosong". Probe nyata membuktikan alasan itu salah: pada halaman yang URL-nya menunjuk
   sebuah thread, DOM dapat berisi daftar inbox — 103 elemen pengirim pada satu probe —
   sehingga jatuh kembali berarti panel menjelaskan pengirim mana pun yang temuannya paling
   berat. **Panel kosong lebih baik daripada panel yang salah**; itu sudah aturan di
   `apps/extension/src/lib/scan.ts`, dan sekarang ditegakkan di adapter juga.

6. **Display name di list view dipotong Gmail, dan yang dipotong itu bukan nama yang dinilai di
   thread.** Pada satu probe inbox 100 baris, nama yang melewati batas berhenti tepat di 20
   karakter dengan titik di akhir — `"Korea Investment An."` dan `"Bibit 'info at bibi."` — sementara
   nama 19 karakter (`"Alpha Capital Group"`) utuh. Karena `notes` tidak memuat satu pun catatan
   "dibaca dari teks", pemotongan itu ada di **atribut `name` Gmail sendiri**, bukan di adapter.
   Akibatnya bukan sekadar kosmetik: token yang seharusnya dibandingkan bisa hilang, dan indikator
   list view yang kini dibangun (§9) akan menilai nama yang berbeda dari yang dinilai panel saat
   thread dibuka — pengirim yang sama dapat memperoleh dua state berbeda. Perbedaan itu harus
   diputuskan sebelum indikatornya dikerjakan. `list-row.html` menyimpan salah satu contohnya;
   `thread-open.html` belum dapat menjawab apakah thread menampilkan nama penuh, karena nama
   pengirim pada berkas itu pendek.

   **Keputusan: indikator list view melewatkan nama yang terpotong.** Penanda hanya dipasang
   bila nama di daftar utuh, sehingga kegagalannya selalu ke arah "tidak menampilkan" —
   bukan "menampilkan penilaian yang salah". Itu pilihan yang sama dengan presisi-pertama
   di §9 dan dengan aturan "panel kosong lebih baik daripada panel yang salah" di butir 5.
   Tanda potongnya sendiri adalah heuristik yang sengaja sempit: nama tepat 20 karakter yang
   berakhir titik — pola yang muncul pada kedua contoh di atas — sehingga ia juga gagal ke
   arah yang aman. Penerapannya ada di `apps/extension/src/lib/scan.ts`
   (`isTruncatedName`), dan testnya mengunci kedua contoh asli itu.

Pemetaan yang benar dari halaman Show original ke `EmailIdentity`:

| Kolom Show original | Field | Catatan |
|---|---|---|
| `dari:` | `displayName` + `fromAddress` | Pisahkan display name dari alamat |
| `balas ke:` | `replyTo` | |
| `dikirim oleh:` | `returnPath` | Domain Return-Path, bukan `gmailViaHint` |
| `Authentication-Results` | `authenticationResults` | Nilai header apa adanya |
| `ditandatangani oleh:` | — | Turunan dari `d=`, jangan dipakai |
| indikator "via" di tampilan pesan | `gmailViaHint` | Hanya dari sini |

---

## 13. Roadmap

| Phase | Isi | Status |
|---|---|---|
| 0 | Spike DOM Gmail (list / thread / tanpa-nama / `via` / `view=om`) | sebagian — list, thread, dan `view=om` sudah tersimpan sebagai snapshot di `tools/corpus/dom-snapshots/`; tanpa-nama belum dapat diambil, dan penanda `via` masih belum pernah teramati |
| 1 | Core parser + normalization (TR39 skeleton, punycode RFC 3492, penjaga kamus) | **selesai** |
| 2 | PSL + taksonomi 6 kelas domain | **selesai** |
| 3 | Name/token analyzer + identity-claim gate (§5) | **selesai** |
| 4 | Similarity engine + aturan panjang token (§7) | **selesai** |
| 5 | Evidence engine + decision table (deterministik, traceable) | **selesai** |
| 6 | Classification + corpus harness CLI + confusion matrix | **selesai** |
| 7 | Gmail adapter + UI mode tenang | sebagian — adapter, skrip konsol, panel ekstensi, popup, dan **indikator list view** ada; **selectornya sudah diverifikasi pada Gmail sungguhan** dan tiga di antaranya kini dikunci snapshot (list view, thread terbuka, Show original; satu akun, satu varian antarmuka). Yang belum: indikator list view **belum pernah dilihat pada halaman sungguhan** — ia memakai selector baris yang sama dengan yang sudah terverifikasi, tetapi pemasangan penandanya sendiri belum |
| 8 | Perluas corpus + tuning precision-first | sebagian — 404 kasus, gate lulus |
| 9 | Tier B: parse halaman "Show original" | sebagian — rule dan adapter halaman lengkap dan teruji, **dan sudah diverifikasi pada halaman sungguhan** (blok header mentah di `pre.raw_message_text`, 23 header, termasuk `Reply-To`); snapshot `show-original.html` sudah tersimpan, sehingga assertion Tier B berjalan pada markup nyata |
| 10 | Performa, i18n, privacy policy, packaging & release | sebagian — **halaman privasi sudah ada** di [`docs/PRIVACY.md`](PRIVACY.md) beserta apa yang menegakkannya; yang belum: cache sesi (§10), i18n EN (§9), dan packaging & publikasi |

Perbedaan dari urutan awal: corpus & decision table **sebelum** UI; header auth Tier B **setelah**
core terbukti presisi, karena tuning rule di atas sinyal yang cakupannya sebagian kecil email
menghasilkan threshold yang salah.

Phase 7 sengaja dinyatakan **sebagian**, bukan selesai, walaupun kodenya sudah ada dan jalurnya
sudah terbukti pada Gmail sungguhan. Indikator list view kini **sudah ditulis**, termasuk
keputusan pemotongan namanya (§12.1 butir 6), tetapi ia belum pernah dilihat berjalan pada
halaman Gmail sungguhan — dan karena itu ia belum dihitung selesai.

### 13.1 Yang perlu dikerjakan selanjutnya

Daftar ini mengumpulkan pekerjaan yang selama ini tersebar sebagai catatan "belum" di §9,
§10, §12.1, §13, dan §15.5. Ia sengaja **tidak** mengulang alasannya: setiap baris menunjuk bagian
yang menjelaskannya, supaya tidak ada dua salinan yang bisa menyimpang. Kolom "Menunggu" bukan
prioritas melainkan **ketergantungan** — dua baris di antaranya menunggu pengamatan yang belum
ada, dan keputusan yang menunggu indikator list view sudah diambil (§12.1 butir 6).

| Pekerjaan | Sifat | Menunggu | Rujukan |
|---|---|---|---|
| Verifikasi penanda "via" pada halaman yang benar-benar menampilkannya | pengamatan | sesi Gmail yang menampilkan `via <domain>` | §12.1 butir 4 |
| Ambil `thread-no-name.html` bila pengirim tanpa nama ditemukan | pengamatan | halaman yang memuatnya; bentuk yang benar: teks elemen = alamat | [`dom-snapshots/README.md`](../tools/corpus/dom-snapshots/README.md) |
| Cache `chrome.storage.session`, LRU ~500, beserta permission `storage` | kode | — | §10 |
| `IntersectionObserver` untuk baris yang terlihat | kode | — | §10 |
| i18n EN — hanya `packages/presentation` yang berubah | kode | ada pengguna berbahasa Inggris | §9 |
| Packaging dan publikasi ke AMO | rilis | — | §13 Phase 10 |
| Perluas `adversarial.json` lebih dulu, bukan `suspicious.json` | kualitas | — | §15.5 butir 1 |
| Daftar brand kurasi dengan lisensi yang jelas | kualitas | lisensi yang jelas | §15.4, §15.5 butir 2 |
| Naikkan recall setelah presisi bertahan 100% dua putaran | kualitas | dua putaran perubahan berturut-turut | §15.5 butir 3 |
| Rekam ulang `show-original.html` dari `div[role="main"] pre` bila wadah spesifik ingin ikut teruji | fixture | — | §12 |

Seluruh baris di atas berada di luar `packages/core`. Engine, corpus, dan decision table tidak
memiliki pekerjaan yang tersisa selain cakupan recall, dan batasan yang diterima sadar sudah
didaftarkan di §15.4 alih-alih disembunyikan di sini.

---

## 14. Risiko terbuka

| Risiko | Mitigasi |
|---|---|
| Gmail mengubah DOM / class name | `sender-check.probe.js` di halaman sungguhan + fallback selector + snapshot sebagai regression fixture; degrade ke no-op |
| Precision `INCONSISTENT` jeblok di data nyata | Gate §5 + gate precision di CI |
| Perubahan PSL membuat hasil lama tak konsisten | `pslVersion` di cache key, script build terpisah |
| User over-trust pada state `CONSISTENT` | Disclaimer permanen di semua state |
| Store review mempertanyakan akses metadata email | Halaman privasi eksplisit + permission minimal |

---

## 15. Catatan implementasi Phase 1–6

Phase 1–6 **selesai**. `packages/core` berisi engine lengkap, 400 fixture berlabel, 156 test, dan
laporan corpus otomatis. Belum ada adapter maupun UI.

Angka-angka di bagian ini adalah keadaan **pada saat Phase 1–6 selesai**, dan tidak diperbarui
setiap kali pekerjaan berjalan: ia catatan sejarah, bukan status. Jumlah yang berlaku sekarang ada
di §11 — corpus **404 kasus** dan **458 test**.

### 15.1 Kasus nyata yang lolos, dan perbaikannya

Laporan pengguna: sebuah email phishing yang **tidak** diberi peringatan oleh webmail, dengan
`Rise <no-reply@mngl.in>` dan `Reply-To: support@riseworks.digital`.

Saat fixture-nya dijalankan, engine mengembalikan **`UNASSESSABLE`** dengan alasan
`personal_name_on_personal_domain`. Kegagalan total, dan penyebabnya struktural: gate G1–G6 hanya
melihat domain From, sedangkan domain From (`mngl.in`) memang tidak punya hubungan apa pun dengan
"Rise" — sehingga tidak ada satu pun kondisi gate yang terpenuhi. Seluruh informasi yang membongkar
penipuan itu berada di header `Reply-To`, yang tidak pernah dibaca gate.

Perbaikannya adalah **G7** (§5) dan rule **`REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`** (§7), dengan
konsekuensi teknis: `GateInput` diperluas agar menerima `ResolvedIdentity` utuh, bukan hanya bagian
From. Sebelumnya gate secara struktural tidak mampu melihat Tier B sama sekali.

Kasus ini juga menegaskan dua keputusan desain yang sudah ada:

- **Authentication PASS membuktikan domain, bukan display name.** SPF, DKIM, dan DMARC semuanya
  lulus untuk `mngl.in`, dan itu memang benar — `mngl.in` menandatangani pesannya sendiri. Tidak ada
  satu pun hasil autentikasi yang bertentangan, sehingga webmail tidak punya alasan menampilkan
  peringatan. Deteksi harus datang dari hubungan nama↔alamat, bukan dari autentikasi.
- **Tier B bukan pelengkap, melainkan satu-satunya sumber sinyal untuk kelas serangan ini.**
  Fixture `unassessable-realworld-003` mengunci batas itu secara eksplisit: varian Tier A yang sama
  tetap `UNASSESSABLE`, dan itu hasil yang benar. Tanpa header Show original, tidak ada dasar untuk
  menilai — dan engine tidak boleh mengarang dasar.

### 15.2 Bug yang ditemukan dan diperbaiki

Empat di antaranya kesalahan nyata yang tidak akan terlihat tanpa test:

| Temuan | Akar masalah | Perbaikan |
|---|---|---|
| Diakritik tidak pernah terhapus | `normalizeForComparison` memakai **NFKC** lebih dulu, dan NFKC **menyusun** alih-alih mengurai, sehingga `é` tetap `é` dan tidak ada tanda yang bisa dibuang | Urutan menjadi NFD → buang tanda → NFKC |
| `goog\u200Ble` tidak pernah cocok dengan `google` | Karakter tak terlihat tidak dibuang pada tahap normalisasi, sehingga tokenizer memecahnya menjadi dua token | Buang `\p{Default_Ignorable_Code_Point}` dan `\p{Cf}` |
| Pesan sah ditekan menjadi `UNCLEAR` | `TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL` ikut memeriksa target `address-compact`, yaitu gabungan local-part dan domain. Akibatnya token yang berada di **local-part** — hal yang sepenuhnya normal — dilaporkan "tertanam di domain" | Target dibatasi pada label registrable saja |
| Kandidat `smithj` tidak pernah dihasilkan | `${last}${lastInitial}` menghasilkan `smiths`, bentuk yang tidak pernah dipakai orang | Menjadi `${last}${firstInitial}` |

### 15.3 False positive yang ditemukan probe adversarial

Ketiganya berasal dari kasus yang **tidak ada** di corpus awal, dan ketiganya diselesaikan dengan
memperbaiki logika, bukan dengan menurunkan ambang:

1. `"Rizky" <hello@rizki.id>` — domain pribadi berbeda satu huruf dari nama pemiliknya.
   Diperbaiki dengan membedakan near-miss yang mengubah panjang (padded typosquat) dari yang tidak
   (varian ejaan).
2. `"Rise Security" <info@rise-security-hq.com>` — seluruh kata display name dijelaskan oleh domain
   miliknya sendiri. Diperbaiki dengan syarat "ada komponen domain yang tidak dijelaskan".
3. `"Warung Digital" <info@xn--warung-gva.id>` — label IDN yang bentuk Latinnya memang berbeda
   panjang dari namanya. Diperbaiki dengan melewati kanal near-miss untuk label non-ASCII; kanal yang
   benar untuk label semacam itu adalah homoglyph.

### 15.4 Batasan yang diketahui dan diterima

Ini disengaja, bukan cacat yang belum sempat diperbaiki. Semuanya berakar pada satu hal yang sama:
**tanpa database brand, "Gojek" dan "Rizky" tidak dapat dibedakan secara struktural.**

| Kasus | Hasil engine | Kenapa dibiarkan |
|---|---|---|
| `"KlikBCA" <cs@bca-klik.com>` | `CONSISTENT`/MEDIUM | Domain memang memuat "klik" dan "bca". Keduanya juga kata yang membentuk nama produk bank yang sah, dan tanpa pengetahuan merek tidak ada cara memisahkannya |
| `"BNI" <cs@bnl.co.id>`, `"Gojek" <cs@gojeg.com>` | `UNCLEAR`/MEDIUM | Substitusi huruf pada panjang yang sama sama mungkinnya merupakan varian ejaan nama orang Indonesia (Rizky/Rizki, Yusuf/Yusup) |
| `"Apple" <support@apple-verify.com>` | `CONSISTENT`/MEDIUM | "verify" adalah kata generik dan display name tidak menjelaskannya, tetapi "Apple" memang ada di domainnya. Hanya pengetahuan merek yang dapat memutuskan |
| `"Finance Department" <x9182kzq@corp-payments.xyz>` | `UNASSESSABLE` | Display name hanya berisi peran generik. Konsisten dengan keputusan bahwa `"Admin" <admin@example.com>` juga tidak dinilai. Menilainya akan membuka kembali kebisingan yang sudah ditutup gate |
| Kombinasi auth-only (DMARC gagal tanpa masalah nama↔alamat) | `UNCLEAR` | Mengautentikasi domain, bukan display name. Ini memang di luar cakupan alat |

Seluruh baris di atas muncul lengkap di laporan corpus sebagai false positive atau false negative,
sehingga dapat ditinjau ulang ketika cakupan dinaikkan. Menyembunyikannya akan membuat metrik terlihat
lebih baik daripada kenyataannya.

### 15.5 Cara menaikkan cakupan berikutnya

1. **Perluas `adversarial.json` lebih dulu**, bukan `suspicious.json`. Setiap kali sebuah rule
   ditambahkan, tulis kasus sah yang paling mungkin dipicunya. Ketiga false positive di atas semuanya
   ditemukan dengan cara ini, dan tidak satu pun oleh corpus umum.
2. **Daftar brand kurasi berlisensi jelas**, bila nanti diizinkan. Itu menyelesaikan baris 1–3 pada
   tabel 15.4 sekaligus, dan merupakan satu-satunya jalan keluar yang nyata.
3. **Naikkan recall hanya setelah precision bertahan 100%** pada dua putaran perubahan berturut-turut.

