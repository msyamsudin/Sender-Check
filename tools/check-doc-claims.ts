/**
 * Pemeriksa klaim dokumentasi terhadap kenyataan yang dapat dihitung mesin.
 *
 * Dokumentasi proyek ini memuat dua kelas klaim yang keduanya pernah terbukti tertinggal
 * tanpa satu pun pemeriksaan gagal:
 *
 *  1. **angka** — berapa test yang berjalan, berapa berkasnya, berapa kasus corpusnya.
 *     Tiga angka test yang berbeda hidup berdampingan di README, DESIGN, dan USAGE selama
 *     dua rilis, dan semuanya salah.
 *  2. **keadaan** — apakah sesuatu ada atau tidak ada. README direktori snapshot menyatakan
 *     "direktori ini kosong dengan sengaja" padahal tiga snapshot sudah tersimpan di sana
 *     dan sudah dipakai sebagai regression fixture.
 *
 * Karena itu pemeriksa ini membandingkan klaim dengan **sumbernya** — laporan test yang
 * benar-benar berjalan, dan isi direktori yang benar-benar ada — alih-alih dengan salinan
 * kedua di dokumen lain. Salinan kedua hanya menambah tempat yang bisa menyimpang.
 *
 * ## Kenapa skrip, bukan test
 *
 * Jumlah test tidak dapat diperiksa oleh test: menambahkan test untuk memeriksanya mengubah
 * jumlah yang sedang diperiksa, sehingga penjaganya gagal pada dirinya sendiri walaupun
 * angkanya benar. Karena itu pemeriksa ini berdiri di luar `vitest` dan membaca laporan JSON
 * dari satu kali `pnpm test:report`; di CI urutannya adalah test dulu, periksa klaim kemudian.
 * Logikanya tetap diuji `tools/corpus/tests/doc-claims.test.ts` — dengan masukan buatan,
 * bukan dengan angka suite ini.
 *
 * ## Batas yang perlu disebut
 *
 * Yang diperiksa hanyalah klaim yang bentuk kalimatnya dikenali aturan di bawah. Kalimat yang
 * dirumuskan ulang akan berhenti dikenali, dan itu **juga** dilaporkan: aturan yang tidak lagi
 * menemukan klaim apa pun dianggap masalah, karena penjaga yang membaca nol baris akan selalu
 * lulus. Tanpa penjaga itu, "diperiksa" dan "tidak ada yang diperiksa" akan tampak sama.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOC_FILES } from './check-docs.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Laporan JSON yang ditulis `pnpm test:report`. Diabaikan git bersama direktori itu. */
export const REPORT_PATH = 'tools/corpus/reports/test-report.json';

const FIXTURES_DIR = 'tools/corpus/fixtures';
const SNAPSHOT_DIR = 'tools/corpus/dom-snapshots';
const SNAPSHOT_TEST = 'packages/adapters/tests/gmail-snapshots.test.ts';

/**
 * Berkas yang diperiksa klaimnya.
 *
 * README direktori snapshot ikut, walaupun ia bukan dokumen di `docs/`: justru di sanalah
 * klaim keadaan yang pernah basi berdiri.
 */
export const CLAIM_FILES: readonly string[] = [...DOC_FILES, `${SNAPSHOT_DIR}/README.md`];

// ---------------------------------------------------------------------------
// Aturan angka
// ---------------------------------------------------------------------------

/**
 * Satu aturan pengenalan klaim angka.
 *
 * `keys` menentukan kunci kanonik untuk tiap grup tangkapan, berurutan. Panjangnya wajib sama
 * dengan jumlah grup, dan itu diperiksa `assertRulesAreWellFormed` supaya aturan yang salah
 * tulis gagal sebagai aturan, bukan diam-diam melewatkan angka.
 */
export interface ClaimRule {
  readonly description: string;
  readonly pattern: RegExp;
  readonly keys: readonly string[];
}

