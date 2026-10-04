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
import type { PanelSource } from './panel-model.ts';
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
  /**
   * Verdikt mentah per temuan, untuk mode diagnostik.
   *
   * `SenderFinding` sengaja hanya memuat apa yang ditampilkan panel biasa — state,
   * confidence, dan kalimat buktinya — sehingga `gate`, seluruh baris `trace`,
   * `algorithmVersion`, dan `pslVersion` tidak dapat disusun ulang dari sana. Peta ini yang
   * membawanya, dan hanya pemanggil yang benar-benar membuka mode diagnostik yang membacanya.
   */
  readonly diagnosticSource: DiagnosticSources;
}

/**
 * Verdikt mentah setiap temuan, beserta metadata pembacaan halaman.
 *
 * Kuncinya adalah objek `SenderFinding` itu sendiri: temuan dan verdiktnya lahir dari satu
 * pemanggilan `analyze`, dan menyimpannya sebagai dua daftar paralel akan membuka peluang
 * keduanya tidak sinkron — peluang yang justru ingin ditutup oleh mode diagnostik.
 */
export type DiagnosticSources = ReadonlyMap<SenderFinding, PanelSource>;

/**
 * Peta kosong, dipakai bersama oleh setiap jalur yang tidak menghasilkan temuan.
 *
 * Satu konstanta, bukan `new Map()` di tiap tempat: peta kosong tidak pernah berubah, dan
 * membuat yang baru untuk setiap pemindaian hanya menambah alokasi pada jalur yang paling
 * sering berjalan — setiap mutasi DOM yang tidak menghasilkan temuan.
 */
const EMPTY_DIAGNOSTIC: DiagnosticSources = new Map();

/**
 * Verdikt mentah satu temuan, atau `null` bila tidak ada.
 *
 * Panel memanggil ini hanya ketika mode diagnostik aktif, sehingga biaya memetakannya tidak
 * pernah dibayar oleh pemakaian biasa.
 */
export function diagnosticSourceFor(
  analysis: PageAnalysis,
  finding: SenderFinding | null,
): PanelSource | null {
  if (finding === null) return null;
  return analysis.diagnosticSource.get(finding) ?? null;
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
  // `conversation` adalah inti kebenaran panel ini. Panel hanya muncul pada thread yang
  // terbuka, sehingga yang boleh dinilai hanyalah pengirim pesan di dalam percakapan itu.
  // Tanpa lingkup ini, chip penerima ("to saya"), avatar akun, dan sisa DOM lain di halaman
  // yang sama ikut menjadi calon pengirim — dan karena `pickPrimary` memilih temuan
  // terberat, panel dapat menampilkan orang yang sama untuk setiap email yang dibuka.
  const report = scanGmailInbox(doc, { scope: 'conversation' });
  const diagnosticSource = new Map<SenderFinding, PanelSource>();

  const findings = report.senders.map((sender) => {
    // `viaHint` diteruskan apa adanya, dan `gmailOwnWarning` berada di tingkat halaman
    // sehingga digabungkan di sini. Keduanya Tier A; tidak ada Tier B di DOM inbox.
    const identity: EmailIdentity = {
      displayName: sender.displayName,
      fromAddress: sender.fromAddress,
      ...(sender.viaHint !== undefined ? { gmailViaHint: sender.viaHint } : {}),
      gmailOwnWarning: report.gmailOwnWarning,
    };

    const verdict = analyze(identity);
    const finding = toFinding(identity, verdict);

    diagnosticSource.set(finding, {
      verdict,
      // `sourceSelector` adalah selector yang menghasilkan calon ini, dan ia lebih tepat
      // daripada `selectorUsed` untuk satu temuan tertentu pada halaman dengan beberapa
      // pengirim. Keduanya dicatat: `selectorUsed` menjawab "selector mana yang dipakai
      // halaman ini", `sourceSelector` menjawab "selector mana yang menghasilkan temuan ini".
      selectorUsed: sender.sourceSelector,
      notes: report.notes,
    });

    return finding;
  });

  const primary = pickPrimary(findings);

  return {
    matched: report.matched,
    findings,
    primary,
    selectorUsed: report.selectorUsed,
    notes: report.notes,
    diagnosticSource,
  };
}

/** Menganalisis halaman "Show original", satu-satunya sumber sinyal Tier B. */
function fromShowOriginal(doc: DocumentLike): Omit<PageAnalysis, 'kind'> {
  const report = scanGmailShowOriginal(doc);
  const identity = report.identity;

  const base = { selectorUsed: null, notes: report.notes, diagnosticSource: EMPTY_DIAGNOSTIC };

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

  const verdict = analyze(emailIdentity);
  const finding = toFinding(emailIdentity, verdict);

  // Halaman ini tidak punya selector: headernya dibaca dari satu blok teks, bukan dari
  // elemen per pengirim. `selectorUsed` karena itu `null`, dan itu memang jawabannya.
  const diagnosticSource = new Map<SenderFinding, PanelSource>([
    [finding, { verdict, selectorUsed: null, notes: report.notes }],
  ]);

  return { ...base, matched: true, findings: [finding], primary: finding, diagnosticSource };
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
  return {
    kind,
    matched: false,
    findings: [],
    primary: null,
    selectorUsed: null,
    notes: [],
    diagnosticSource: EMPTY_DIAGNOSTIC,
  };
}
