/**
 * Isi panel, sebagai data — bukan sebagai DOM.
 *
 * Berkas ini memutuskan **apa yang ditampilkan**, dan `panel-view.ts` hanya menuangkannya
 * ke elemen. Pemisahan itu yang membuat isi panel dapat diuji di Node: tidak ada satu pun
 * `document` di sini, sehingga test dapat memeriksa kalimat, urutan, dan pilihan medan
 * tanpa browser dan tanpa jsdom.
 *
 * Tiga keputusan tampilan ada di berkas ini, dan ketiganya punya alasan:
 *
 * **1. Semua kalimat berasal dari `@sender-check/presentation`.** Panel tidak menyusun
 * kalimatnya sendiri, karena itu akan menjadi salinan ketiga dari teks yang sama.
 *
 * **2. Bukti diurutkan menurut kepentingan, bukan menurut urutan rule.** Engine memancarkan
 * bukti dalam urutan pemeriksaan, dan urutan itu masuk akal untuk mesin tetapi tidak untuk
 * manusia: pengguna perlu melihat yang menentang lebih dulu, baru konteks dari webmail,
 * lalu yang mendukung.
 *
 * **3. Disclaimer ikut pada setiap state, termasuk `CONSISTENT`.** `docs/DESIGN.md`
 * menetapkan itu, dan alasannya ada di `DISCLAIMER_LINES`.
 */
import type { State } from '@sender-check/core';
import {
  AUTHENTICATION_CAVEAT,
  DISCLAIMER_LINES,
  MARK,
  NO_NAME_LABEL,
  POLARITY_LABEL,
  STATE_TITLE,
  STRENGTH_LABEL,
  isContextNote,
  senderLabel,
  shortPolarity,
  type SenderFinding,
} from '@sender-check/presentation';
export interface PanelField {
  readonly label: string;
  readonly value: string;
}

export interface PanelReason {
  /** Polaritas singkat, untuk gaya: `inconsistency`, `consistency`, `context`, `neutral`. */
  readonly kind: string;
  /** Nama polaritas untuk pengguna, mis. `menentang`. */
  readonly label: string;
  /** Nama bobot untuk pengguna, mis. `kuat`. */
  readonly strength: string;
  readonly sentence: string;
  /** `true` bila ini keterangan dari webmail, bukan bagian dari penilaian. */
  readonly context: boolean;
}

export interface PanelModel {
  /** State mentah, dipakai untuk memberi gaya pada kartu. */
  readonly state: State;
  readonly mark: string;
  readonly title: string;
  /** `Nama <alamat>`, bentuk yang sama dengan yang dipakai skrip konsol. */
  readonly subject: string;
  readonly fields: readonly PanelField[];
  readonly reasons: readonly PanelReason[];
  /**
   * Kalimat hasil autentikasi, plus satu kalimat tetap tentang artinya.
   *
   * Kosong bila tidak ada informasi autentikasi sama sekali — dan itu memang keadaan Tier A
   * di DOM inbox, karena `Authentication-Results` hanya ada di halaman Show original.
   */
  readonly authentication: readonly string[];
  /**
   * Kalimat yang menyatakan batas halaman ini, atau `null`.
   *
   * Ada hanya pada state `UNASSESSABLE` di halaman thread: di situ panel memang tidak
   * menemukan klaim yang dapat diuji, dan pengguna berhak tahu **mengapa** — bukan hanya
   * bahwa tidak ada dasar.
   */
  readonly basis: string | null;
  /**
   * Langkah aman yang dapat dikerjakan pengguna, atau `null`.
   *
   * Ini bagian yang preventif: `UNASSESSABLE` berarti "belum dapat dipastikan", dan kalimat
   * yang hanya menyatakan itu terbaca seperti "tidak ada yang perlu dikhawatirkan". Yang
   * benar adalah sebaliknya — belum ada yang diperiksa — dan pengguna perlu tahu apa yang
   * harus dilakukan sebelum mempercayai email itu.
   */
  readonly guidance: string | null;
  readonly disclaimer: readonly string[];
}

/**
 * Kenapa panel tidak menilai, dalam bahasa pengguna.
 *
 * Satu kalimat tetap, bukan peta per alasan gate: seluruh alasan gate yang mungkin di
 * halaman thread berarti hal yang sama bagi pembaca — tidak ada klaim identitas yang dapat
 * diuji dari yang tampil di sini — dan menyebut nama token internal (`no_identity_claim`,
 * `personal_name_on_personal_domain`) kepada pengguna tidak menjelaskan apa pun.
 */
export const UNASSESSABLE_BASIS =
  'Nama yang ditampilkan tidak memuat klaim yang dapat diuji terhadap alamatnya, sehingga pengirim ini belum dapat dipastikan dari tampilan pesan.';

/**
 * Langkah aman untuk state `UNASSESSABLE`.
 *
 * Menyebut halaman "Show original" dengan namanya sendiri adalah satu-satunya cara pengguna
 * dapat memperoleh dasar penilaian, dan itu **tidak** memerlukan apa pun dari ekstensi:
 * halaman itu dirender Gmail, dan panel menilai ulang di sana. Ekstensi ini tidak mengambil
 * halaman itu sendiri — lihat catatan keputusan di `docs/DESIGN.md` D1.
 */
