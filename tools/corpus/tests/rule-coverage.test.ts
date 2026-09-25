import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_RULE_CODES, analyze, type RuleCode } from '@sender-check/core';
import { computeMetrics, loadCases, runCases, type CaseResult } from '../src/harness.ts';

/**
 * Kelengkapan katalog rule.
 *
 * Katalog rule adalah kontrak publik: setiap kode yang tercantum di
 * `ALL_RULE_CODES` akan muncul di `verdict.evidence` dan harus dapat dijelaskan ke
 * pengguna. Test ini menjaga kontrak itu dari dua sisi sekaligus:
 *
 *  - **tidak ada kode mati** — kode yang dideklarasikan tetapi tidak pernah
 *    dipancarkan oleh implementasi mana pun, sehingga dokumentasi rule berbohong;
 *  - **tidak ada kode yang tidak teruji** — kode yang berjalan tetapi tidak pernah
 *    dipicu oleh satu pun fixture, sehingga perilakunya tidak terkunci.
 *
 * Cara ini bekerja karena fixture adalah ground truth yang ditulis manusia: bila
 * sebuah kode tidak pernah muncul, berarti belum ada kasus nyata yang mewakilinya.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

function emittedCodes(results: readonly CaseResult[]): Set<RuleCode> {
  const codes = new Set<RuleCode>();
  for (const result of results) {
    for (const item of result.verdict.evidence) codes.add(item.code);
  }
  return codes;
}

const cases = loadCases(fixturesDir);
const results = runCases(cases);
const emitted = emittedCodes(results);

describe('katalog rule: kelengkapan terhadap corpus', () => {
  it('setiap kode rule yang dideklarasikan benar-benar dipancarkan oleh fixture', () => {
    const dead = ALL_RULE_CODES.filter((code) => !emitted.has(code));
    expect(dead, `kode rule tidak pernah dipancarkan: ${dead.join(', ')}`).toEqual([]);
  });

  it('tidak ada kode yang dipancarkan di luar katalog', () => {
    const catalog = new Set<string>(ALL_RULE_CODES);
    const extra = [...emitted].filter((code) => !catalog.has(code));
    expect(extra, `kode di luar katalog: ${extra.join(', ')}`).toEqual([]);
  });

  it('katalog tidak memuat duplikat', () => {
    expect(new Set(ALL_RULE_CODES).size).toBe(ALL_RULE_CODES.length);
  });

  it('setiap kode memakai konvensi penamaan huruf besar dan garis bawah', () => {
    for (const code of ALL_RULE_CODES) {
      expect(code, code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(code.length, code).toBeGreaterThan(6);
    }
  });

  it('setiap kode unik terhadap katalog dan jumlahnya sesuai harapan', () => {
    // Angka ini sengaja dipatok: menambah atau menghapus rule harus disertai
    // pembaruan docs/RULES.md, dan test ini memaksa itu disadari.
    expect(ALL_RULE_CODES.length).toBe(31);
  });
});

describe('katalog rule: setiap kode punya contoh yang dapat ditunjuk', () => {
  /**
   * Memetakan kode ke satu id fixture yang memicunya. Ini yang membuat
   * `docs/RULES.md` dapat diperiksa: pembaca bisa membuka fixture yang disebut untuk
   * melihat kasus nyatanya, bukan sekadar membaca deskripsi.
   */
  it('setiap kode dapat ditelusuri ke minimal satu fixture', () => {
    const missing: string[] = [];

    for (const code of ALL_RULE_CODES) {
      const example = results.find((result) =>
        result.verdict.evidence.some((item) => item.code === code),
      );
      if (example === undefined) missing.push(code);
    }

    expect(missing, `kode tanpa contoh fixture: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('corpus: kesehatan himpunan data', () => {
  it('jumlah kasus memenuhi target', () => {
    expect(cases.length).toBeGreaterThanOrEqual(400);
  });

  it('tidak ada label yang timpang secara ekstrem', () => {
    const metrics = computeMetrics(results);
    expect(metrics.byLabel.legit).toBeGreaterThanOrEqual(150);
    expect(metrics.byLabel.suspicious).toBeGreaterThanOrEqual(130);
  });

  it('release gate lulus', () => {
    const metrics = computeMetrics(results);
    expect(metrics.precisionHigh, 'precision flagged HIGH').toBeGreaterThanOrEqual(0.95);
    expect(metrics.nagRate, 'nag rate visible').toBeLessThanOrEqual(0.03);
  });

  it('analisis deterministik untuk seluruh corpus', () => {
    // Dijalankan dua kali dan dibandingkan, karena determinisme adalah syarat agar
    // metrik di atas bermakna sama sekali.
    for (const testCase of cases) {
      expect(analyze(testCase.identity)).toEqual(analyze(testCase.identity));
    }
  });
});
