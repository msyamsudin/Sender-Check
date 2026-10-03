/**
 * Dari halaman ke temuan yang siap ditampilkan.
 *
 * Berkas ini adalah satu-satunya tempat adapter dan engine dipertemukan di dalam ekstensi.
 * Isinya sengaja bebas DOM: ia hanya memanggil adapter pada antarmuka `DocumentLike` yang
 * sudah dipersempit, sehingga seluruh logikanya dapat diuji di Node memakai DOM tiruan —
 * tanpa jsdom, tanpa browser, dan tanpa memuat ekstensi sama sekali.
 *
 * Yang tidak dapat diuji dengan cara ini tetap sama seperti sebelumnya: apakah selectornya
 * benar untuk Gmail hari ini. Itu hanya terjawab oleh halaman sungguhan.
 */
import { analyze, type EmailIdentity, type State } from '@sender-check/core';
import {
  scanGmailInbox,
  scanGmailShowOriginal,
  type DocumentLike,
  type LocationLike,
} from '@sender-check/adapters';
import { toFinding, type SenderFinding } from '@sender-check/presentation';
import { classifyPage, type PageKind } from './view.ts';

export interface PageAnalysis {
  readonly kind: PageKind;
  /**
   * `false` berarti tidak ada yang dapat dibaca dari halaman ini.
   *
   * Ini bukan kesalahan: pada list view memang tidak ada yang dipindai, dan pada thread
   * yang DOM-nya berubah, hasil yang benar adalah tidak menampilkan apa pun. Panel yang
   * muncul dengan tebakan lebih buruk daripada panel yang tidak muncul.
   */
  readonly matched: boolean;
  readonly findings: readonly SenderFinding[];
  /**
   * Temuan yang paling layak ditampilkan, atau `null` bila tidak ada.
   *
   * Satu thread dapat memuat beberapa pengirim (pesan awal dan balasan). Panel hanya
   * menampilkan satu, yaitu yang paling perlu diperiksa; pemetaan tiap temuan ke elemen
   * pesannya sendiri adalah pekerjaan lanjutan, karena adapter sengaja mengembalikan data
   * dan bukan elemen DOM.
   */
  readonly primary: SenderFinding | null;
  readonly selectorUsed: string | null;
  /** Catatan diagnostik adapter, ditampilkan hanya di mode diagnostik. */
  readonly notes: readonly string[];
}

/**
 * Urutan kepentingan state untuk memilih temuan yang ditampilkan.
 *
 * `UNCLEAR` sengaja di atas `UNASSESSABLE`: yang pertama berarti ada klaim identitas yang
 * diperiksa tetapi buktinya bercampur, sedangkan yang kedua berarti memang tidak ada yang
 * dapat diperiksa. Menampilkan `UNASSESSABLE` lebih dulu akan menyembunyikan satu-satunya
 * temuan yang benar-benar punya isi.
 */
const SEVERITY: Record<State, number> = {
  INCONSISTENT: 3,
  UNCLEAR: 2,
  UNASSESSABLE: 1,
  CONSISTENT: 0,
};

export function pickPrimary(findings: readonly SenderFinding[]): SenderFinding | null {
  let best: SenderFinding | null = null;
  for (const finding of findings) {
    if (best === null || SEVERITY[finding.state] > SEVERITY[best.state]) best = finding;
  }
  return best;
}

/** Menganalisis halaman list view atau thread. */
function fromInbox(doc: DocumentLike): Omit<PageAnalysis, 'kind'> {
  const report = scanGmailInbox(doc);

  const findings = report.senders.map((sender) => {
    // `viaHint` diteruskan apa adanya, dan `gmailOwnWarning` berada di tingkat halaman
    // sehingga digabungkan di sini. Keduanya Tier A; tidak ada Tier B di DOM inbox.
    const identity: EmailIdentity = {
      displayName: sender.displayName,
      fromAddress: sender.fromAddress,
      ...(sender.viaHint !== undefined ? { gmailViaHint: sender.viaHint } : {}),
      gmailOwnWarning: report.gmailOwnWarning,
    };

    return toFinding(identity, analyze(identity));
  });

  return {
    matched: report.matched,
    findings,
    primary: pickPrimary(findings),
    selectorUsed: report.selectorUsed,
    notes: report.notes,
  };
}

/** Menganalisis halaman "Show original", satu-satunya sumber sinyal Tier B. */
function fromShowOriginal(doc: DocumentLike): Omit<PageAnalysis, 'kind'> {
  const report = scanGmailShowOriginal(doc);
  const identity = report.identity;

  const base = { selectorUsed: null, notes: report.notes };

  // Tanpa alamat From yang dapat diurai, tidak ada dasar untuk menilai. Engine pun akan
  // menolak, tetapi menghentikannya di sini membuat alasannya jelas dan tidak menghasilkan
  // temuan yang tampak seperti penilaian.
  if (!report.matched || identity === null || (identity.fromAddress ?? '').trim().length === 0) {
    return {
      ...base,
      matched: false,
      findings: [],
      primary: null,
      notes: [...report.notes, 'header From tidak terbaca, sehingga tidak ada yang dinilai'],
    };
  }

  const emailIdentity: EmailIdentity = {
    displayName: identity.displayName ?? null,
    fromAddress: identity.fromAddress ?? '',
    ...(identity.replyTo !== undefined ? { replyTo: identity.replyTo } : {}),
    ...(identity.returnPath !== undefined ? { returnPath: identity.returnPath } : {}),
    ...(identity.authenticationResults !== undefined
      ? { authenticationResults: identity.authenticationResults }
      : {}),
  };

  const finding = toFinding(emailIdentity, analyze(emailIdentity));

  return { ...base, matched: true, findings: [finding], primary: finding };
}

/**
 * Menganalisis halaman yang sedang dibuka.
 *
 * Tidak pernah melempar: halaman web adalah input yang tidak dapat dipercaya, dan content
 * script yang melempar akan diam di halaman yang paling tidak terduga. Yang menghentikan
 * analisis adalah jenis halamannya, bukan kegagalan.
 */
export function analyzePage(doc: DocumentLike, page: LocationLike): PageAnalysis {
  const kind = classifyPage(page);

  if (kind === 'show-original') return { kind, ...fromShowOriginal(doc) };

  if (kind === 'thread') return { kind, ...fromInbox(doc) };

  // List view dan halaman lain sengaja tidak menampilkan panel. Mengembalikan hasil kosong
  // lebih baik daripada menampilkan sesuatu yang tidak diminta pengguna.
  return { kind, matched: false, findings: [], primary: null, selectorUsed: null, notes: [] };
}
