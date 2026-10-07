import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLAIM_FILES,
  NUMERIC_RULES,
  STATE_CLAIMS,
  assertRulesAreWellFormed,
  canonicalFromReport,
  collectClaims,
  countCorpus,
  findClaimProblems,
  findCoverageProblems,
  type CanonicalNumbers,
  type TestReport,
} from '../../../tools/check-doc-claims.ts';

/**
 * Uji logika pemeriksa klaim dokumentasi.
 *
 * Ini **bukan** tempat memeriksa dokumentasi sungguhan. Pemeriksaan itu hidup di
 * `pnpm docs:claims`, di luar `vitest`, justru karena jumlah test tidak dapat diperiksa
 * oleh test: berkas ini sendiri ikut menambah jumlah itu. Yang diuji di sini adalah
 * logikanya — apakah ia menangkap angka yang salah, apakah ia menghormati pengecualian,
 * dan apakah ia mengeluh ketika kalimatnya berubah sehingga tidak ada lagi yang diperiksa.
 *
 * Angka di `synthetic()` karena itu sengaja **bukan** angka suite ini. Dipakai nilai bulat
 * yang jelas berbeda supaya tidak ada pembaca yang mengira test ini mengunci jumlah test
 * yang sebenarnya — dan supaya nilai itu tidak perlu disunting setiap kali ada test baru.
 */

/** Angka kanonik buatan: masukan untuk perbandingan, bukan pernyataan tentang suite ini. */
function synthetic(): CanonicalNumbers {
  return {
    test: { berkas: 30, total: 500, lulus: 480, gagal: 0, diSkip: 20, extension: 40 },
    corpus: {
      kasus: 200,
      perFile: new Map([
        ['legit.json', 100],
        ['suspicious.json', 60],
        ['edge.json', 40],
      ]),
    },
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function readRealDocs(): Map<string, string> {
  const files = new Map<string, string>();
  for (const file of CLAIM_FILES) {
    const absolute = join(repoRoot, file);
    if (existsSync(absolute)) files.set(file, readFileSync(absolute, 'utf8'));
  }
  return files;
}

describe('aturan pengenalan klaim', () => {
  it('setiap aturan punya kunci sebanyak grup tangkapannya', () => {
    expect(() => assertRulesAreWellFormed()).not.toThrow();
  });

  it('menolak aturan yang jumlah kuncinya tidak cocok', () => {
    // Penjaga yang salah tulis akan melewatkan angka tanpa gagal — kegagalan yang paling
    // sulit terlihat, karena penjaganya tampak bekerja.
    expect(() =>
      assertRulesAreWellFormed([{ description: 'buatan', pattern: /(\d+) dan (\d+)/g, keys: ['a'] }]),
    ).toThrow(/1 kunci untuk 2 grup/);
  });
});

describe('angka kanonik', () => {
  const report: TestReport = {
    numTotalTests: 10,
    numPassedTests: 8,
    numFailedTests: 0,
    numPendingTests: 2,
    numTodoTests: 0,
    testResults: [
      { name: '/repo/apps/extension/tests/a.test.ts', assertionResults: [{}, {}, {}] },
      { name: '/repo/apps/extension/tests/b.test.ts', assertionResults: [{}, {}] },
      { name: '/repo/packages/core/tests/c.test.ts', assertionResults: [{}, {}, {}, {}, {}] },
    ],
  };

  it('menghitung berkas, total, lulus, di-skip, dan test ekstensi', () => {
    const canonical = canonicalFromReport(report, { kasus: 0, perFile: new Map() });

    expect(canonical.test).toEqual({ berkas: 3, total: 10, lulus: 8, gagal: 0, diSkip: 2, extension: 5 });
  });

  it('menolak laporan yang jumlahnya tidak konsisten', () => {
    // Laporan dengan bentuk berbeda akan membuat setiap klaim dilaporkan salah, dan
    // masalah yang menyesatkan lebih buruk daripada tidak ada masalah.
    expect(() =>
      canonicalFromReport({ ...report, numTotalTests: 11 }, { kasus: 0, perFile: new Map() }),
    ).toThrow(/tidak konsisten/);
  });

  it('menghitung kasus corpus dari berkasnya, bukan dari dokumen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sender-check-fixture-'));
    writeFileSync(join(dir, 'legit.json'), JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]));
    writeFileSync(join(dir, 'edge.json'), JSON.stringify([{ id: 4 }]));

    const corpus = countCorpus(dir);

    expect(corpus.kasus).toBe(4);
    expect(corpus.perFile.get('legit.json')).toBe(3);
    expect(corpus.perFile.get('edge.json')).toBe(1);
  });
});

