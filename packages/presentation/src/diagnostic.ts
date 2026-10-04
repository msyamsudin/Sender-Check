/**
 * Mode diagnostik: nilai yang dihitung engine, dalam bentuk yang dapat ditampilkan.
 *
 * ## Kenapa berkas ini ada
 *
 * `Verdict` sudah memuat jauh lebih banyak daripada yang pernah sampai ke layar:
 * `confidence`, `gate.claim`, `gate.reason`, seluruh baris `trace`, `algorithmVersion`, dan
 * `pslVersion`. Tidak satu pun punya jalur ke DOM. `toFinding` — satu-satunya jembatan antara
 * engine dan tampilan — merangkum `gate` menjadi satu string dan membuang sisanya, sehingga
 * pertanyaan yang paling sering muncul saat alat ini dipakai pada inbox nyata, "kenapa email
 * ini tidak ditandai apa-apa?", hanya dapat dijawab dengan debugger.
 *
 * Dua nilai dalam `Verdict` bahkan tidak pernah dipakai sama sekali oleh lapisan mana pun:
 * `algorithmVersion` dan `pslVersion` diminta oleh `docs/DESIGN.md` bagian 9 untuk mode
 * diagnostik, tetapi tidak ada kode yang membacanya. Berkas ini yang membacanya.
 *
 * ## Kenapa bentuknya datar dan sudah berupa string
 *
 * Struktur di sini adalah struktur yang **digambar**, bukan struktur engine. Setiap nilai
 * yang berupa enum sudah disertai labelnya, karena penamaan itu satu-satunya hal yang tidak
 * dapat diturunkan oleh lapisan tampilan: tidak ada cara yang aman untuk mengubah
 * `personal_name_on_personal_domain` menjadi kalimat di dalam `panel-view.ts` tanpa
 * menyalin daftar alasan gate ke tempat kedua. Daftar yang disalin pasti menyimpang — itu
 * sudah terjadi pada kalimat bukti, dan itu sebabnya kalimat bukti hanya hidup di
 * `sentences.ts`.
 *
 * Nilai mentahnya tetap dibawa di samping labelnya. Diagnostik yang hanya menampilkan
 * terjemahan tidak akan cocok dengan `Verdict` yang sedang di-debug, dan itu membuatnya
 * tidak berguna justru pada saat ia dibutuhkan.
 *
 * ## Kenapa terpisah dari `finding.ts`
 *
 * `toFinding(identity, verdict)` hanya menerima verdikt, sedangkan diagnostik juga memuat
 * hal-hal yang hanya diketahui pemanggil: `selectorUsed` dan `notes` dari adapter. Karena
 * itu diagnostik dibentuk oleh pemanggil, bukan disisipkan ke dalam `SenderFinding`.
 */
import type { EmailIdentity, Evidence, Verdict } from '@sender-check/core';
import { resolveProvenance } from '@sender-check/core';
import { describeRule } from './sentences.ts';

/** Satu nilai diagnostik: nama internalnya, dan nilainya. */
export interface DiagnosticRow {
  readonly label: string;
  readonly value: string;
}

/** Satu baris `DecisionTraceRow`, sudah diterjemahkan dan ditandai pemenangnya. */
export interface DiagnosticTraceRow {
  readonly row: number;
  readonly condition: string;
  readonly matched: boolean;
  /** `true` hanya pada baris pertama yang cocok — baris yang menentukan hasilnya. */
  readonly winner: boolean;
}

/** Satu baris bukti sebagaimana engine memancarkannya, tanpa penyaringan. */
export interface DiagnosticEvidenceRow {
  readonly code: string;
  readonly polarity: string;
  readonly strength: string;
  readonly tier: 'A' | 'B';
  /** Kalimat yang dipakai panel biasa, atau `null` bila polaritasnya `neutral`. */
  readonly sentence: string | null;
  /** Bukti mentah engine, mis. `"rise" ⊂ "risehq"`. */
  readonly trace: string;
  /** `args` yang dipakai template. Inilah yang membuat kalimatnya dapat diperiksa. */
  readonly args: Readonly<Record<string, string | number>>;
}

