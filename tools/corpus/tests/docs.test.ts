import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDocs } from '../../../tools/check-docs.ts';
import { computeMetrics, loadCases, runCases, summaryLines } from '../src/harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const fixturesDir = join(here, '..', 'fixtures');

/**
 * Dokumentasi yang menunjuk berkas yang tidak ada adalah dokumentasi yang berbohong.
 * Test ini menjaga tautan, path, dan kelengkapan silang antar dokumen.
 */
describe('dokumentasi', () => {
  const result = checkDocs();

  it('memeriksa sejumlah tautan dan path', () => {
    expect(result.checkedTargets).toBeGreaterThan(40);
  });

  it('seluruh tautan Markdown menunjuk berkas yang ada', () => {
    const broken = result.problems.map((p) => `${p.file} -> ${p.target} (${p.reason})`);
    expect(broken).toEqual([]);
  });

  it('seluruh path repositori di dalam dokumentasi benar-benar ada', () => {
    const missingPaths = result.problems
      .filter((p) => p.reason.includes('path di dalam kode'))
      .map((p) => `${p.file} -> ${p.target}`);
    expect(missingPaths).toEqual([]);
  });

  it('seluruh fixture yang didaftarkan harness benar-benar ada', () => {
    const missingFixtures = result.problems
      .filter((p) => p.reason.includes('fixture'))
      .map((p) => p.target);
    expect(missingFixtures).toEqual([]);
  });

  it('setiap dokumen di docs/ ditautkan dari README', () => {
    const orphans = result.problems
      .filter((p) => p.reason.includes('tidak ditautkan'))
      .map((p) => p.target);
    expect(orphans).toEqual([]);
  });

  it('tidak menuntut keberadaan artefak build yang diabaikan git', () => {
    // Pemeriksa ini sempat menuntut `tools/console/dist/` dan `tools/corpus/reports/`
    // benar-benar ada. Akibatnya ia lulus di mesin yang sudah pernah `pnpm console:build`
    // dan gagal di CI yang baru saja meng-clone — kegagalan pertama repositori ini.
    //
    // Test ini tidak mengubah apa pun di disk: bila artefaknya ada (mesin pengembang),
    // pemeriksaan tetap menemukannya; bila tidak ada (CI), pemeriksa harus tetap bersih.
    const problemsInBuildDirs = result.problems
      .filter((problem) => /^(tools\/console\/dist|tools\/corpus\/reports)/.test(problem.target))
      .map((problem) => `${problem.file} -> ${problem.target}`);
    expect(problemsInBuildDirs).toEqual([]);
  });

  it('pengecualian artefak build hanya berlaku untuk direktori yang diabaikan git', () => {
    // Menjaga agar daftar pengecualian tidak dipakai untuk membungkam path yang salah
    // tulis: setiap direktori yang dikecualikan harus benar-benar ada di `.gitignore`.
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

    for (const ignoredDirectory of ['tools/console/dist/', 'tools/corpus/reports/']) {
      expect(
        gitignore.includes(ignoredDirectory),
        `${ignoredDirectory} tidak ada di .gitignore, sehingga pengecualiannya tidak sah`,
      ).toBe(true);
    }
  });
});

/**
 * Membuang bagian yang bukan nilai.
 *
 * Dua bentuk yang harus dibuang, dan keduanya pernah benar-benar membuat angka di
 * dokumentasi berbeda dari kenyataan tanpa terlihat:
 *
 *  - keterangan penjelas di dokumentasi, sesudah panah `←`;
 *  - sufiks ambang pada keluaran CLI, mis. `  (gate >= 95.0%)`.
 */
function valueOnly(raw: string): string {
  const beforeArrow = raw.split('←')[0] ?? '';
  const beforeGate = beforeArrow.split('(')[0] ?? '';
  return beforeGate.replace(/\s+/g, ' ').trim();
}

/** Memecah baris `kunci : nilai` menjadi peta. Baris tanpa titik dua diabaikan. */
function toMap(lines: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    map.set(line.slice(0, colon).trim(), valueOnly(line.slice(colon + 1)));
  }
  return map;
}

/**
 * Mengambil blok "Arti keluaran" dari `docs/USAGE.md`, yaitu satu-satunya tempat
 * dokumentasi mengutip angka keluaran corpus.
 */
function quotedSummary(markdown: string): Map<string, string> {
  const lines = markdown.split('\n');
  const heading = lines.findIndex((line) => line.trim() === 'Arti keluaran:');
  if (heading === -1) throw new Error('docs/USAGE.md tidak lagi memuat bagian "Arti keluaran:"');

  const open = lines.findIndex((line, index) => index > heading && line.startsWith('```'));
  const close = lines.findIndex((line, index) => index > open && line.startsWith('```'));
  if (open === -1 || close === -1) {
    throw new Error('bagian "Arti keluaran:" tidak lagi diikuti satu blok berpagar');
  }

  return toMap(lines.slice(open + 1, close));
}

describe('angka keluaran corpus yang dikutip dokumentasi', () => {
  const metrics = computeMetrics(runCases(loadCases(fixturesDir)));
  const actual = toMap(summaryLines(metrics));
  const quoted = quotedSummary(readFileSync(join(repoRoot, 'docs', 'USAGE.md'), 'utf8'));

  it('dokumentasi mengutip kumpulan kunci yang diharapkan', () => {
    // Daftar ini sengaja dipatok. Bila sebuah metrik ditambahkan atau dihapus dari
    // ringkasan CLI, test ini memaksa blok dokumentasinya ikut disadari dan diperbarui —
    // bukan dibiarkan tertinggal seperti angka `state` yang dulu berjumlah 400 sementara
    // `kasus` di baris atasnya menyebut 404.
    expect([...quoted.keys()].sort()).toEqual([
      'kasus',
      'label',
      'nag rate (visible)',
      'nag rate (wide)',
      'precision (flagged HIGH)',
      'recall (suspicious)',
      'state',
    ]);
  });

  it('setiap angka yang dikutip sama dengan keluaran corpus sebenarnya', () => {
    const wrong: string[] = [];

    for (const [key, value] of quoted) {
      const real = actual.get(key);
      if (real === undefined) {
        wrong.push(`${key}: tidak ada pada ringkasan CLI`);
        continue;
      }

      // `state` dibandingkan sebagai himpunan, bukan urutan: urutannya mengikuti
      // kemunculan pertama di fixture, sehingga menata ulang berkas fixture akan gagal
      // di sini tanpa ada satu pun angka yang sebenarnya salah.
      if (key === 'state') {
        const sort = (text: string): string => text.split(/\s+/).sort().join(' ');
        if (sort(value) !== sort(real)) {
          wrong.push(`state: dokumen "${value}" vs sebenarnya "${real}"`);
        }
        continue;
      }

      if (value !== real) wrong.push(`${key}: dokumen "${value}" vs sebenarnya "${real}"`);
    }

    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