/**
 * Aturan untuk klaim angka test dan corpus.
 *
 * Urutannya berarti: aturan yang lebih spesifik didahulukan, karena angka yang sama dapat
 * diklaim dua aturan pada posisi yang sama — baris fixture di DESIGN §11 memuat
 * "`legit.json` 172 kasus" yang cocok dengan aturan fixture **dan** aturan umum "(N) kasus".
 * Pemeriksa menyimpan indeks angka yang sudah diklaim, sehingga aturan pertama yang menang.
 */
export const NUMERIC_RULES: readonly ClaimRule[] = [
  { description: 'jumlah test dan jumlah berkasnya', pattern: /(\d+) test di (\d+) berkas/g, keys: ['test.total', 'test.berkas'] },
  { description: 'jumlah test paket ekstensi', pattern: /(\d+) test tanpa browser/g, keys: ['test.extension'] },
  { description: 'jumlah test yang berjalan di Node', pattern: /(\d+) test berjalan di Node/g, keys: ['test.total'] },
  { description: 'jumlah test pada blok perintah README', pattern: /(\d+) test:/g, keys: ['test.total'] },
  { description: 'jumlah lulus dan di-skip di tabel hasil', pattern: /\*\*(\d+) lulus\*\* \((\d+) di-skip\)/g, keys: ['test.lulus', 'test.diSkip'] },
  { description: 'jumlah test yang di-skip', pattern: /(\d+) di antaranya di-skip/g, keys: ['test.diSkip'] },
  { description: 'jumlah kasus corpus', pattern: /(\d+) kasus\b/g, keys: ['corpus.kasus'] },
  { description: 'jumlah fixture berlabel', pattern: /(\d+) fixture berlabel/g, keys: ['corpus.kasus'] },
  { description: 'jumlah test pada rujukan silang antar bagian', pattern: /\*\*(\d+) test\*\*/g, keys: ['test.total'] },
];

/**
 * Aturan untuk baris tabel fixture di DESIGN §11: nama berkas diikuti jumlah kasusnya.
 *
 * Dipisahkan karena kuncinya bergantung pada nama berkas yang cocok, bukan tetap. Baris ini
 * adalah satu-satunya tempat rincian per berkas ditulis, sehingga ia layak diperiksa per
 * berkas — bukan hanya jumlah totalnya.
 */
const FIXTURE_ROW = /([a-z-]+\.json)\s+(\d+) kasus/g;

/**
 * Klaim yang dikecualikan, dengan alasannya.
 *
 * Pengecualian tanpa alasan akan menjadi tempat menyembunyikan klaim yang salah, jadi
 * `reason` wajib dan ikut dicetak ketika pengecualian dipakai.
 */
export interface ClaimExemption {
  readonly file: string;
  /** Potongan baris yang menandai klaim ini. String kosong berarti seluruh berkas. */
  readonly snippet: string;
  readonly reason: string;
}

export const EXEMPTIONS: readonly ClaimExemption[] = [
  {
    file: 'docs/CHANGELOG-0.x.md',
    snippet: '',
    reason: 'arsip beku 0.1.0–0.3.0: angkanya keadaan saat versi itu dirilis, bukan status sekarang',
  },
  {
    file: 'docs/DESIGN.md',
    snippet: '400 fixture berlabel',
    reason: '§15 adalah catatan sejarah akhir Phase 1–6, dan menyatakannya sendiri sebagai catatan sejarah',
  },
];

// ---------------------------------------------------------------------------
// Angka kanonik
// ---------------------------------------------------------------------------

export interface CanonicalNumbers {
  readonly test: {
    readonly berkas: number;
    readonly total: number;
    readonly lulus: number;
    readonly gagal: number;
    readonly diSkip: number;
    readonly extension: number;
  };
  readonly corpus: {
    readonly kasus: number;
    readonly perFile: ReadonlyMap<string, number>;
  };
}

export interface TestReport {
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly numPendingTests: number;
  readonly numTodoTests: number;
  readonly testResults: ReadonlyArray<{
    readonly name: string;
    readonly assertionResults?: ReadonlyArray<unknown>;
  }>;
}

