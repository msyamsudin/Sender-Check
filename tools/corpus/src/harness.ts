/**
 * Corpus harness.
 *
 * Dijalankan di Node tanpa browser, karena engine memang dipisahkan dari adapter.
 * Efeknya besar: tuning presisi menjadi iterasi hitungan detik, bukan siklus
 * reload extension.
 *
 * Ground truth pada fixture adalah penilaian MANUSIA (`legit` / `suspicious` /
 * `unassessable`), bukan keluaran engine. Itu disengaja: kalau ekspektasi dihasilkan
 * oleh engine yang sedang diuji, pengujiannya tidak membuktikan apa pun.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, type EmailIdentity, type Verdict } from '@sender-check/core';

export type Label = 'legit' | 'suspicious' | 'unassessable';

export interface CorpusCase {
  readonly id: string;
  readonly label: Label;
  readonly category: string;
  readonly note: string;
  readonly identity: EmailIdentity;
}

export interface CaseResult {
  readonly testCase: CorpusCase;
  readonly verdict: Verdict;
  /** State INCONSISTENT, yaitu satu-satunya state yang muncul di list view. */
  readonly flagged: boolean;
  /** Sinyal apa pun yang mengarah ke ketidakcocokan, termasuk yang tidak terlihat user. */
  readonly hasInconsistencyEvidence: boolean;
}

export interface CategoryStats {
  readonly category: string;
  readonly total: number;
  readonly flagged: number;
  readonly suspicious: number;
}

export interface Metrics {
  readonly total: number;
  readonly byLabel: Readonly<Record<Label, number>>;
  readonly byState: Readonly<Record<string, number>>;
  readonly flaggedTotal: number;
  readonly flaggedHigh: number;
  /** Proporsi hasil flagged yang memang berlabel suspicious. Metrik utama. */
  readonly precision: number;
  readonly precisionHigh: number;
  /** Proporsi kasus suspicious yang berhasil di-flag. Metrik sekunder. */
  readonly recall: number;
  /** Proporsi kasus non-suspicious yang memunculkan sinyal VISIBLE. Target < 3%. */
  readonly nagRate: number;
  /** Proporsi kasus non-suspicious yang memunculkan sinyal apa pun, termasuk tak terlihat. */
  readonly nagRateWide: number;
  readonly falsePositives: readonly CaseResult[];
  readonly falseNegatives: readonly CaseResult[];
  readonly categories: readonly CategoryStats[];
}

export const PRECISION_GATE = 0.95;
export const NAG_RATE_GATE = 0.03;

/**
 * Urutan berkas menentukan urutan laporan.
 *
 * `adversarial.json` ditulis tangan khusus untuk menyerang rule lookalike: pola SAH
 * yang secara struktural mirip typosquat. `realworld.json` menyimpan pola serangan
 * yang dilaporkan pengguna. `coverage.json` mengisi celah yang ditemukan oleh test
 * kelengkapan katalog, yaitu kelas kasus yang belum terwakili sama sekali.
 *
 * Semuanya ikut di-gate: false positive justru paling sering muncul di kasus yang
 * tidak sengaja terpikirkan saat menulis corpus umum.
 */
const FIXTURE_FILES: readonly string[] = [
  'legit.json',
  'suspicious.json',
  'edge.json',
  'adversarial.json',
  'realworld.json',
  'coverage.json',
];


export function loadCases(fixturesDir: string): CorpusCase[] {
  const cases: CorpusCase[] = [];

  for (const file of FIXTURE_FILES) {
    const raw = readFileSync(join(fixturesDir, file), 'utf8');
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error(`${file} bukan array JSON`);
    }

    for (const entry of parsed) {
      cases.push(entry as CorpusCase);
    }
  }

  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) throw new Error(`id fixture duplikat: ${item.id}`);
    seen.add(item.id);
  }

  return cases;
}

