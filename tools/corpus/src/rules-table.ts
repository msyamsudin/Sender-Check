/**
 * Mencetak tabel katalog rule sebagai baris Markdown, siap ditempel ke
 * `docs/RULES.md`.
 *
 * Kolom yang dihasilkan bersifat turunan (kode, polarity, strength, tier, contoh
 * fixture), sehingga tidak boleh ditulis tangan: itulah yang membuat tabel rujukan
 * tidak dapat menyimpang dari implementasi. Kolom "arti" tetap ditulis manusia
 * karena ia menjelaskan maksud, bukan data.
 *
 * Jalankan: pnpm rules
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_RULE_CODES } from '@sender-check/core';
import { loadCases, runCases } from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = loadCases(join(here, '..', 'fixtures'));
const results = runCases(cases);

const POLARITY_LABEL: Record<string, string> = {
  supports_inconsistency: 'inconsistency',
  supports_consistency: 'consistency',
  context: 'context',
  neutral: 'neutral',
};

/**
 * Memilih contoh fixture yang paling instruktif untuk sebuah kode.
 *
 * Kode berpolarity inconsistency sering muncul lebih dulu pada fixture `legit` yang
 * diimbangi bukti konsistensi kuat, sehingga hasilnya UNCLEAR dan bukan flag. Contoh
 * semacam itu benar secara teknis tetapi menyesatkan sebagai rujukan, jadi untuk kode
 * inconsistency kita utamakan fixture berlabel `suspicious`.
 */
function pickExample(code: string) {
  const hits = results.filter((r) => r.verdict.evidence.some((e) => e.code === code));
  const polarity = hits[0]?.verdict.evidence.find((e) => e.code === code)?.polarity;
  const preferred = polarity === 'supports_consistency' ? 'legit' : 'suspicious';
  return hits.find((r) => r.testCase.label === preferred) ?? hits[0];
}

for (const code of ALL_RULE_CODES) {
  const hit = pickExample(code);
  const item = hit?.verdict.evidence.find((e) => e.code === code);
  if (item === undefined) {
    console.log(`| \`${code}\` | — | — | — | — |`);
    continue;
  }
  console.log(
    `| \`${code}\` | ${POLARITY_LABEL[item.polarity] ?? item.polarity} | ${item.strength} | ${item.tier} | \`${hit?.testCase.id ?? '—'}\` |`,
  );
}
