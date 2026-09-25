import { describe, expect, it } from 'vitest';
import { DECISION_TABLE, classify, summarize } from '../src/classification/decision-table.ts';
import type { Evidence, GateResult, Polarity, RuleCode, Strength } from '../src/types.ts';

function evidence(
  polarity: Polarity,
  strength: Strength,
  code: RuleCode = 'LOOKALIKE_NEAR_MISS',
): Evidence {
  return { code, polarity, strength, tier: 'A', args: {}, trace: 'uji' };
}

const PASSED_GATE: GateResult = { passed: true, claim: 'token_matches_address', reason: 'claim_found' };
const FAILED_GATE: GateResult = { passed: false, claim: null, reason: 'no_identity_claim' };

function classifyWith(items: readonly Evidence[], gate: GateResult = PASSED_GATE) {
  return classify(gate, summarize(items));
}

function matchedRow(items: readonly Evidence[], gate: GateResult = PASSED_GATE): number {
  const trace = classifyWith(items, gate).trace;
  const matched = trace.find((row) => row.matched);
  if (matched === undefined) throw new Error('tidak ada baris yang cocok');
  return matched.row;
}

describe('decision table: setiap baris dapat dicapai dan punya perilaku yang benar', () => {
  it('baris 1 — gate gagal selalu UNASSESSABLE, apa pun buktinya', () => {
    // Bukti kuat sekalipun tidak boleh menembus gate. Ini yang menjaga engine
    // berhenti menilai ketika memang tidak ada dasar.
    const items = [evidence('supports_inconsistency', 'strong')];
    const result = classifyWith(items, FAILED_GATE);
    expect(result.state).toBe('UNASSESSABLE');
    expect(matchedRow(items, FAILED_GATE)).toBe(1);
  });

  it('baris 2 — tanpa display name atau domain milis adalah UNASSESSABLE', () => {
    const noName = [evidence('context', 'weak', 'NO_DISPLAY_NAME')];
    expect(classifyWith(noName).state).toBe('UNASSESSABLE');
    expect(matchedRow(noName)).toBe(2);

    const mailingList = [evidence('context', 'weak', 'MAILING_LIST_DOMAIN')];
    expect(classifyWith(mailingList).state).toBe('UNASSESSABLE');
  });

  it('baris 3 — inkonsistensi kuat tanpa konsistensi kuat adalah INCONSISTENT/HIGH', () => {
    const items = [evidence('supports_inconsistency', 'strong')];
    const result = classifyWith(items);
    expect(result.state).toBe('INCONSISTENT');
    expect(result.confidence).toBe('HIGH');
    expect(matchedRow(items)).toBe(3);
  });

  it('baris 4 — inkonsistensi kuat bersama konsistensi kuat adalah UNCLEAR/MEDIUM', () => {
    const items = [
      evidence('supports_inconsistency', 'strong'),
      evidence('supports_consistency', 'strong', 'DISPLAY_NAME_MATCHES_LOCALPART_EXACT'),
    ];
    const result = classifyWith(items);
    expect(result.state).toBe('UNCLEAR');
    expect(result.confidence).toBe('MEDIUM');
    expect(matchedRow(items)).toBe(4);
  });

  it('baris 5 — inkonsistensi menengah saja adalah UNCLEAR/MEDIUM', () => {
    const items = [evidence('supports_inconsistency', 'medium', 'AUTH_DMARC_FAIL')];
    const result = classifyWith(items);
    expect(result.state).toBe('UNCLEAR');
    expect(matchedRow(items)).toBe(5);
  });

  it('baris 5 — authentication gagal tidak pernah sendirian menjadi INCONSISTENT', () => {
    // DMARC fail mengautentikasi DOMAIN, bukan display name. Menjadikannya bukti kuat
    // akan mengklaim lebih banyak daripada yang benar-benar diketahui.
    const items = [evidence('supports_inconsistency', 'medium', 'AUTH_DMARC_FAIL')];
    expect(classifyWith(items).state).not.toBe('INCONSISTENT');
  });

  it('baris 6 — konsistensi kuat tanpa inkonsistensi adalah CONSISTENT/HIGH', () => {
    const items = [evidence('supports_consistency', 'strong', 'DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL')];
    const result = classifyWith(items);
    expect(result.state).toBe('CONSISTENT');
    expect(result.confidence).toBe('HIGH');
    expect(matchedRow(items)).toBe(6);
  });

  it('baris 7 — konsistensi menengah tanpa inkonsistensi adalah CONSISTENT/MEDIUM', () => {
    const items = [evidence('supports_consistency', 'medium', 'DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL')];
    const result = classifyWith(items);
    expect(result.state).toBe('CONSISTENT');
    expect(result.confidence).toBe('MEDIUM');
    expect(matchedRow(items)).toBe(7);
  });

  it('baris 8 — inkonsistensi lemah saja adalah UNCLEAR/LOW', () => {
    const items = [evidence('supports_inconsistency', 'weak', 'DIGIT_SUBSTITUTION_MATCH')];
    const result = classifyWith(items);
    expect(result.state).toBe('UNCLEAR');
    expect(result.confidence).toBe('LOW');
    expect(matchedRow(items)).toBe(8);
  });

  it('baris 8 — konsistensi menengah bersama inkonsistensi lemah tidak menjadi CONSISTENT', () => {
    const items = [
      evidence('supports_consistency', 'medium', 'DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL'),
      evidence('supports_inconsistency', 'weak', 'TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL'),
    ];
    expect(classifyWith(items).state).toBe('UNCLEAR');
  });

  it('baris 9 — bukti kontekstual saja adalah UNASSESSABLE', () => {
    const items = [
      evidence('context', 'weak', 'PUNYCODE_DOMAIN'),
      evidence('context', 'weak', 'HUMAN_NAME_PATTERN'),
    ];
    const result = classifyWith(items);
    expect(result.state).toBe('UNASSESSABLE');
    expect(matchedRow(items)).toBe(9);
  });

  it('tidak ada bukti sama sekali adalah UNASSESSABLE, bukan INCONSISTENT', () => {
    // Ketiadaan bukti bukan bukti ketidakcocokan. Kesalahan ini akan mengubah seluruh
    // inbox menjadi kuning.
    expect(classifyWith([]).state).toBe('UNASSESSABLE');
  });
});

