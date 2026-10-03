import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_RULE_CODES, type Evidence } from '@sender-check/core';
import { describeRule } from '@sender-check/presentation';
import { loadCases, runCases } from '../src/harness.ts';

/**
 * Kalimat bukti diuji terhadap `args` yang **benar-benar dipancarkan engine**.
 *
 * Test kelengkapan di `packages/presentation` hanya dapat membuktikan bahwa setiap kode
 * punya template. Ia tidak dapat membuktikan bahwa template itu menyebut nama argumen yang
 * benar: template yang membaca `args['token']` padahal engine memancarkan `args['label']`
 * akan menghasilkan kalimat berisi "undefined", dan itu lolos dari pemeriksaan mana pun
 * yang memakai argumen karangan.
 *
 * Karena itu test ini berjalan di sini, bukan di paket penyajian: hanya harness corpus yang
 * memiliki fixture, dan fixture adalah satu-satunya sumber `args` asli. Ini juga alasan
 * test ini mengimpor `@sender-check/presentation` alih-alih sebaliknya — arah
 * ketergantungannya harus tetap `tools` → `packages`.
 *
 * Kenapa ini penting secara praktis: dua salinan template yang berbeda pernah hidup
 * berdampingan di repositori ini, dan salinan yang tidak dijalankan siapa pun adalah tempat
 * paling mudah bagi kesalahan semacam ini untuk bersembunyi.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const results = runCases(loadCases(join(here, '..', 'fixtures')));

/** Bukti pertama yang dipancarkan fixture untuk sebuah kode, lengkap dengan `args` aslinya. */
function sampleFor(code: string): Evidence | undefined {
  for (const result of results) {
    const item = result.verdict.evidence.find((candidate) => candidate.code === code);
    if (item !== undefined) return item;
  }
  return undefined;
}

describe('kalimat bukti terhadap args yang sebenarnya', () => {
  it('setiap kode dapat ditelusuri ke satu bukti nyata dari fixture', () => {
    // Prasyarat test berikutnya. Bila sebuah kode tidak pernah dipancarkan, tidak ada `args`
    // asli untuk mengujinya, dan kalimatnya hanya diuji dengan karangan.
    const withoutSample = ALL_RULE_CODES.filter((code) => sampleFor(code) === undefined);
    expect(withoutSample, `kode tanpa bukti nyata: ${withoutSample.join(', ')}`).toEqual([]);
  });

  it('setiap kalimat dapat dirender dari args nyata tanpa menyisakan placeholder', () => {
    const broken: string[] = [];

    for (const code of ALL_RULE_CODES) {
      const sample = sampleFor(code);
      if (sample === undefined) continue;

      const sentence = describeRule(code, sample.args, sample.trace);

      // "undefined" di dalam kalimat hampir selalu berarti nama argumen yang salah, dan itu
      // satu-satunya jenis kerusakan yang tidak terlihat oleh typecheck.
      for (const artefact of ['undefined', 'NaN', '[object Object]', '${']) {
        if (sentence.includes(artefact)) {
          broken.push(`${code}: kalimat memuat "${artefact}" -> ${sentence}`);
        }
      }
      if (sentence.trim().length === 0) broken.push(`${code}: kalimat kosong`);
    }

    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('kalimat Reply-To untuk kasus nyata sama dengan yang dikutip dokumentasi', () => {
    // README dan `docs/USAGE.md` mengutip kalimat ini apa adanya. Sebelumnya skrip konsol
    // memakai wording yang berbeda, sehingga dokumentasi dan keluaran tidak sepakat —
    // persis kelas cacat yang membuat test ini ada.
    const sample = sampleFor('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
    expect(sample, 'fixture tidak lagi memancarkan rule Reply-To').toBeDefined();
    if (sample === undefined) return;

    const sentence = describeRule(sample.code, sample.args, sample.trace);

    for (const doc of ['README.md', 'docs/USAGE.md']) {
      const text = readFileSync(join(repoRoot, doc), 'utf8').replace(/\s+/g, ' ');
      expect(text, `${doc} tidak lagi mengutip kalimat ini`).toContain(sentence);
    }
  });
});
