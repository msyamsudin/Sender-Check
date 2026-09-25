/**
 * Pipeline analisis lengkap.
 *
 * Urutannya sengaja: normalisasi -> domain -> nama -> pencocokan -> gate -> rule ->
 * decision table. Gate berada SEBELUM rule, bukan sesudah, supaya engine benar-benar
 * berhenti menilai ketika tidak ada dasar — bukan menilai lalu membuang hasilnya.
 */
import { classify, summarize } from './classification/decision-table.ts';
import { analyzeMatches, type MatchAnalysis } from './evidence/matches.ts';
import { buildEvidence } from './evidence/rules.ts';
import { evaluateGate } from './evidence/gate.ts';
import { resolveIdentity } from './identity.ts';
import { analyzeName } from './name/analyzer.ts';
import { ALGORITHM_VERSION, DATA_UPDATED_AT } from './version.ts';
import type { EmailIdentity, Evidence, Verdict } from './types.ts';

const EMPTY_MATCHES: MatchAnalysis = {
  targets: [],
  registrableComponents: [],
  exactMatches: [],
  confusableMatches: [],
  foldMatches: [],
  hasAnyMatch: false,
};

/**
 * Membuang bukti yang benar-benar identik.
 *
 * Bukan sekadar kerapian: satu token dapat tercocokkan dengan beberapa target
 * sekaligus, dan menampilkan baris "mengapa" yang sama dua kali di panel membuat
 * pengguna kehilangan kepercayaan pada penjelasannya. Bukti dengan kode sama tetapi
 * trace berbeda tetap dipertahankan, karena keduanya memang informasi berbeda.
 */
function dedupeEvidence(evidence: readonly Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];

  for (const item of evidence) {
    const key = `${item.code}|${item.trace}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

/**
 * Analisis sinkron dan murni. Tidak ada I/O, tidak ada jam, tidak ada RNG, sehingga
 * hasilnya dapat direproduksi persis — syarat agar corpus test bermakna.
 */
export function analyze(input: EmailIdentity): Verdict {
  const identity = resolveIdentity(input);
  const name = analyzeName(identity.displayName);

  const matches =
    identity.fromParts === null || !name.hasDisplayName
      ? EMPTY_MATCHES
      : analyzeMatches(name, identity.localPart, identity.fromParts);

  const gate = evaluateGate({ identity, name, matches });

  const allEvidence = dedupeEvidence(buildEvidence(identity, name, matches));

  // Ketika gate tidak lolos, bukti pendukung/penentang dibuang dan hanya bukti
  // kontekstual yang disimpan. Alasannya: menampilkan "inkonsistensi" pada pesan
  // yang memang tidak dinilai akan menyesatkan pembaca panel.
  const evidence: readonly Evidence[] = gate.passed
    ? allEvidence
    : allEvidence.filter(
        (item) => item.polarity === 'context' || item.polarity === 'neutral',
      );

  const classification = classify(gate, summarize(evidence));

  return {
    state: classification.state,
    confidence: classification.confidence,
    evidence,
    gate,
    trace: classification.trace,
    algorithmVersion: `${ALGORITHM_VERSION}+data.${DATA_UPDATED_AT}`,
    pslVersion: identity.fromParts?.pslVersion ?? 'unknown',
  };
}

export { ALGORITHM_VERSION, DATA_UPDATED_AT };
