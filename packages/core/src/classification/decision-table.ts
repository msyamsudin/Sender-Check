/**
 * Decision Table.
 *
 * Dievaluasi berurutan; baris pertama yang cocok menentukan hasil. Ini disengaja:
 * alternatifnya adalah menjumlahkan bobot, dan begitu ada penjumlahan bobot maka
 * `phishingScore` sudah kembali ada — hanya dengan nama lain. Tabel yang eksplisit
 * dapat dibaca, diaudit, dan diuji baris per baris.
 */
import type {
  Confidence,
  DecisionTraceRow,
  Evidence,
  GateResult,
  RuleCode,
  State,
} from '../types.ts';

export interface EvidenceSummary {
  readonly strongInconsistency: number;
  readonly mediumInconsistency: number;
  readonly weakInconsistency: number;
  readonly strongConsistency: number;
  readonly mediumConsistency: number;
  readonly anyInconsistency: boolean;
  readonly anyConsistency: boolean;
  readonly codes: ReadonlySet<RuleCode>;
}

export function summarize(evidence: readonly Evidence[]): EvidenceSummary {
  let strongInconsistency = 0;
  let mediumInconsistency = 0;
  let weakInconsistency = 0;
  let strongConsistency = 0;
  let mediumConsistency = 0;
  const codes = new Set<RuleCode>();

  for (const item of evidence) {
    codes.add(item.code);

    if (item.polarity === 'supports_inconsistency') {
      if (item.strength === 'strong') strongInconsistency++;
      else if (item.strength === 'medium') mediumInconsistency++;
      else weakInconsistency++;
    } else if (item.polarity === 'supports_consistency') {
      if (item.strength === 'strong') strongConsistency++;
      else if (item.strength === 'medium') mediumConsistency++;
    }
  }

  return {
    strongInconsistency,
    mediumInconsistency,
    weakInconsistency,
    strongConsistency,
    mediumConsistency,
    anyInconsistency: strongInconsistency + mediumInconsistency + weakInconsistency > 0,
    anyConsistency: strongConsistency + mediumConsistency > 0,
    codes,
  };
}

export interface DecisionRow {
  readonly row: number;
  readonly condition: string;
  readonly test: (summary: EvidenceSummary, gate: GateResult) => boolean;
  readonly state: State;
  readonly confidence: Confidence;
}

export const DECISION_TABLE: readonly DecisionRow[] = [
  {
    row: 1,
    condition: 'gate gagal: tidak ada klaim identitas yang dapat diperiksa',
    test: (_summary, gate) => !gate.passed,
    state: 'UNASSESSABLE',
    confidence: 'LOW',
  },
  {
    row: 2,
    condition: 'tidak ada display name, atau domain milis',
    test: (summary) =>
      summary.codes.has('NO_DISPLAY_NAME') || summary.codes.has('MAILING_LIST_DOMAIN'),
    state: 'UNASSESSABLE',
    confidence: 'LOW',
  },
  {
    row: 3,
    condition: 'ada inkonsistensi kuat, tanpa konsistensi kuat',
    test: (summary) => summary.strongInconsistency > 0 && summary.strongConsistency === 0,
    state: 'INCONSISTENT',
    confidence: 'HIGH',
  },
  {
    row: 4,
    condition: 'inkonsistensi kuat dan konsistensi kuat muncul bersamaan',
    test: (summary) => summary.strongInconsistency > 0 && summary.strongConsistency > 0,
    state: 'UNCLEAR',
    confidence: 'MEDIUM',
  },
  {
    row: 5,
    condition: 'ada inkonsistensi menengah, tanpa inkonsistensi kuat',
    test: (summary) => summary.mediumInconsistency > 0 && summary.strongInconsistency === 0,
    state: 'UNCLEAR',
    confidence: 'MEDIUM',
  },
  {
    row: 6,
    condition: 'ada konsistensi kuat tanpa inkonsistensi apa pun',
    test: (summary) => summary.strongConsistency > 0 && !summary.anyInconsistency,
    state: 'CONSISTENT',
    confidence: 'HIGH',
  },
  {
    row: 7,
    condition: 'hanya konsistensi menengah, tanpa inkonsistensi',
    test: (summary) => summary.mediumConsistency > 0 && !summary.anyInconsistency,
    state: 'CONSISTENT',
    confidence: 'MEDIUM',
  },
  {
    row: 8,
    condition: 'hanya inkonsistensi lemah',
    test: (summary) => summary.weakInconsistency > 0,
    state: 'UNCLEAR',
    confidence: 'LOW',
  },
  {
    row: 9,
    condition: 'tidak ada bukti yang bermakna',
    test: () => true,
    state: 'UNASSESSABLE',
    confidence: 'LOW',
  },
];

export interface Classification {
  readonly state: State;
  readonly confidence: Confidence;
  readonly trace: readonly DecisionTraceRow[];
}

export function classify(gate: GateResult, summary: EvidenceSummary): Classification {
  const trace: DecisionTraceRow[] = [];

  for (const row of DECISION_TABLE) {
    const matched = row.test(summary, gate);
    trace.push({ row: row.row, condition: row.condition, matched });
    if (matched) {
      return { state: row.state, confidence: row.confidence, trace };
    }
  }

  // Baris terakhir selalu cocok, jadi ini tidak dapat tercapai. Dipertahankan
  // sebagai jaring pengaman agar perubahan tabel tidak pernah menghasilkan state
  // yang tidak terdefinisi.
  return { state: 'UNASSESSABLE', confidence: 'LOW', trace };
}
