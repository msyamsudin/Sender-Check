/**
 * @sender-check/presentation — lapisan penyajian murni.
 *
 * Tanpa DOM, tanpa `chrome.*`, tanpa network, tanpa jam. Ia hanya menerjemahkan keluaran
 * engine menjadi kalimat dan struktur tampilan, sehingga skrip konsol, contoh pemakaian,
 * generator tabel rule, dan panel ekstensi menampilkan teks yang sama persis untuk verdikt
 * yang sama.
 *
 * Batas dengan engine sengaja tegas: engine memancarkan `code` + `args` dan tidak pernah
 * kalimat jadi. Batas dengan adapter juga tegas: lapisan ini tidak membaca DOM sama sekali,
 * sehingga dapat diuji di Node tanpa browser.
 */
export { describeRule, RULE_TEMPLATES } from './sentences.ts';
export type { Args, SentenceTemplate } from './sentences.ts';

export {
  AUTHENTICATION_CAVEAT,
  CONTEXT_NOTE_CODES,
  DISCLAIMER_LINES,
  MARK,
  NO_NAME_LABEL,
  POLARITY_LABEL,
  STATE_TITLE,
  STRENGTH_LABEL,
  contextNotes,
  isContextNote,
  senderLabel,
  shortPolarity,
  toFinding,
} from './finding.ts';
export type { FindingEvidence, SenderFinding } from './finding.ts';