describe('klaim angka pada dokumentasi', () => {
  it('menangkap seluruh angka test yang pernah basi', () => {
    // Ketiga bentuk ini benar-benar hidup di repositori ini selama dua rilis, di tiga
    // berkas berbeda, tanpa satu pun pemeriksaan gagal. Test ini menjaga bahwa penjaga
    // baru akan menangkapnya seandainya mereka kembali.
    const files = new Map([
      [
        'README.md',
        [
          '| Test | — | **238 lulus** (2 di-skip) |',
          'pnpm test           # 328 test: unit, property',
        ].join('\n'),
      ],
      ['docs/DESIGN.md', '**398 test di 23 berkas** pada saat dokumen ini diperbarui'],
    ]);

    const problems = findClaimProblems({ files, canonical: synthetic() });
    const reasons = problems.map((problem) => problem.reason);

    expect(reasons).toContain('menyebut jumlah test yang lulus 238, yang sebenarnya 480');
    expect(reasons.some((reason) => reason.includes('menyebut jumlah test 328'))).toBe(true);
    expect(reasons.some((reason) => reason.includes('menyebut jumlah test 398'))).toBe(true);
    expect(reasons.some((reason) => reason.includes('menyebut jumlah berkas test 23'))).toBe(true);
    // Jumlah test yang di-skip ikut diperiksa, dan di sini memang ikut salah: dokumen
    // menyebut 2 di-skip sementara angka kanoniknya 20.
    expect(reasons).toContain('menyebut jumlah test yang di-skip 2, yang sebenarnya 20');
    expect(problems).toHaveLength(5);
  });

  it('menerima dokumen yang angkanya sama dengan kenyataan', () => {
    const files = new Map([
      [
        'docs/DESIGN.md',
        '**500 test di 30 berkas** pada saat dokumen ini diperbarui, 20 di antaranya di-skip',
      ],
      ['docs/USAGE.md', 'urutan itu bertahan — 500 test berjalan di Node'],
    ]);

    expect(findClaimProblems({ files, canonical: synthetic() })).toEqual([]);
  });

  it('menghormati pengecualian yang beralasan', () => {
    const files = new Map([
      ['docs/CHANGELOG-0.x.md', '- 145 test: unit, property, end-to-end, dan arsitektur.'],
      ['docs/DESIGN.md', '`packages/core` berisi engine lengkap, 400 fixture berlabel, dan laporan'],
    ]);

    expect(findClaimProblems({ files, canonical: synthetic() })).toEqual([]);
  });

  it('mengeluh ketika tidak ada lagi klaim yang terbaca', () => {
    // Penjaga yang membaca nol baris akan selalu lulus. Tanpa keluhan ini, dokumentasi yang
    // seluruh kalimatnya dirumuskan ulang akan tampak sepenuhnya patuh.
    const files = new Map([['README.md', 'Tidak ada angka apa pun di sini.']]);

    const problems = findCoverageProblems(files);

    expect(problems).toHaveLength(NUMERIC_RULES.length);
    expect(problems[0]?.reason).toContain('tidak lagi menemukan klaim apa pun');

    // Perbandingan angkanya sendiri tetap bersih: yang hilang cakupan, bukan kecocokan.
    expect(findClaimProblems({ files, canonical: synthetic() })).toEqual([]);
  });
});