/**
 * Membaca laporan vitest menjadi angka kanonik.
 *
 * Diperiksa di sini, bukan di pemanggil: laporan yang jumlahnya tidak konsisten
 * (`lulus + gagal + di-skip + todo ≠ total`) berarti bentuknya berubah, dan membandingkan
 * dokumen dengan angka yang tidak konsisten hanya akan menghasilkan masalah yang menyesatkan.
 * Pemeriksaan itu bukan hiasan: saat pemeriksa ini pertama ditulis, `gagal` terlupa dari
 * perhitungannya, dan hasilnya adalah kegagalan yang menuduh laporannya rusak padahal
 * pemeriksanya yang kurang satu suku.
 */
export function canonicalFromReport(report: TestReport, corpus: CanonicalNumbers['corpus']): CanonicalNumbers {
  const {
    numTotalTests: total,
    numPassedTests: lulus,
    numFailedTests: gagal,
    numPendingTests: diSkip,
    numTodoTests: todo,
  } = report;

  if (lulus + gagal + diSkip + todo !== total) {
    throw new Error(
      `laporan test tidak konsisten: ${lulus} lulus + ${gagal} gagal + ${diSkip} di-skip + ${todo} todo ≠ ${total} total`,
    );
  }

  const extension = report.testResults
    .filter((file) => file.name.includes('apps/extension'))
    .reduce((count, file) => count + (file.assertionResults?.length ?? 0), 0);

  return { test: { berkas: report.testResults.length, total, lulus, gagal, diSkip, extension }, corpus };
}

/** Jumlah kasus corpus per berkas fixture, dihitung dari berkasnya — bukan dari dokumen. */
export function countCorpus(fixturesDir = join(repoRoot, FIXTURES_DIR)): CanonicalNumbers['corpus'] {
  const perFile = new Map<string, number>();
  let kasus = 0;

  for (const name of readdirSync(fixturesDir).filter((entry) => entry.endsWith('.json')).sort()) {
    const cases = JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown;
    if (!Array.isArray(cases)) {
      throw new Error(`fixture ${name} bukan larik kasus; bentuknya berubah`);
    }
    perFile.set(name, cases.length);
    kasus += cases.length;
  }

  return { kasus, perFile };
}

// ---------------------------------------------------------------------------
// Pengumpulan klaim
// ---------------------------------------------------------------------------

export interface DocClaim {
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
  readonly key: string;
  readonly quoted: number;
}

export interface ClaimProblem {
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
  readonly reason: string;
}

/** Nomor baris (1-based) dari indeks karakter. */
function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/** Baris tempat indeks berada, dipangkas, sebagai kutipan untuk pesan masalah. */
function excerptAt(content: string, index: number): string {
  const lines = content.split('\n');
  return (lines[lineAt(content, index) - 1] ?? '').trim();
}

function isExempt(file: string, excerpt: string): ClaimExemption | undefined {
  return EXEMPTIONS.find(
    (exemption) =>
      exemption.file === file && (exemption.snippet === '' || excerpt.includes(exemption.snippet)),
  );
}

/**
 * Memastikan setiap aturan punya kunci sebanyak grup tangkapannya.
 *
 * Aturan yang salah tulis — satu grup tanpa kunci, atau sebaliknya — akan melewatkan angka
 * tanpa gagal, dan itu jenis kesalahan yang paling sulit terlihat: penjaganya tampak bekerja.
 */
export function assertRulesAreWellFormed(rules: readonly ClaimRule[] = NUMERIC_RULES): void {
  for (const rule of rules) {
    const groups = new RegExp(`${rule.pattern.source}|`).exec('')?.length ?? 0;
    const expected = Math.max(0, groups - 1);
    if (rule.keys.length !== expected) {
      throw new Error(
        `aturan "${rule.description}" punya ${rule.keys.length} kunci untuk ${expected} grup tangkapan`,
      );
    }
  }
}

export interface ClaimCollection {
  readonly claims: readonly DocClaim[];
  /** Aturan yang tidak menemukan klaim apa pun; penjaga yang membaca nol baris selalu lulus. */
  readonly silent: readonly string[];
}

/**
 * Mengumpulkan seluruh klaim angka yang dikenali dari dokumentasi.
 *
 * Angka yang sudah diklaim satu aturan tidak diklaim lagi oleh aturan berikutnya pada posisi
 * yang sama — itulah bedanya "172 kasus" pada baris fixture (milik aturan per berkas) dan
 * "172 kasus" sebagai klaim jumlah total.
 */
