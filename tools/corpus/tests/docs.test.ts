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
});
