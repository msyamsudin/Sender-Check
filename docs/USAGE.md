# Panduan penggunaan

Dokumen ini menjelaskan cara memakai Sender-Check: dari menjalankan proyek, memakai engine sebagai
pustaka, memahami arti keluarannya, sampai memecahkan masalah yang umum.

Kalau kamu baru pertama kali membuka repositori ini, mulai dari
[`README.md`](../README.md). Untuk arti setiap kode bukti, lihat [`RULES.md`](RULES.md). Untuk
alasan di balik setiap keputusan desain, lihat [`DESIGN.md`](DESIGN.md).

## Untuk siapa dokumen ini

Dua kelompok, dan penting untuk tahu di mana posisimu:

| Kalau kamu… | Mulai dari |
|---|---|
| Ingin memakai engine dari kode Node/TypeScript | [Memakai engine sebagai pustaka](#memakai-engine-sebagai-pustaka) |
| Ingin memakainya di Gmail lewat Firefox | [`FIREFOX.md`](FIREFOX.md) |
| Ingin berkontribusi pada rule atau fixture | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Ingin memasang ekstensi browser | Belum tersedia. Lihat [status ekstensi](#status-ekstensi-browser) |

## Prasyarat

| Kebutuhan | Versi | Kenapa |
|---|---|---|
| Node.js | ≥ 22.18 | Proyek menjalankan berkas `.ts` langsung tanpa build, memakai type stripping bawaan Node |
| pnpm | 11 | Workspace dan `allowBuilds` untuk esbuild |

Versi Node itu bukan pilihan gaya. Seluruh alat di `tools/` dan `examples/` dijalankan dengan
`node src/cli.ts` tanpa langkah kompilasi, dan itu hanya bekerja pada Node 22.18 ke atas.

## Instalasi

```bash
git clone https://github.com/msyamsudin/Sender-Check.git
cd Sender-Check
pnpm install
```

## Cek cepat

```bash
pnpm example
```

Perintah ini menganalisis sebelas contoh email dan mencetak hasilnya dalam bentuk yang dapat
dibaca. Ia adalah cara tercepat memahami cara kerja engine, dan sekaligus contoh nyata cara
menerjemahkan keluaran engine menjadi kalimat. Berkasnya ada di
[`examples/analyze-emails.ts`](../examples/analyze-emails.ts).

Cuplikan keluaran:

```
— Kasus nyata yang dilaporkan: identitas hanya diakui domain tujuan balasan.
⚠ INCONSISTENT (HIGH)
  Rise <no-reply@mngl.in>  reply-to: support@riseworks.digital
  dinilai: ya (reply_to_asserts_identity)
  bukti:
    [konteks/weak] display name mengikuti pola nama orang
    [menentang/strong] "rise" muncul di domain tujuan balasan "riseworks.digital",
                       tetapi tidak di domain pengirim "mngl.in"
    [menentang/medium] balasan diarahkan ke "riseworks.digital",
                       berbeda dari domain pengirim "mngl.in"

— Nama manusia pada alamat acak. Normal, dan sengaja tidak dinilai.
? UNASSESSABLE (LOW)
  Budi Santoso <x7k2@randomisp.co.id>
  dinilai: tidak (personal_name_on_personal_domain)
```

Perhatikan contoh kedua. `UNASSESSABLE` adalah hasil yang sah dan paling sering muncul, bukan
kegagalan. Itulah inti desainnya.

## Memakai engine sebagai pustaka

### Bentuk masukan

```ts
interface EmailIdentity {
  fromAddress: string;             // wajib
  displayName: string | null;      // wajib
  provenance?: 'dom-inbox' | 'dom-original';
  replyTo?: string;                // Tier B
  returnPath?: string;             // Tier B
  authenticationResults?: string;  // Tier B
  gmailViaHint?: string;           // Tier A
  gmailOwnWarning?: boolean;       // Tier A
}
```

| Medan | Wajib | Catatan |
|---|---|---|
| `fromAddress` | ya | Boleh dalam bentuk `"Nama <alamat@domain>"`; bagian alamatnya akan diambil |
| `displayName` | ya | `null` berarti webmail tidak menampilkan nama sama sekali. Berbeda dari string kosong |
| `provenance` | tidak | Diturunkan otomatis bila kosong. Lihat di bawah |
| `replyTo` | tidak | `undefined` berarti **tidak diketahui**, bukan "sama dengan From" |
| `returnPath` | tidak | Domain envelope sender, yaitu kolom "dikirim oleh" pada Show original |
| `authenticationResults` | tidak | Nilai header `Authentication-Results` apa adanya |
| `gmailViaHint` | tidak | **Hanya** dari indikator "via" di tampilan pesan. Baca peringatan di bawah |
| `gmailOwnWarning` | tidak | `true` bila webmail sendiri menampilkan peringatan pada pesan itu |

#### Bagaimana `provenance` ditentukan

Bila kamu tidak mengisinya, engine menurunkannya:

- ada salah satu dari `replyTo`, `returnPath`, `authenticationResults` → `'dom-original'`
- selain itu → `'dom-inbox'`

Turunan ini sengaja dipilih supaya data Tier B tidak pernah diam-diam diabaikan. Konsekuensinya
penting: **sinyal Tier B tidak pernah dipakai ketika `provenance` bernilai `'dom-inbox'`.** Jadi
kalau kamu ingin membandingkan perilaku dengan dan tanpa header lengkap, isi `provenance` secara
eksplisit.

```ts
import { resolveIdentity } from '@sender-check/core';

resolveIdentity({ displayName: 'A', fromAddress: 'a@b.com' }).provenance;
// 'dom-inbox'

resolveIdentity({ displayName: 'A', fromAddress: 'a@b.com', replyTo: 'c@d.com' }).provenance;
// 'dom-original'
```

### Keluaran

```ts
interface Verdict {
  state: 'CONSISTENT' | 'UNCLEAR' | 'INCONSISTENT' | 'UNASSESSABLE';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence: Evidence[];
  gate: { passed: boolean; claim: ClaimKind | null; reason: GateReason };
  trace: { row: number; condition: string; matched: boolean }[];
  algorithmVersion: string;
  pslVersion: string;
}

interface Evidence {
  code: RuleCode;
  polarity: 'supports_consistency' | 'supports_inconsistency' | 'neutral' | 'context';
  strength: 'strong' | 'medium' | 'weak';
  tier: 'A' | 'B';
  args: Record<string, string | number>;
  trace: string;
}
```

#### Arti `state`

| State | Arti | Yang sebaiknya dilakukan UI |
|---|---|---|
| `CONSISTENT` | Nama sejalan dengan alamat | Tampilkan bila panel dibuka. Jangan beri label "aman" |
| `UNCLEAR` | Bukti bertentangan, atau terlalu lemah untuk memutuskan | Tampilkan bila panel dibuka |
| `INCONSISTENT` | Ada bukti kuat bahwa nama dan alamat tidak sejalan | Satu-satunya state yang pantas muncul di daftar inbox |
| `UNASSESSABLE` | Tidak ada dasar untuk menilai | **Jangan tampilkan apa pun.** Bukan berarti mencurigakan |

`UNASSESSABLE` berarti engine tidak menilai, dan tidak ada bukti pendukung maupun penentang yang
disimpan. Saat gate gagal, seluruh bukti berpolarity `supports_*` memang dibuang — supaya UI tidak
pernah menampilkan "inkonsistensi" pada pesan yang tidak dinilai.

#### Arti `confidence`

`confidence` menyatakan seberapa kuat dasar keputusannya, bukan seberapa berbahaya emailnya.

| Nilai | Muncul bila |
|---|---|
| `HIGH` | Ada bukti kuat yang tidak dibantah |
| `MEDIUM` | Ada bukti menengah, atau bukti kuat yang saling bertentangan |
| `LOW` | Hanya bukti lemah, atau tidak ada dasar sama sekali |

#### Arti `polarity` dan `strength`

Ini dua sumbu yang terpisah, dan pemisahannya disengaja:

- `polarity` — ke arah mana bukti itu menunjuk.
- `strength` — seberapa kuat bukti itu berdiri sendiri.

`strong` cukup untuk menentukan state sendirian. `medium` bermakna tetapi tidak boleh sendirian
menyimpulkan ketidakcocokan. `weak` paling jauh menghasilkan `UNCLEAR`. Bukti berpolarity `context`
dan `neutral` tidak pernah memengaruhi state; ia ada untuk menjelaskan situasi.

#### Arti `gate`

| Medan | Isi |
|---|---|
| `passed` | `false` berarti engine sengaja tidak menilai |
| `claim` | Jenis klaim identitas yang ditemukan (`G1`–`G7`) |
| `reason` | Alasan bila tidak dinilai, mis. `personal_name_on_personal_domain` |

`gate` berguna untuk mode diagnostik, dan untuk menjawab pertanyaan "kenapa email ini tidak
ditandai apa-apa?" tanpa menebak.

### Membentuk teks dari kode bukti

Engine tidak pernah menghasilkan kalimat. Ia menghasilkan `code` + `args`, dan kalimatnya dibentuk
di lapisan tampilan. Ini yang membuat teks dapat diterjemahkan tanpa menyentuh engine.

```ts
import type { RuleCode } from '@sender-check/core';

type Args = Readonly<Record<string, string | number>>;

const TEMPLATES: Partial<Record<RuleCode, (args: Args) => string>> = {
  REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT: (a) =>
    `"${a['token']}" muncul di domain tujuan balasan "${a['replyTo']}", ` +
    `tetapi tidak di domain pengirim "${a['from']}"`,

  FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME: (a) =>
    `display name mengklaim organisasi "${a['name']}", tetapi alamatnya di "${a['domain']}"`,
};

function describe(code: RuleCode, args: Args, trace: string): string {
  const template = TEMPLATES[code];
  return template === undefined ? trace : template(args);
}
```

`trace` adalah jaring pengaman: ia selalu berisi bukti mentah yang dapat dibaca manusia, sehingga
kode yang belum punya template tetap dapat ditampilkan. Implementasi lengkap pendekatan ini ada di
[`examples/analyze-emails.ts`](../examples/analyze-emails.ts).

### Contoh: memproses sekumpulan email

```ts
import { analyze, type EmailIdentity } from '@sender-check/core';

const inbox: EmailIdentity[] = [
  { displayName: 'Rise', fromAddress: 'support@rise.com' },
  { displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' },
  { displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' },
];

for (const email of inbox) {
  const verdict = analyze(email);

  if (verdict.state !== 'INCONSISTENT') continue;  // mode tenang: diamkan sisanya

  console.log(`⚠ ${email.displayName} <${email.fromAddress}>`);
  for (const item of verdict.evidence) {
    if (item.polarity !== 'supports_inconsistency') continue;
    console.log(`   • ${item.trace}`);
  }
}
```

Perhatikan `continue` di atas. Itu bukan penyederhanaan demi contoh: itulah perilaku yang
dianjurkan. Hanya `INCONSISTENT` yang pantas muncul tanpa diminta.

## Dari mana datanya datang

Engine menerima data, bukan mengambilnya. Tapi isi datanya menentukan seberapa banyak yang dapat
dilihat, jadi ini penting dipahami.

### Tier A — selalu tersedia

Diambil dari DOM inbox: display name, alamat From, indikator "via", dan penanda peringatan milik
webmail itu sendiri. Ini mencakup sebagian besar pemeriksaan.

### Tier B — perlu halaman "Show original"

`Reply-To`, `Return-Path`, dan `Authentication-Results` **tidak dirender** di DOM inbox. Ketiganya
hanya tersedia di halaman "Show original" (`mail.google.com/mail/u/N/?...&view=om&th=...`).

Ini bukan detail teknis kecil. Ada kelas serangan yang **hanya** dapat ditangkap lewat Tier B:
kasus `Rise <no-reply@mngl.in>` dengan `Reply-To: support@riseworks.digital` pada README tidak
meninggalkan jejak apa pun di domain From. Tanpa header Show original, engine mengembalikan
`UNASSESSABLE`, dan itu hasil yang benar — bukan bug.

### Pemetaan kolom Show original

| Kolom Show original | Medan | Catatan |
|---|---|---|
| `dari:` | `displayName` + `fromAddress` | Pisahkan nama dari alamat |
| `balas ke:` | `replyTo` | |
| `dikirim oleh:` | `returnPath` | Domain Return-Path |
| `Authentication-Results` | `authenticationResults` | Nilai header apa adanya |
| `ditandatangani oleh:` | — | Turunan dari `d=`. Jangan dipakai |
| indikator "via" di tampilan pesan | `gmailViaHint` | **Hanya** dari sini |

> **Peringatan.** Kolom "dikirim oleh" pada Show original adalah domain Return-Path, **bukan**
> `gmailViaHint`. Keduanya berbeda arti. "Via" muncul ketika domain Return-Path berbeda dari domain
> From, dan itulah makna "dikirim atas nama" yang dipakai engine untuk menekan mismatch Return-Path
> yang sah. Mengisi `gmailViaHint` dari kolom "dikirim oleh" akan mengisinya pada hampir semua
> email, dan menekan sinyal Tier B secara diam-diam.

## Menjalankan corpus

```bash
pnpm corpus              # ringkasan + laporan markdown
pnpm corpus -- --verbose # plus daftar lengkap false positive dan false negative
```

Perintah ini menjalankan seluruh fixture, mencetak ringkasan, dan menulis
`tools/corpus/reports/corpus-report.md`. Ia keluar dengan kode 1 bila release gate gagal.

Arti keluaran:

```
kasus            : 404
label            : legit 190, suspicious 157, unassessable 57
state            : UNCLEAR=48  CONSISTENT=131  UNASSESSABLE=103  INCONSISTENT=118
precision (flagged HIGH) : 100.0%   ← proporsi hasil flag yang memang berlabel suspicious
recall (suspicious)      : 76.4%    ← proporsi kasus suspicious yang berhasil di-flag
nag rate (visible)       : 0.0%     ← proporsi kasus tidak mencurigakan yang muncul di list view
nag rate (wide)          : 11.7%    ← termasuk sinyal yang tidak terlihat pengguna
```

`nag rate (wide)` sengaja dipantau meskipun tidak di-gate. Angka itu menunjukkan berapa banyak
email tidak bersalah yang menghasilkan bukti menengah atau lemah — tidak terlihat pengguna, tetapi
tetap memengaruhi seberapa sering panel menampilkan sesuatu.

## Menambah fixture

Fixture adalah array JSON di `tools/corpus/fixtures/`. Bentuk satu kasus:

```json
{
  "id": "suspicious-laporan-001",
  "label": "suspicious",
  "category": "reply-to-asserts-identity",
  "note": "Penjelasan singkat mengapa ini mencurigakan menurut penilaian manusia.",
  "identity": {
    "displayName": "Rise",
    "fromAddress": "no-reply@mngl.in",
    "replyTo": "support@riseworks.digital"
  }
}
```

Aturan yang ditegakkan oleh test:

- `id` unik di seluruh berkas fixture.
- `label` salah satu dari `legit`, `suspicious`, `unassessable`.
- `label` adalah **penilaian manusia**, bukan keluaran engine. Kalau ekspektasi dihasilkan oleh
  engine yang sedang diuji, pengujiannya tidak membuktikan apa pun.
- Jangan menyertakan `provenance`; biarkan diturunkan.

| Berkas | Isi |
|---|---|
| `legit.json` | Kasus tidak mencurigakan. Fokus utama |
| `suspicious.json` | Kasus mencurigakan, dipadankan per kategori |
| `edge.json` | Kasus batas: nama kosong, milis, CJK/Arab/Devanagari, token generik |
| `adversarial.json` | Pola **sah** yang secara struktural mirip typosquat |
| `realworld.json` | Pola serangan yang dilaporkan, beserta varian sahnya |
| `coverage.json` | Kelas kasus yang sebelumnya tidak terwakili sama sekali |

Karena label berbeda, berkas mana yang dipakai untuk kasus baru tidak terlalu penting. Yang penting:
**setiap rule baru wajib disertai kasus sah yang paling mungkin dipicunya.** Lihat
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

Untuk menambah berkas fixture baru, daftarkan namanya di `FIXTURE_FILES` pada
`tools/corpus/src/harness.ts`.

## Regenerasi data

Dua berkas di `packages/core/src/data/*.generated.ts` dihasilkan dari sumber resmi dan tidak boleh
diedit manual.

```bash
# Public Suffix List (MPL-2.0)
# Unduh dari https://publicsuffix.org/list/public_suffix_list.dat
# ke tools/gen-psl/public_suffix_list.dat, lalu:
node tools/gen-psl/generate.ts

# Unicode confusables.txt (Unicode License v3)
# Unduh dari https://www.unicode.org/Public/security/latest/confusables.txt
# ke tools/gen-unicode/confusables.txt, lalu:
node tools/gen-unicode/generate.ts
```

Setelah memperbarui PSL, jalankan `pnpm corpus`. `pslVersion` berubah, sehingga hasil lama tidak
akan dipakai ulang dari cache.

## Pemecahan masalah

| Gejala | Sebab dan penanganan |
|---|---|
| `Cannot find module '@sender-check/core'` | Belum menjalankan `pnpm install`. Paket ini dihubungkan lewat symlink workspace, bukan dipublikasikan ke npm |
| `ERR_PNPM_IGNORED_BUILDS: esbuild` | pnpm 11 memblokir postinstall. Pastikan `allowBuilds: { esbuild: true }` ada di `pnpm-workspace.yaml`, lalu `pnpm install` |
| `Unknown file extension ".ts"` atau `ERR_UNKNOWN_FILE_EXTENSION` | Versi Node terlalu lama. Perlu ≥ 22.18 untuk type stripping |
| `SyntaxError: Missing initializer in const declaration` pada berkas `.mjs` | Anotasi tipe TypeScript tidak dapat dipakai di berkas `.mjs`. Ganti nama ke `.ts` atau hapus anotasinya |
| Engine selalu mengembalikan `UNASSESSABLE` | Cek `verdict.gate.reason`. Kalau `personal_name_on_personal_domain` atau `no_identity_claim`, memang tidak ada klaim identitas yang dapat diperiksa — itu hasil yang benar |
| Rule Tier B tidak pernah menyala | Cek `provenance`. Bila `'dom-inbox'`, sinyal Tier B sengaja diabaikan |
| `pnpm corpus` keluar dengan kode 1 | Release gate gagal. Jalankan `pnpm corpus -- --verbose` untuk melihat false positive-nya |
| Test kelengkapan katalog gagal | Ada kode rule baru tanpa fixture, atau fixture dihapus sehingga sebuah kode tidak lagi terpicu. Keduanya harus diselesaikan |
| Test penjaga encoding gagal | Ada berkas teks yang encodingnya rusak, biasanya akibat skrip yang membaca lalu menulis ulang berkas dengan PowerShell. Perbaiki berkasnya; jangan matikan testnya |

## Status ekstensi browser

Ekstensi browser belum ada. Yang sudah selesai adalah engine dan adapter Gmail-nya, dan
urutan pengerjaannya disengaja: memisahkan engine dari adapter membuat algoritma dapat
diuji tanpa browser, sehingga tuning presisi menjadi iterasi hitungan detik alih-alih
siklus reload ekstensi.

Namun adapter itu **sudah dapat dijalankan di Gmail-mu hari ini** lewat skrip konsol,
tanpa manifest dan tanpa tanda tangan:

```bash
pnpm console:build
```

Langkah lengkapnya, termasuk cara memuat ekstensi sementara lewat `about:debugging` dan
dua jebakan khas Firefox yang sudah diketahui, ada di **[`FIREFOX.md`](FIREFOX.md)**.

Yang menghambat langkah berikutnya adalah **verifikasi selector DOM**. Yang dibutuhkan,
diletakkan di `tools/corpus/dom-snapshots/`:

1. Satu baris list view (outerHTML satu baris saja, bukan seluruh halaman)
2. Satu thread terbuka
3. Satu thread **tanpa** display name
4. Satu halaman **"Show original"**

Empat berkas itu menjadi canary test di CI sekaligus tempat selector adapter diverifikasi.
Cara mengambilnya, termasuk cara menyamarkan isi pesannya, ada di
[`tools/corpus/dom-snapshots/README.md`](../tools/corpus/dom-snapshots/README.md). Status
setiap phase ada di [`DESIGN.md`](DESIGN.md) bagian 13.