describe('decision table: properti struktural', () => {
  it('selalu berhenti pada baris terakhir yang cocok secara universal', () => {
    const last = DECISION_TABLE[DECISION_TABLE.length - 1];
    expect(last).toBeDefined();
    expect(last?.test(summarize([]), PASSED_GATE)).toBe(true);
  });

  it('nomor baris berurutan mulai dari 1', () => {
    DECISION_TABLE.forEach((row, index) => expect(row.row).toBe(index + 1));
  });

  it('setiap baris punya kondisi yang dapat dibaca manusia', () => {
    for (const row of DECISION_TABLE) {
      expect(row.condition.length, `baris ${row.row}`).toBeGreaterThan(10);
    }
  });

  it('jejak evaluasi dihentikan pada baris yang cocok', () => {
    const result = classifyWith([evidence('supports_inconsistency', 'strong')]);
    expect(result.trace).toHaveLength(3);
    expect(result.trace[2]?.matched).toBe(true);
  });

  it('state selalu salah satu dari empat nilai yang didefinisikan', () => {
    const allowed = new Set(['CONSISTENT', 'UNCLEAR', 'INCONSISTENT', 'UNASSESSABLE']);
    const samples: Evidence[][] = [
      [],
      [evidence('supports_inconsistency', 'strong')],
      [evidence('supports_consistency', 'strong', 'DISPLAY_NAME_MATCHES_LOCALPART_EXACT')],
      [evidence('context', 'weak')],
    ];
    for (const items of samples) {
      expect(allowed.has(classifyWith(items).state)).toBe(true);
    }
  });
});

describe('ringkasan bukti', () => {
  it('memisahkan polarity dan strength dengan benar', () => {
    const summary = summarize([
      evidence('supports_inconsistency', 'strong'),
      evidence('supports_inconsistency', 'strong'),
      evidence('supports_inconsistency', 'medium'),
      evidence('supports_inconsistency', 'weak'),
      evidence('supports_consistency', 'strong', 'DISPLAY_NAME_MATCHES_LOCALPART_EXACT'),
      evidence('context', 'weak'),
      evidence('neutral', 'weak'),
    ]);

    expect(summary.strongInconsistency).toBe(2);
    expect(summary.mediumInconsistency).toBe(1);
    expect(summary.weakInconsistency).toBe(1);
    expect(summary.strongConsistency).toBe(1);
    expect(summary.mediumConsistency).toBe(0);
    expect(summary.anyInconsistency).toBe(true);
    expect(summary.anyConsistency).toBe(true);
  });

  it('bukti kontekstual tidak pernah menggerakkan state', () => {
    const summary = summarize([
      evidence('context', 'weak', 'PUNYCODE_DOMAIN'),
      evidence('neutral', 'weak', 'GENERIC_TOKEN_ONLY_DISPLAYNAME'),
    ]);
    expect(summary.anyInconsistency).toBe(false);
    expect(summary.anyConsistency).toBe(false);
  });
});
