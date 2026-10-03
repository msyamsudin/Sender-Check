/**
 * Mencetak kolom turunan katalog rule sebagai tabel Markdown.
 *
 * Keluarannya **bukan** sumber tempel untuk tabel di `docs/RULES.md`. Berkas ini dulu
 * menyebutnya "siap ditempel", dan itu tidak benar: bentuk keduanya berbeda.
 *
 * ```
 * keluaran perintah ini    Kode | Polaritas | Strength | Tier | contoh fixture
 * tabel di docs/RULES.md   Kode | Polaritas | Strength | Arti
 * ```
 *
 * Perbedaannya bukan ketidaktelitian. Tabel di dokumen memuat kolom "arti" yang ditulis
 * manusia, dan enam sel `Strength`-nya sengaja menulis rentang (`strong / medium`,
 * `strong / weak`, dan satu bertanda bintang dengan catatan di bawah tabel), karena rule
 * itu memang berubah bobot menurut kasusnya. Keduanya tidak dapat dihasilkan mesin.
 * Sebaliknya, kolom `Tier` dan contoh fixture berguna untuk meninjau katalog, dan tidak
 * dibutuhkan pembaca dokumen.
 *
 * Jadi perintah ini adalah **tabel audit**: ia menjawab "apakah katalog, bobot, dan cakupan
 * fixture masih konsisten", dan hasilnya dibandingkan dengan dokumen, bukan ditempelkan ke
 * dalamnya. Yang menjaga keduanya tetap sejalan adalah test di
 * `tools/corpus/tests/docs.test.ts`, yang memeriksa Kode dan Polaritas setiap rule terhadap
 * katalog dan terhadap engine, serta memastikan sel `Strength` di dokumen memuat bobot yang
 * benar-benar dipancarkan.
 *
 * Jalankan: pnpm rules
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_RULE_CODES } from '@sender-check/core';
import { shortPolarity } from '@sender-check/presentation';
import { loadCases, runCases } from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const cases = loadCases(join(here, '..', 'fixtures'));
const results = runCases(cases);

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
    `| \`${code}\` | ${shortPolarity(item.polarity)} | ${item.strength} | ${item.tier} | \`${hit?.testCase.id ?? '—'}\` |`,
  );
}
