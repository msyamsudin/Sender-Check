/**
 * Model penyajian sebuah verdikt.
 *
 * Berkas ini menjawab satu pertanyaan: **apa yang ditampilkan kepada pengguna**, terpisah
 * dari apa yang dihitung engine. Pemisahan itu bukan formalitas — `docs/DESIGN.md` bagian 9
 * menetapkan bahwa panel tidak pernah menampilkan subjek atau isi pesan, bahwa baris
 * autentikasi wajib muncul pada kasus Reply-To, dan bahwa disclaimer harus permanen di
 * semua state. Semuanya keputusan tampilan, dan tidak satu pun boleh bocor ke engine.
 *
 * Sebelumnya model ini hidup di dalam skrip konsol, sehingga tidak ada tempat bagi panel
 * ekstensi untuk memakainya tanpa menyalinnya. Yang disalin pasti menyimpang; itu sudah
 * terjadi pada kalimat bukti (lihat `sentences.ts`).
 */
import type { Confidence, EmailIdentity, Evidence, State, Verdict } from '@sender-check/core';
import { describeRule } from './sentences.ts';

/**
 * Lambang per state untuk tampilan yang tidak dapat memakai warna.
 *
 * Bentuknya sengaja dipisahkan dari `state` mentah: `INCONSISTENT` adalah istilah internal,
 * dan pengguna tidak perlu mempelajarinya untuk memahami pesannya.
 */
export const MARK: Record<State, string> = {
  INCONSISTENT: '⚠',
  UNCLEAR: '·',
  CONSISTENT: '✓',
  UNASSESSABLE: '?',
};

/**
 * Judul singkat per state.
 *
 * Setiap judul menyatakan **apa yang engine ketahui**, bukan apa yang harus dilakukan
 * pengguna. "Nama tidak sejalan dengan alamat" dapat diperiksa; "email berbahaya" tidak,
 * dan engine memang tidak pernah menyimpulkan itu.
 */
export const STATE_TITLE: Record<State, string> = {
  INCONSISTENT: 'Nama pengirim tidak sejalan dengan alamatnya',
  UNCLEAR: 'Nama pengirim belum dapat dipastikan',
  CONSISTENT: 'Nama pengirim sejalan dengan alamatnya',
  UNASSESSABLE: 'Tidak ada dasar untuk menilai pengirim ini',
};

/**
 * Disclaimer permanen.
 *
 * Dua baris, dan keduanya wajib tampil di **semua** state termasuk `CONSISTENT`. Baris
 * kedua ada karena alasan yang berbeda dari yang pertama: tanpa itu, pengguna yang membaca
 * "tidak sejalan" akan menyimpulkan "berbahaya", dan engine tidak pernah menyimpulkan itu.
 * Risiko over-trust terbesar justru ada di `CONSISTENT`, karena di sana tidak ada apa pun
 * yang terlihat perlu dipertanyakan.
 */
export const DISCLAIMER_LINES: readonly string[] = [
  'Keselarasan nama dan alamat bukan bukti keaslian.',
  'Temuan ini bukan bukti bahwa emailnya berbahaya.',
];

/**
 * Membuang awalan `supports_` dari polarity.
 *
 * Engine memancarkan `supports_inconsistency`; tampilan memakai `inconsistency`. Konversi
 * ini harus terjadi di **satu** tempat: pernah ada dua jalur yang berbeda — satu menyaring
 * lewat fungsi ini dan satu membandingkan string mentah — dan ketika keduanya tidak
 * sinkron, seluruh bukti `menentang` hilang tanpa satu pun error.
 */
export function shortPolarity(polarity: string): string {
  return polarity.replace('supports_', '');
}

/** Nama polarity untuk pengguna. */
export const POLARITY_LABEL: Record<string, string> = {
  consistency: 'mendukung',
  inconsistency: 'menentang',
  context: 'konteks',
  neutral: 'netral',
};

/**
 * Kode bukti yang tetap ditampilkan sebagai keterangan konteks walaupun verdiktnya bukan
 * `INCONSISTENT`.
 *
 * Keduanya penting justru ketika engine memilih tidak menilai: bila webmail sendiri
 * menandai pesan ("via", peringatan pengirim), keterangan itu tidak boleh hilang hanya
 * karena tidak ada yang bisa dibandingkan.
 *
 * Daftar ini ada di lapisan tampilan, bukan di engine — engine tetap memancarkan semua
 * bukti dan tidak tahu apa yang ditampilkan.
 */
export const CONTEXT_NOTE_CODES: readonly string[] = [
  'GMAIL_VIA_ESP_HINT',
  'GMAIL_OWN_WARNING_PRESENT',
];

/** Satu baris bukti, sudah berbentuk kalimat. */
export interface FindingEvidence {
  readonly code: string;
  readonly polarity: string;
  readonly strength: string;
  readonly sentence: string;
}

/** Satu pengirim, siap ditampilkan. */
export interface SenderFinding {
  readonly identity: EmailIdentity;
  readonly state: State;
  readonly confidence: Confidence;
  /** Klaim yang lolos gate, atau alasan gate menolak menilai. */
  readonly gate: string;
  readonly evidence: readonly FindingEvidence[];
}

/**
 * Menerjemahkan verdikt menjadi sesuatu yang dapat ditampilkan.
 *
 * Kalimatnya dibentuk di sini, sekali, sehingga skrip konsol dan panel ekstensi tidak
 * mungkin menampilkan teks yang berbeda untuk verdikt yang sama.
 */
export function toFinding(identity: EmailIdentity, verdict: Verdict): SenderFinding {
  return {
    identity,
    state: verdict.state,
    confidence: verdict.confidence,
    gate: verdict.gate.passed ? (verdict.gate.claim ?? 'lolos') : verdict.gate.reason,
    evidence: verdict.evidence.map((item: Evidence) => ({
      code: item.code,
      polarity: item.polarity,
      strength: item.strength,
      sentence: describeRule(item.code, item.args, item.trace),
    })),
  };
}

/** `true` bila baris ini keterangan konteks, bukan bagian dari penilaian. */
export function isContextNote(item: FindingEvidence): boolean {
  return shortPolarity(item.polarity) === 'context' && CONTEXT_NOTE_CODES.includes(item.code);
}

/** Keterangan konteks, sudah lengkap dengan kode rule untuk mode diagnostik. */
export function contextNotes(evidence: readonly FindingEvidence[]): string[] {
  return evidence.filter(isContextNote).map((item) => `${item.sentence} (${item.code})`);
}

/** `Nama <alamat>`, bentuk yang dipakai baik di judul blok maupun di baris ringkas. */
export function senderLabel(finding: SenderFinding): string {
  const label = finding.identity.displayName ?? '(tanpa nama)';
  return `${label} <${finding.identity.fromAddress}>`;
}
