/**
 * CLI corpus.
 *
 * `node tools/corpus/src/cli.ts`            -> ringkasan + laporan markdown
 * `node tools/corpus/src/cli.ts --verbose`  -> plus daftar tiap kegagalan
 *
 * Keluar dengan kode 1 bila release gate gagal, supaya bisa dipakai langsung di CI.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALGORITHM_VERSION, PSL_VERSION } from '@sender-check/core';
import {
  computeMetrics,
  gatesPass,
  loadCases,
  renderMarkdown,
  runCases,
  summaryLines,
  type CaseResult,
} from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');
const reportsDir = join(here, '..', 'reports');

function printCase(result: CaseResult): void {
  const codes = result.verdict.evidence
    .filter((item) => item.polarity === 'supports_inconsistency')
    .map((item) => `${item.code}[${item.strength}]`)
    .join(', ');
  console.log(
    `  ${result.testCase.id}  ${result.verdict.state}/${result.verdict.confidence}  ${codes || '—'}`,
  );
  console.log(`    ${result.testCase.note}`);
}

function main(): void {
  const verbose = process.argv.includes('--verbose');
  const cases = loadCases(fixturesDir);
  const results = runCases(cases);
  const metrics = computeMetrics(results);

  // Ringkasannya datang dari `harness.ts`, bukan disusun di sini, karena angka-angka
  // yang sama dikutip `docs/USAGE.md` dan dijaga oleh test dokumentasi. Lihat komentar
  // pada `summaryLines`.
  for (const line of summaryLines(metrics)) console.log(line);

  if (metrics.falsePositives.length > 0) {
    console.log(`FALSE POSITIVE (${metrics.falsePositives.length}):`);
    for (const item of verbose
      ? metrics.falsePositives
      : metrics.falsePositives.slice(0, 25)) {
      printCase(item);
    }
    if (!verbose && metrics.falsePositives.length > 25) {
      console.log(`  ... dan ${metrics.falsePositives.length - 25} lagi (pakai --verbose)`);
    }
    console.log('');
  }

  if (verbose && metrics.falseNegatives.length > 0) {
    console.log(`FALSE NEGATIVE (${metrics.falseNegatives.length}):`);
    for (const item of metrics.falseNegatives) printCase(item);
    console.log('');
  }

  mkdirSync(reportsDir, { recursive: true });
  const markdownPath = join(reportsDir, 'corpus-report.md');
  writeFileSync(
    markdownPath,
    renderMarkdown(metrics, ALGORITHM_VERSION, PSL_VERSION),
    'utf8',
  );
  console.log(`laporan: ${markdownPath}`);

  if (!gatesPass(metrics)) {
    console.log('');
    console.log('RELEASE GATE GAGAL.');
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('Release gate lulus.');
  }
}

main();