export interface FindingDiagnostic {
  readonly summary: readonly DiagnosticRow[];
  readonly gate: readonly DiagnosticRow[];
  /**
   * Seluruh baris decision table yang dievaluasi, bukan hanya yang menang.
   *
   * Baris setelah pemenang tidak pernah dievaluasi, dan itu memang jawabannya: yang perlu
   * terlihat adalah baris mana yang menang **dan** baris mana yang diperiksa sebelum itu.
   */
  readonly trace: readonly DiagnosticTraceRow[];
  /** Indeks baris pemenang pada `trace`, atau `null` bila tidak ada yang cocok. */
  readonly traceWinner: number | null;
  readonly evidence: readonly DiagnosticEvidenceRow[];
}

/**
 * Metadata pembacaan halaman, yang hanya diketahui adapter.
 *
 * Semuanya opsional karena skrip konsol dan panel ekstensi memilikinya pada tingkat yang
 * berbeda: `selectorUsed` ada untuk inbox dan tidak ada untuk halaman Show original, dan
 * `notes` ada untuk keduanya.
 */
export interface DiagnosticSource {
  /** Selector yang benar-benar menghasilkan pengirim. `null` = tidak ada. */
  readonly selectorUsed?: string | null;
  readonly notes?: readonly string[];
}

/** Label state. Istilahnya tetap istilah internal: mode ini untuk pengembang. */
export const STATE_CODE: Record<string, string> = {
  CONSISTENT: 'CONSISTENT',
  UNCLEAR: 'UNCLEAR',
  INCONSISTENT: 'INCONSISTENT',
  UNASSESSABLE: 'UNASSESSABLE',
};

/** Label provenance: dari halaman mana data identitasnya dibaca. */
export const PROVENANCE_LABEL: Record<string, string> = {
  'dom-inbox': 'dom-inbox (thread, Tier A saja)',
  'dom-original': 'dom-original (halaman header, Tier A + B)',
};

/**
 * Alasan gate tidak menilai.
 *
 * `personal_name_on_personal_domain` dan `no_identity_claim` sengaja dibedakan — lihat
 * komentar `evaluateGate` di `packages/core/src/evidence/gate.ts`. Di panel biasa keduanya
 * tampil identik karena bagi pengguna keduanya berarti hal yang sama; di sini perbedaannya
 * justru yang dicari, dan sebelum mode ini ada, pembedaan itu tidak pernah terpakai.
 */
export const GATE_REASON_LABEL: Record<string, string> = {
  claim_found: 'claim_found (ada klaim identitas yang dapat diperiksa)',
  no_display_name: 'no_display_name (webmail tidak merender nama sama sekali)',
  no_identity_claim: 'no_identity_claim (tidak ada token identitas pada nama)',
  mailing_list_domain: 'mailing_list_domain (domain milis, tidak dinilai)',
  personal_name_on_personal_domain:
    'personal_name_on_personal_domain (nama orang biasa, tidak ada klaim)',
};

/**
 * Klaim yang lolos gate.
 *
 * `G1`–`G7` adalah penomoran pada `docs/DESIGN.md` bagian 5, dan urutannya adalah urutan
 * pemeriksaan di `evaluateGate`: gerbang pertama yang cocok menang, sehingga klaim yang
 * muncul di sini sekaligus menjawab "gerbang mana yang lebih dulu menyala".
 */
export const CLAIM_LABEL: Record<string, string> = {
  embeds_address: 'G1 embeds_address',
  embeds_domain_token: 'G2 embeds_domain_token',
  token_confusable_to_address: 'G3/G4 token_confusable_to_address',
  token_matches_address: 'G3/G4 token_matches_address',
  organization_claim_on_freemail: 'G5 organization_claim_on_freemail',
  reply_to_asserts_identity: 'G7 reply_to_asserts_identity',
  organization_claim_on_domain: 'G6 organization_claim_on_domain',
};

/** Label polaritas. Nilai mentahnya dipertahankan, karena inilah yang dipakai engine. */
export const POLARITY_CODE: Record<string, string> = {
  supports_inconsistency: 'supports_inconsistency',
  supports_consistency: 'supports_consistency',
  context: 'context',
  neutral: 'neutral',
};

/** Label kekuatan bukti. */
export const STRENGTH_CODE: Record<string, string> = {
  strong: 'strong',
  medium: 'medium',
  weak: 'weak',
};