export function collectClaims(files: ReadonlyMap<string, string>): ClaimCollection {
  assertRulesAreWellFormed();
  const claims: DocClaim[] = [];
  const matchedByRule = new Map<string, number>();

  for (const [file, content] of files) {
    const claimed = new Set<number>();

    const record = (key: string, digits: string, index: number, rule: ClaimRule | null): void => {
      if (claimed.has(index)) return;
      claimed.add(index);
      claims.push({
        file,
        line: lineAt(content, index),
        excerpt: excerptAt(content, index),
        key,
        quoted: Number(digits),
      });
      if (rule !== null) matchedByRule.set(rule.description, (matchedByRule.get(rule.description) ?? 0) + 1);
    };

    // Baris fixture lebih dulu: rincian per berkas, bukan jumlah total.
    for (const match of content.matchAll(FIXTURE_ROW)) {
      const name = match[1];
      const digits = match[2];
      if (name === undefined || digits === undefined) continue;
      const numberIndex = (match.index ?? 0) + match[0].indexOf(digits, name.length);
      record(`corpus.fixture.${name}`, digits, numberIndex, null);
    }

    for (const rule of NUMERIC_RULES) {
      for (const match of content.matchAll(rule.pattern)) {
        // Angka dicari berurutan dari posisi grup sebelumnya, bukan dengan `indexOf` biasa:
        // pada "123 test di 23 berkas", `indexOf("23")` akan menemukan "23" di dalam "123",
        // dan klaimnya tercatat di posisi yang salah.
        let cursor = 0;
        rule.keys.forEach((key, group) => {
          const digits = match[group + 1];
          if (digits === undefined) return;
          const at = match[0].indexOf(digits, cursor);
          cursor = at + digits.length;
          record(key, digits, (match.index ?? 0) + at, rule);
        });
      }
    }
  }

  const silent = NUMERIC_RULES.filter((rule) => !matchedByRule.has(rule.description)).map(
    (rule) => `${rule.description} (/${rule.pattern.source}/)`,
  );

  return { claims, silent };
}

/**
 * Melaporkan aturan yang tidak lagi menemukan klaim apa pun di dokumentasi.
 *
 * Dipisahkan dari `findClaimProblems` karena sifatnya berbeda: yang pertama membandingkan
 * angka, yang ini menjaga **cakupan** pemeriksaan. Menyatukan keduanya membuat setiap
 * pemanggilan dengan dokumen kecil — termasuk di test — melaporkan sembilan aturan yang
 * tidak menemukan apa-apa, dan keluhan yang selalu muncul akan berhenti dibaca.
 */
export function findCoverageProblems(files: ReadonlyMap<string, string>): readonly ClaimProblem[] {
  return collectClaims(files).silent.map((rule) => ({
    file: 'tools/check-doc-claims.ts',
    line: 0,
    excerpt: '',
    reason: `aturan tidak lagi menemukan klaim apa pun di dokumentasi: ${rule} — periksa apakah kalimatnya berubah, atau aturannya yang perlu diperbarui`,
  }));
}