describe('klaim keadaan direktori snapshot', () => {
  function snapshotContext(): { snapshotDir: string } {
    const snapshotDir = mkdtempSync(join(tmpdir(), 'sender-check-snapshot-'));
    for (const name of ['list-row.html', 'thread-open.html', 'show-original.html']) {
      writeFileSync(join(snapshotDir, name), '<div></div>');
    }
    return { snapshotDir };
  }

  const emptyClaim = STATE_CLAIMS[0];
  const countClaim = STATE_CLAIMS[1];

  it('menolak kalimat "direktori ini kosong" selama berkasnya ada', () => {
    const content = 'Direktori ini kosong dengan sengaja. Isinya dibutuhkan untuk membangun\nadapter Gmail.';

    const problems = emptyClaim?.check(content, snapshotContext()) ?? [];

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('3 berkas ada di dalamnya');
  });

  it('menerima kalimat yang tidak menyatakan apa pun tentang kekosongan', () => {
    const content = 'Direktori ini memuat tiga snapshot yang sudah diambil dari sesi Gmail.';

    expect(emptyClaim?.check(content, snapshotContext()) ?? []).toEqual([]);
  });

  it('menangkap jumlah berkas yang dinyatakan berbeda dari isinya', () => {
    const content = 'Direktori ini memuat **dua dari empat** berkas yang dibutuhkan.';

    const problems = countClaim?.check(content, snapshotContext()) ?? [];

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toBe('menyebut 2 berkas tersimpan, yang sebenarnya 3');
  });

  it('menerima jumlah berkas yang cocok dengan isinya', () => {
    const content = 'Direktori ini memuat **tiga dari empat** berkas yang dibutuhkan.';

    expect(countClaim?.check(content, snapshotContext()) ?? []).toEqual([]);
  });

  it('mengeluh bila pernyataan jumlah berkasnya hilang', () => {
    // Sama seperti aturan angka: klaim yang tidak lagi terbaca harus terlihat, bukan
    // diam-diam berhenti diperiksa.
    const problems = countClaim?.check('Direktori ini memuat beberapa berkas.', snapshotContext()) ?? [];

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('tidak lagi ditemukan');
  });
});

describe('dokumentasi dan direktori sungguhan', () => {
  it('setiap aturan angka masih menemukan klaimnya', () => {
    // Bukan perbandingan angka — itu tugas `pnpm docs:claims`. Yang diperiksa di sini:
    // aturannya masih relevan terhadap kalimat yang benar-benar dipakai dokumentasi.
    const { claims, silent } = collectClaims(readRealDocs());

    expect(claims.length).toBeGreaterThan(5);
    expect(silent, `aturan tanpa klaim: ${silent.join('; ')}`).toEqual([]);
  });

  it('setiap klaim punya padanan di angka kanonik', () => {
    // Kunci tanpa padanan tidak diperiksa apa pun, dan itu akan tampak sama dengan cocok.
    const { claims } = collectClaims(readRealDocs());
    const corpus = countCorpus();

    const known = new Set([
      'test.berkas',
      'test.total',
      'test.lulus',
      'test.diSkip',
      'test.extension',
      'corpus.kasus',
      ...[...corpus.perFile.keys()].map((name) => `corpus.fixture.${name}`),
    ]);

    const orphans = claims.map((claim) => claim.key).filter((key) => !known.has(key));
    expect(orphans).toEqual([]);
  });

  it('klaim keadaan direktori snapshot sesuai dengan isinya', () => {
    const snapshotDir = join(repoRoot, 'tools/corpus/dom-snapshots');
    const content = readFileSync(join(snapshotDir, 'README.md'), 'utf8');

    const problems = STATE_CLAIMS.flatMap((claim) => claim.check(content, { snapshotDir }));

    expect(problems).toEqual([]);
  });
});