export const UNASSESSABLE_GUIDANCE =
  'Sebelum menekan tautan atau mengisi data di email ini, periksa header aslinya: menu ⋮ → "Tampilkan aslinya". Di halaman itu panel menilai ulang memakai "balas ke" dan hasil autentikasi.';

/** Urutan bobot untuk pengurutan. `strong` lebih dulu. */
const STRENGTH_ORDER: Record<string, number> = { strong: 0, medium: 1, weak: 2 };

/** Urutan polaritas untuk pengurutan: yang menentang lebih dulu. */
const POLARITY_ORDER: Record<string, number> = {
  inconsistency: 0,
  context: 1,
  consistency: 2,
  neutral: 3,
};

/**
 * Menyusun urutan bukti untuk manusia.
 *
 * Bukan sekadar kosmetik: pada kasus Reply-To, bukti `mendukung` (autentikasi lulus) muncul
 * dari rule yang dievaluasi lebih dulu, sehingga tanpa pengurutan panel akan membuka dengan
 * kalimat yang tampak menganulir temuannya sendiri.
 */
function orderReasons(finding: SenderFinding): PanelReason[] {
  const reasons: PanelReason[] = [];

  for (const item of finding.evidence) {
    const kind = shortPolarity(item.polarity);
    if (kind === 'neutral') continue;

    reasons.push({
      kind,
      label: POLARITY_LABEL[kind] ?? kind,
      strength: STRENGTH_LABEL[item.strength] ?? item.strength,
      sentence: item.sentence,
      context: isContextNote(item),
    });
  }

  return reasons.sort((a, b) => {
    const polarity = (POLARITY_ORDER[a.kind] ?? 9) - (POLARITY_ORDER[b.kind] ?? 9);
    if (polarity !== 0) return polarity;
    return (STRENGTH_ORDER[a.strength] ?? 9) - (STRENGTH_ORDER[b.strength] ?? 9);
  });
}

/**
 * Daftar medan identitas.
 *
 * Hanya medan yang benar-benar ada yang ditampilkan. Medan kosong yang ditampilkan sebagai
 * tanda hubung akan membuat pengguna mengira datanya hilang — padahal pada Tier A, Reply-To
 * memang tidak pernah ada di DOM, dan itu bukan kekurangan data melainkan batas sumbernya.
 *
 * Teks untuk nama yang tidak ada berasal dari `@sender-check/presentation`, sama dengan yang
 * dipakai baris subjek di atas daftar ini. Dulu keduanya menulis bunyi yang berbeda untuk
 * keadaan yang sama, dan `NO_NAME_LABEL` ada supaya itu tidak dapat terjadi lagi.
 */
function buildFields(finding: SenderFinding): PanelField[] {
  const { identity } = finding;
  const fields: PanelField[] = [
    { label: 'Nama', value: identity.displayName ?? NO_NAME_LABEL },
    { label: 'Alamat', value: identity.fromAddress },
  ];

  if (identity.replyTo !== undefined && identity.replyTo.length > 0) {
    fields.push({ label: 'Balas ke', value: identity.replyTo });
  }
  if (identity.returnPath !== undefined && identity.returnPath.length > 0) {
    fields.push({ label: 'Dikirim oleh', value: identity.returnPath });
  }

  return fields;
}

function buildAuthentication(finding: SenderFinding): string[] {
  const authEvidence = finding.evidence.filter((item) => item.code.startsWith('AUTH_'));
  const hasRawHeader = (finding.identity.authenticationResults ?? '').length > 0;

  if (authEvidence.length === 0 && !hasRawHeader) return [];

  // Kalimat tetapnya selalu ikut ketika ada informasi autentikasi, termasuk ketika semua
  // hasilnya lulus. Justru pada keadaan itulah kalimat ini paling dibutuhkan: pengguna
  // sudah melihat "aman" di webmailnya, dan temuan ini tampak bertentangan dengannya.
  return [...authEvidence.map((item) => item.sentence), AUTHENTICATION_CAVEAT];
}

/**
 * Isi panel dari satu temuan.
 *
 * `basis` dan `guidance` diisi hanya untuk state `UNASSESSABLE`: itulah satu-satunya state
 * yang berarti "belum ada yang diperiksa", dan karena itu satu-satunya yang perlu menjelaskan
 * mengapa, lalu menyebut langkah aman yang dapat dikerjakan pengguna.
 */
export function buildPanelModel(finding: SenderFinding): PanelModel {
  const unassessable = finding.state === 'UNASSESSABLE';

  return {
    state: finding.state,
    mark: MARK[finding.state],
    title: STATE_TITLE[finding.state],
    subject: senderLabel(finding),
    fields: buildFields(finding),
    reasons: orderReasons(finding),
    authentication: buildAuthentication(finding),
    basis: unassessable ? UNASSESSABLE_BASIS : null,
    guidance: unassessable ? UNASSESSABLE_GUIDANCE : null,
    disclaimer: DISCLAIMER_LINES,
  };
}