/** Membandingkan klaim dengan angka kanonik. */
export function findClaimProblems(input: {
  readonly files: ReadonlyMap<string, string>;
  readonly canonical: CanonicalNumbers;
}): readonly ClaimProblem[] {
  const problems: ClaimProblem[] = [];
  const { claims } = collectClaims(input.files);

  const lookup = new Map<string, number>([
    ['test.berkas', input.canonical.test.berkas],
    ['test.total', input.canonical.test.total],
    ['test.lulus', input.canonical.test.lulus],
    ['test.diSkip', input.canonical.test.diSkip],
    ['test.extension', input.canonical.test.extension],
    ['corpus.kasus', input.canonical.corpus.kasus],
  ]);
  for (const [name, count] of input.canonical.corpus.perFile) {
    lookup.set(`corpus.fixture.${name}`, count);
  }

  const label = new Map<string, string>([
    ['test.berkas', 'jumlah berkas test'],
    ['test.total', 'jumlah test'],
    ['test.lulus', 'jumlah test yang lulus'],
    ['test.diSkip', 'jumlah test yang di-skip'],
    ['test.extension', 'jumlah test paket ekstensi'],
    ['corpus.kasus', 'jumlah kasus corpus'],
  ]);

  for (const claim of claims) {
    if (isExempt(claim.file, claim.excerpt) !== undefined) continue;

    const actual = lookup.get(claim.key);
    if (actual === undefined) {
      problems.push({
        file: claim.file,
        line: claim.line,
        excerpt: claim.excerpt,
        reason: `kunci "${claim.key}" tidak punya padanan di angka kanonik, sehingga klaim ini tidak diperiksa apa pun`,
      });
      continue;
    }

    if (claim.quoted !== actual) {
      const what = label.get(claim.key) ?? claim.key.split('.').slice(1).join('.');
      problems.push({
        file: claim.file,
        line: claim.line,
        excerpt: claim.excerpt,
        reason: `menyebut ${what} ${claim.quoted}, yang sebenarnya ${actual}`,
      });
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Klaim keadaan
// ---------------------------------------------------------------------------

const NUMERAL_WORDS: Readonly<Record<string, number>> = {
  nol: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
};

/** Nama berkas snapshot yang diharapkan, dibaca dari daftarnya di test — bukan disalin ke sini. */
export function declaredSnapshots(testFile = join(repoRoot, SNAPSHOT_TEST)): readonly string[] {
  const source = readFileSync(testFile, 'utf8');
  const block = /const SNAPSHOTS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/'([^']+\.html)'/g)].map((match) => match[1] ?? '');
}

export function snapshotState(snapshotDir = join(repoRoot, SNAPSHOT_DIR)): {
  readonly stored: readonly string[];
  readonly missing: readonly string[];
} {
  const stored = readdirSync(snapshotDir).filter((name) => name.endsWith('.html'));
  const missing = declaredSnapshots().filter((name) => !stored.includes(name));
  return { stored, missing };
}

/**
 * Klaim keadaan yang dapat diperiksa isi direktori atau berkasnya.
 *
 * Setiap klaim menyatakan **apa yang harus benar**, bukan sekadar apa yang tidak boleh
 * ditulis. Klaim yang hanya melarang satu kalimat akan lolos begitu kalimatnya diganti
 * dengan sinonim yang sama salahnya.
 */
export interface StateClaim {
  readonly file: string;
  readonly description: string;
  readonly check: (content: string, context: StateContext) => readonly ClaimProblem[];
}

export interface StateContext {
  readonly snapshotDir: string;
}

export const STATE_CLAIMS: readonly StateClaim[] = [
  {
    file: `${SNAPSHOT_DIR}/README.md`,
    description: 'direktori tidak disebut kosong selama berkas snapshot ada di dalamnya',
    check: (content, context) => {
      const { stored } = snapshotState(context.snapshotDir);
      if (stored.length === 0) return [];

      const match = /Direktori ini kosong/i.exec(content);
      if (match === null) return [];

      return [
        {
          file: `${SNAPSHOT_DIR}/README.md`,
          line: lineAt(content, match.index),
          excerpt: excerptAt(content, match.index),
          reason: `menyatakan direktori kosong, padahal ${stored.length} berkas ada di dalamnya (${stored.join(', ')})`,
        },
      ];
    },
  },
  {
    file: `${SNAPSHOT_DIR}/README.md`,
    description: 'jumlah berkas yang dinyatakan sama dengan jumlah berkas yang benar-benar ada',
    check: (content, context) => {
      const { stored, missing } = snapshotState(context.snapshotDir);
      const total = declaredSnapshots().length;
      const match = /memuat \*\*([a-z]+) dari ([a-z]+)\*\* berkas/i.exec(content);

      if (match === null) {
        return [
          {
            file: `${SNAPSHOT_DIR}/README.md`,
            line: 0,
            excerpt: '',
            reason: 'pernyataan "memuat N dari M berkas" tidak lagi ditemukan, sehingga jumlah berkas yang tersimpan tidak diperiksa apa pun',
          },
        ];
      }

      const quoted = NUMERAL_WORDS[(match[1] ?? '').toLowerCase()];
      const quotedTotal = NUMERAL_WORDS[(match[2] ?? '').toLowerCase()];
      const problems: ClaimProblem[] = [];
      const line = lineAt(content, match.index);

      if (quoted !== stored.length) {
        problems.push({
          file: `${SNAPSHOT_DIR}/README.md`,
          line,
          excerpt: match[0],
          reason: `menyebut ${quoted} berkas tersimpan, yang sebenarnya ${stored.length}`,
        });
      }
      if (quotedTotal !== total) {
        problems.push({
          file: `${SNAPSHOT_DIR}/README.md`,
          line,
          excerpt: match[0],
          reason: `menyebut ${quotedTotal} berkas dibutuhkan, yang sebenarnya ${total}`,
        });
      }
      if (missing.length !== total - stored.length) {
        problems.push({
          file: `${SNAPSHOT_DIR}/README.md`,
          line,
          excerpt: match[0],
          reason: `daftar snapshot di test dan isi direktori tidak sejalan: ${missing.length} hilang dari ${total}`,
        });
      }

      return problems;
    },
  },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readFiles(relativePaths: readonly string[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const file of relativePaths) {
    const absolute = join(repoRoot, file);
    if (existsSync(absolute)) files.set(file, readFileSync(absolute, 'utf8'));
  }
  return files;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const reportPath = join(repoRoot, REPORT_PATH);

  if (!existsSync(reportPath)) {
    console.log(`laporan test tidak ada di ${REPORT_PATH}`);
    console.log('jalankan `pnpm test:report` lebih dulu; pemeriksa ini membandingkan klaim');
    console.log('dengan hasil test yang benar-benar berjalan, bukan dengan angka di dokumen lain');
    process.exitCode = 1;
  } else {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as TestReport;
    const canonical = canonicalFromReport(report, countCorpus());
    const files = readFiles(CLAIM_FILES);

    const problems = [
      // Test yang gagal berarti angka "lulus" di laporan bukan angka yang boleh dikutip
      // dokumen; menjalankan pemeriksa ini setelah run yang merah harus mengatakannya,
      // bukan melaporkan "semua klaim cocok".
      ...(canonical.test.gagal > 0
        ? [
            {
              file: REPORT_PATH,
              line: 0,
              excerpt: '',
              reason: `ada ${canonical.test.gagal} test yang gagal, sehingga angka lulus pada laporan tidak dapat dipakai sebagai pembanding`,
            },
          ]
        : []),
      ...findClaimProblems({ files, canonical }),
      ...findCoverageProblems(files),
      ...STATE_CLAIMS.flatMap((claim) => {
        const content = files.get(claim.file);
        return content === undefined ? [] : claim.check(content, { snapshotDir: join(repoRoot, SNAPSHOT_DIR) });
      }),
    ];

    const { claims } = collectClaims(files);
    const { stored, missing } = snapshotState();

    console.log(`laporan test   : ${REPORT_PATH}`);
    console.log(
      `angka kanonik  : ${canonical.test.total} test (${canonical.test.lulus} lulus, ${canonical.test.diSkip} di-skip) di ${canonical.test.berkas} berkas; ekstensi ${canonical.test.extension}; corpus ${canonical.corpus.kasus} kasus`,
    );
    console.log(`snapshot       : ${stored.length} tersimpan, ${missing.length} belum diambil`);
    console.log(`klaim diperiksa: ${claims.length} angka, ${STATE_CLAIMS.length} keadaan`);

    if (problems.length === 0) {
      console.log('semua klaim cocok dengan kenyataan');
    } else {
      console.log('');
      for (const problem of problems) {
        const where = problem.line === 0 ? problem.file : `${problem.file}:${problem.line}`;
        console.log(`MASALAH  ${where}`);
        if (problem.excerpt.length > 0) console.log(`         ${problem.excerpt}`);
        console.log(`         ${problem.reason}`);
      }
      console.log('');
      console.log(`${problems.length} masalah ditemukan`);
      process.exitCode = 1;
    }
  }
}