export function runCases(cases: readonly CorpusCase[]): CaseResult[] {
  return cases.map((testCase) => {
    const verdict = analyze(testCase.identity);
    return {
      testCase,
      verdict,
      flagged: verdict.state === 'INCONSISTENT',
      hasInconsistencyEvidence: verdict.evidence.some(
        (item) => item.polarity === 'supports_inconsistency',
      ),
    };
  });
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

export function computeMetrics(results: readonly CaseResult[]): Metrics {
  const byLabel: Record<Label, number> = { legit: 0, suspicious: 0, unassessable: 0 };
  const byState: Record<string, number> = {};

  let flaggedTotal = 0;
  let flaggedHigh = 0;
  let flaggedSuspicious = 0;
  let flaggedHighSuspicious = 0;

  const nonSuspicious: CaseResult[] = [];
  const falsePositives: CaseResult[] = [];
  const falseNegatives: CaseResult[] = [];
  const categoryMap = new Map<string, { total: number; flagged: number; suspicious: number }>();

  for (const result of results) {
    byLabel[result.testCase.label]++;
    byState[result.verdict.state] = (byState[result.verdict.state] ?? 0) + 1;

    const bucket = categoryMap.get(result.testCase.category) ?? {
      total: 0,
      flagged: 0,
      suspicious: 0,
    };
    bucket.total++;
    if (result.flagged) bucket.flagged++;
    if (result.testCase.label === 'suspicious') bucket.suspicious++;
    categoryMap.set(result.testCase.category, bucket);

    if (result.testCase.label === 'suspicious') {
      if (result.flagged) flaggedSuspicious++;
      else falseNegatives.push(result);
    } else {
      nonSuspicious.push(result);
      if (result.flagged) falsePositives.push(result);
    }

    if (result.flagged) {
      flaggedTotal++;
      if (result.verdict.confidence === 'HIGH') {
        flaggedHigh++;
        if (result.testCase.label === 'suspicious') flaggedHighSuspicious++;
      }
    }
  }

  const nagVisible = nonSuspicious.filter((item) => item.flagged).length;
  const nagWide = nonSuspicious.filter((item) => item.hasInconsistencyEvidence).length;

  const categories: CategoryStats[] = [...categoryMap.entries()]
    .map(([category, bucket]) => ({ category, ...bucket }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));

  return {
    total: results.length,
    byLabel,
    byState,
    flaggedTotal,
    flaggedHigh,
    precision: ratio(flaggedSuspicious, flaggedTotal),
    precisionHigh: ratio(flaggedHighSuspicious, flaggedHigh),
    recall: ratio(flaggedSuspicious, byLabel.suspicious),
    nagRate: ratio(nagVisible, nonSuspicious.length),
    nagRateWide: ratio(nagWide, nonSuspicious.length),
    falsePositives,
    falseNegatives,
    categories,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function describe(result: CaseResult): string {
  const { testCase, verdict } = result;
  const codes = verdict.evidence
    .filter((item) => item.polarity === 'supports_inconsistency')
    .map((item) => `${item.code}[${item.strength}]`)
    .join(', ');
  return [
    `| \`${testCase.id}\` | ${testCase.category} | ${verdict.state}/${verdict.confidence} |`,
    `${codes.length > 0 ? codes : '—'} | ${testCase.note} |`,
  ].join(' ');
}

export function renderMarkdown(metrics: Metrics, algorithmVersion: string, pslVersion: string): string {
  const lines: string[] = [];

  lines.push('# Laporan Corpus Sender-Check');
  lines.push('');
  lines.push(`- algorithmVersion: \`${algorithmVersion}\``);
  lines.push(`- pslVersion: \`${pslVersion}\``);
  lines.push(`- total kasus: **${metrics.total}**`);
  lines.push(
    `- label: legit ${metrics.byLabel.legit}, suspicious ${metrics.byLabel.suspicious}, unassessable ${metrics.byLabel.unassessable}`,
  );
  lines.push('');
  lines.push('## Release gate');
  lines.push('');
  lines.push('| Gate | Ambang | Nilai | Status |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| Precision INCONSISTENT+HIGH | >= ${percent(PRECISION_GATE)} | ${percent(metrics.precisionHigh)} | ${metrics.precisionHigh >= PRECISION_GATE ? 'LULUS' : 'GAGAL'} |`,
  );
  lines.push(
    `| Nag rate (non-suspicious) | <= ${percent(NAG_RATE_GATE)} | ${percent(metrics.nagRate)} | ${metrics.nagRate <= NAG_RATE_GATE ? 'LULUS' : 'GAGAL'} |`,
  );
  lines.push('');
  lines.push('## Metrik');
  lines.push('');
  lines.push('| Metrik | Nilai |');
  lines.push('|---|---|');
  lines.push(`| Flagged (INCONSISTENT) | ${metrics.flaggedTotal} |`);
  lines.push(`| Flagged + HIGH | ${metrics.flaggedHigh} |`);
  lines.push(`| Precision (semua flagged) | ${percent(metrics.precision)} |`);
  lines.push(`| Precision (flagged HIGH) | ${percent(metrics.precisionHigh)} |`);
  lines.push(`| Recall (suspicious) | ${percent(metrics.recall)} |`);
  lines.push(`| Nag rate visible | ${percent(metrics.nagRate)} |`);
  lines.push(`| Nag rate wide (termasuk tak terlihat) | ${percent(metrics.nagRateWide)} |`);
  lines.push('');
  lines.push('## Sebaran state');
  lines.push('');
  lines.push('| State | Jumlah |');
  lines.push('|---|---|');
  for (const [state, count] of Object.entries(metrics.byState).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${state} | ${count} |`);
  }
  lines.push('');
  lines.push('## Per kategori');
  lines.push('');
  lines.push('| Kategori | Total | Suspicious | Flagged |');
  lines.push('|---|---|---|---|');
  for (const item of metrics.categories) {
    lines.push(`| ${item.category} | ${item.total} | ${item.suspicious} | ${item.flagged} |`);
  }

  lines.push('');
  lines.push(`## False positive (${metrics.falsePositives.length})`);
  lines.push('');
  lines.push('Kasus yang TIDAK suspicious tetapi di-flag. Inilah yang harus ditekan sampai nol.');
  lines.push('');
  if (metrics.falsePositives.length === 0) {
    lines.push('Tidak ada.');
  } else {
    lines.push('| id | kategori | hasil | bukti | catatan |');
    lines.push('|---|---|---|---|---|');
    for (const item of metrics.falsePositives) lines.push(describe(item));
  }

  lines.push('');
  lines.push(`## False negative (${metrics.falseNegatives.length})`);
  lines.push('');
  lines.push('Kasus suspicious yang tidak di-flag. Diterima selama precision belum stabil.');
  lines.push('');
  if (metrics.falseNegatives.length === 0) {
    lines.push('Tidak ada.');
  } else {
    lines.push('| id | kategori | hasil | bukti | catatan |');
    lines.push('|---|---|---|---|---|');
    for (const item of metrics.falseNegatives) lines.push(describe(item));
  }

  lines.push('');
  return lines.join('\n');
}

export function gatesPass(metrics: Metrics): boolean {
  return metrics.precisionHigh >= PRECISION_GATE && metrics.nagRate <= NAG_RATE_GATE;
}
