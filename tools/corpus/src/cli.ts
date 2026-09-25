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
  NAG_RATE_GATE,
  PRECISION_GATE,
  renderMarkdown,
  runCases,
  type CaseResult,
} from './harness.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');
const reportsDir = join(here, '..', 'reports');

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

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

  console.log('=== Sender-Check corpus ===');
  console.log(`algorithmVersion : ${ALGORITHM_VERSION}`);
  console.log(`pslVersion       : ${PSL_VERSION}`);
  console.log(`kasus            : ${metrics.total}`);
  console.log(
    `label            : legit ${metrics.byLabel.legit}, suspicious ${metrics.byLabel.suspicious}, unassessable ${metrics.byLabel.unassessable}`,
  );
  console.log('');
  console.log(`state            : ${Object.entries(metrics.byState).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log('');
  console.log(`precision (flagged HIGH) : ${percent(metrics.precisionHigh)}  (gate >= ${percent(PRECISION_GATE)})`);
  console.log(`precision (semua flagged): ${percent(metrics.precision)}`);
  console.log(`recall (suspicious)      : ${percent(metrics.recall)}`);
  console.log(`nag rate (visible)       : ${percent(metrics.nagRate)}  (gate <= ${percent(NAG_RATE_GATE)})`);
  console.log(`nag rate (wide)          : ${percent(metrics.nagRateWide)}`);
  console.log('');

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
