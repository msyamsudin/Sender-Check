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

/** Nama bobot bukti untuk pengguna. Engine memancarkan `strong`/`medium`/`weak`. */
export const STRENGTH_LABEL: Record<string, string> = {
  strong: 'kuat',
  medium: 'sedang',
  weak: 'lemah',
};

/**
 * Kalimat tetap tentang arti hasil autentikasi.
 *
 * Wajib muncul pada kasus Reply-To, dan alasannya bukan kelengkapan: justru karena SPF,
 * DKIM, dan DMARC semuanya lulus untuk domain pengirim, pengguna perlu tahu bahwa
 * kelulusan itu **tidak bertentangan** dengan temuan ini. Tanpa kalimat ini, temuan
 * "nama tidak sejalan" akan tampak bertabrakan dengan indikator keamanan yang sudah
 * dilihat pengguna di webmailnya, dan yang paling mungkin dikorbankan pengguna adalah
 * alat ini.
 */
export const AUTHENTICATION_CAVEAT =
  'Hasil autentikasi membuktikan domain pengirim, bukan nama yang ditampilkan.';

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

/**
 * Satu baris bukti, sudah berbentuk kalimat.
 *
 * `polarity` dan `strength` adalah nilai mentah engine, dan `trace` adalah bukti mentah yang
 * ditulis untuk pengembang. Ketiganya dibawa serta bukan untuk panel biasa: panel biasa sudah
 * menerjemahkan `polarity` dan `strength` menjadi label, dan `trace` memang tidak layak dibaca
 * pengguna. Yang membutuhkannya adalah mode diagnostik, dan sebelum berkas ini membawanya,
 * tidak ada satu pun jalur dari nilai itu ke layar — `toFinding` membuangnya, sehingga
 * `confidence`, `trace` decision table, dan `args` bukti hanya dapat dilihat dengan debugger.
 * Pola yang sama berulang di seluruh proyek ini: nilai yang dihitung lalu dibuang tidak dapat
 * dipakai untuk menjawab "kenapa hasilnya begini".
 */
export interface FindingEvidence {
  readonly code: string;
  readonly polarity: string;
  readonly strength: string;
  readonly sentence: string;
  /** Bukti mentah engine, mis. `"rise" ⊂ "risehq"`. Hanya untuk mode diagnostik. */
  readonly trace: string;
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
      trace: item.trace,
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

/**
 * Sebutan untuk pengirim yang tidak menampilkan nama sama sekali.
 *
 * Satu konstanta, bukan literal di tiap tempat. Sebelumnya ada dua bunyi untuk satu keadaan
 * yang sama: medan `Nama` di panel menulis `(tidak ditampilkan)`, sedangkan baris subjek di
 * atasnya menulis `(tanpa nama)` — sehingga satu email yang sama dapat memuat dua sebutan
 * berbeda untuk hal yang sama, dan pengguna tidak punya cara tahu keduanya berarti identik.
 * Kalimat yang disalin pasti menyimpang; itu sudah terjadi pada kalimat bukti, dan itu sebabnya
 * teks ini hanya ada di sini.
 *
 * Bunyinya sengaja "tidak ditampilkan", bukan "tanpa nama": arti `displayName: null` di engine
 * adalah **sumbernya tidak merender nama** (lihat `EmailIdentity` di `packages/core/src/types.ts`
 * dan `docs/USAGE.md`), bukan bahwa pengirimnya tidak punya nama. Sebutan yang menyiratkan
 * pilihan pengirim akan membuat alat ini terbaca seperti menuduh.
 *
 * Namanya `NO_NAME_LABEL`, bukan `NO_DISPLAY_NAME`, dan itu disengaja: `NO_DISPLAY_NAME` sudah
 * menjadi **kode rule** di engine (`ALL_RULE_CODES`). Dua arti berbeda dengan satu nama akan
 * lolos dari typecheck — keduanya string — dan sebuah test yang bermaksud memeriksa kode rule
 * akan memeriksa label ini tanpa gagal.
 */
export const NO_NAME_LABEL = '(tidak ditampilkan)';

/** `Nama <alamat>`, bentuk yang dipakai baik di judul blok maupun di baris ringkas. */
export function senderLabel(finding: SenderFinding): string {
  const label = finding.identity.displayName ?? NO_NAME_LABEL;
  return `${label} <${finding.identity.fromAddress}>`;
}