/**
 * Kalimat bukti untuk satu kode, atau `null`.
 *
 * `neutral` sengaja tidak diberi kalimat: panel biasa membuang bukti netral, dan kalimatnya
 * akan terbaca seolah ia ikut dinilai. Di mode diagnostik barisnya tetap muncul, dengan
 * `trace`-nya — itulah bedanya "tidak ditampilkan" dan "tidak ada".
 *
 * Kalimatnya dibentuk dengan `describeRule` yang sama dengan panel biasa, sehingga dua tempat
 * tidak pernah menampilkan bunyi yang berbeda untuk satu bukti. Kode yang belum punya template
 * jatuh ke `trace`, sama seperti di sana.
 */
function sentenceFor(item: Evidence): string | null {
  if (item.polarity === 'neutral') return null;
  return describeRule(item.code, item.args, item.trace);
}

/**
 * Menyusun diagnostik dari satu verdikt.
 */
export function diagnosticFrom(
  identity: EmailIdentity,
  verdict: Verdict,
  source: DiagnosticSource = {},
): FindingDiagnostic {
  // Diturunkan oleh fungsi engine yang sama, bukan dari `identity.provenance` langsung:
  // field itu biasanya kosong, dan engine yang mengisinya saat resolusi. Tanpa ini, panel
  // akan menyatakan "(tidak disebutkan)" untuk hampir setiap email.
  const provenance = resolveProvenance(identity);
  const passed = verdict.gate.passed;
  const claim = verdict.gate.claim;

  const claimLabel = passed ? (claim === null ? '(kosong)' : (CLAIM_LABEL[claim] ?? claim)) : '—';

  const reasonLabel = passed
    ? 'claim_found'
    : (GATE_REASON_LABEL[verdict.gate.reason] ?? verdict.gate.reason);

  const winner = verdict.trace.findIndex((row) => row.matched);

  return {
    summary: [
      { label: 'state', value: STATE_CODE[verdict.state] ?? verdict.state },
      { label: 'confidence', value: verdict.confidence },
      { label: 'provenance', value: PROVENANCE_LABEL[provenance] ?? provenance },
      { label: 'algorithmVersion', value: verdict.algorithmVersion },
      // `unknown` berarti hostname tidak dapat diurai sama sekali, sehingga tidak ada versi
      // PSL yang berlaku. Itu keadaan yang benar dan perlu terlihat sebagai keadaan, bukan
      // sebagai medan yang hilang.
      { label: 'pslVersion', value: verdict.pslVersion },
      {
        label: 'selectorUsed',
        value:
          source.selectorUsed === undefined || source.selectorUsed === null
            ? '(tidak ada)'
            : source.selectorUsed,
      },
    ],
    gate: [
      { label: 'passed', value: passed ? 'true' : 'false' },
      { label: 'claim', value: claimLabel },
      { label: 'reason', value: reasonLabel },
    ],
    trace: verdict.trace.map((row, index) => ({
      row: row.row,
      condition: row.condition,
      matched: row.matched,
      winner: index === winner,
    })),
    traceWinner: winner === -1 ? null : winner,
    evidence: verdict.evidence.map((item: Evidence) => ({
      code: item.code,
      polarity: item.polarity,
      strength: item.strength,
      tier: item.tier,
      sentence: sentenceFor(item),
      trace: item.trace,
      args: item.args,
    })),
  };
}

/**
 * Argumen bukti sebagai satu baris.
 *
 * Nilainya berasal dari email yang dikendalikan pengirim, jadi ia hanya boleh dipakai sebagai
 * teks — dan itulah satu-satunya cara ia dipakai di sini. Pengurutan kuncinya dilakukan
 * supaya keluaran untuk verdikt yang sama selalu sama persis; diagnostik yang urutannya
 * berubah-ubah tidak dapat dibandingkan antar dua pemindaian.
 */
export function formatArgs(args: Readonly<Record<string, string | number>>): string {
  const keys = Object.keys(args).sort();
  if (keys.length === 0) return '(tanpa argumen)';

  return keys.map((key) => `${key}=${JSON.stringify(args[key])}`).join('  ');
}
