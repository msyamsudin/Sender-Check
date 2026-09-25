import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDocs } from '../../../tools/check-docs.ts';

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
    const here = dirname(fileURLToPath(import.meta.url));
    const gitignore = readFileSync(join(here, '..', '..', '..', '.gitignore'), 'utf8');

    for (const ignoredDirectory of ['tools/console/dist/', 'tools/corpus/reports/']) {
      expect(
        gitignore.includes(ignoredDirectory),
        `${ignoredDirectory} tidak ada di .gitignore, sehingga pengecualiannya tidak sah`,
      ).toBe(true);
    }
  });
});
