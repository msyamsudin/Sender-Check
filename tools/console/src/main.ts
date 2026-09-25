/**
 * Skrip konsol Sender-Check.
 *
 * Tempel isi `dist/sender-check.console.js` ke konsol Firefox saat Gmail terbuka.
 * Skrip ini melaporkan dua hal sekaligus:
 *
 *  1. **selector mana yang bekerja** pada Gmail hari ini — ini yang tidak dapat saya
 *     verifikasi sendiri tanpa akses ke Gmail yang login;
 *  2. **hasil analisis** untuk setiap pengirim yang ditemukan, sehingga dampaknya
 *     terhadap inbox nyata langsung terlihat.
 *
 * Keluarannya sengaja dibuat agar dapat dikirim kembali apa adanya. Di akhir, ia
 * menyalin laporan JSON ke clipboard lewat `copy()` milik konsol Firefox.
 */
import { analyze, type EmailIdentity, type RuleCode, type Verdict } from '@sender-check/core';
import {
  detectGmailView,
  scanGmailInbox,
  scanGmailShowOriginal,
  type AdapterReport,
  type DocumentLike,
  type HeaderReport,
  type LocationLike,
} from '@sender-check/adapters';
import {
  MARK,
  copyToClipboard,
  printHeaderBlock,
  printNotes,
  printProbeReport,
  shortPolarity,
} from './shared.ts';

/**
 * Global browser yang dipakai skrip ini, dideklarasikan secara eksplisit.
 *
 * Alternatifnya adalah menambahkan `lib: ["DOM"]` ke seluruh proyek, dan itu akan
 * membuat `packages/core` dapat memakai `document` tanpa gagal typecheck — jaminan
 * arsitektur yang justru ingin dijaga. Dengan dua baris ini, permukaan ketergantungan
 * skrip ini terlihat jelas dan terbatas pada dua global.
 *
 * Keduanya memenuhi `DocumentLike` dan `LocationLike` secara struktural, sehingga
 * adapter tetap bekerja pada antarmuka yang dipersempit.
 */
declare const document: DocumentLike;
declare const location: LocationLike;

type Args = Readonly<Record<string, string | number>>;

/**
 * Kalimat untuk kode bukti.
 *
 * Engine tidak pernah menghasilkan kalimat jadi; ia menghasilkan `code` + `args`. Ini
 * contoh paling ringkas cara menerjemahkannya, dan pola yang sama yang akan dipakai UI
 * nanti. Kode yang belum punya template jatuh ke `trace`, yang selalu tersedia.
 */
const TEMPLATES: Partial<Record<RuleCode, (args: Args) => string>> = {
  REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT: (a) =>
    `"${a['token']}" ada di domain tujuan balasan "${a['replyTo']}", tetapi tidak di domain pengirim "${a['from']}"`,
  REPLY_TO_DOMAIN_MISMATCH: (a) =>
    `balasan diarahkan ke "${a['replyTo']}", berbeda dari domain pengirim "${a['from']}"`,
  REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE: (a) =>
    `balasan diarahkan ke surel gratis "${a['replyTo']}", bukan ke domain pengirim "${a['from']}"`,
  FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME: (a) =>
    `display name mengklaim organisasi "${a['name']}", tetapi alamatnya di "${a['domain']}"`,
  ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN: (a) =>
    `display name mengklaim organisasi, tetapi "${a['domain']}" tidak memuat identitas itu`,
  CONFUSABLE_MATCH_TO_TOKEN: (a) =>
    `"${a['token']}" memakai aksara berbeda dari "${a['target']}", tetapi bentuknya sama`,
  MIXED_SCRIPT_WITHIN_LABEL: (a) => `label "${a['label']}" mencampur aksara: ${a['scripts']}`,
  DIGIT_SUBSTITUTION_MATCH: (a) =>
    `"${a['token']}" meniru "${a['target']}" dengan mengganti karakter`,
  LOOKALIKE_NEAR_MISS: (a) =>
    `domain "${a['label']}" hampir sama dengan "${a['token']}", tetapi tidak persis`,
  DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT: (a) =>
    `"${a['token']}" dipakai sebagai kata tersendiri di domain "${a['label']}", bersama "${a['unexplained']}"`,
  DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY: (a) =>
    `"${a['token']}" hanya muncul di subdomain "${a['subdomain']}", bukan di domain "${a['domain']}"`,
  DISPLAY_NAME_EMBEDS_OTHER_ADDRESS: (a) =>
    `display name menampilkan "${a['displayed']}", pengirim sebenarnya ${a['actual']}`,
  DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN: (a) =>
    `display name mengklaim domain "${a['claimed']}", pengirim dari "${a['actual']}"`,
  DISPLAY_NAME_MATCHES_LOCALPART_EXACT: (a) =>
    `nama "${a['name']}" tercermin pada local-part "${a['localpart']}"`,
  DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL: (a) =>
    `"${a['token']}" cocok dengan bagian identitas domain "${a['label']}"`,
  DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS: () => 'display name memuat alamat pengirim sendiri',
  TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL: (a) => `"${a['token']}" hanya tertanam di "${a['target']}"`,
  AUTH_DMARC_FAIL: (a) => `DMARC ${a['result']} untuk domain pengirim`,
  AUTH_ALIGNED_PASS: (a) => `DMARC lulus dan selaras dengan "${a['domain']}"`,
  PUNYCODE_DOMAIN: (a) => `domain berpunycode; bentuk Unicode "${a['unicode']}"`,
  DISPOSABLE_DOMAIN: (a) => `domain surel sekali pakai "${a['domain']}"`,
  MAILING_LIST_DOMAIN: (a) => `alamat milis "${a['domain']}"`,
  RANDOM_LOCAL_PART: (a) => `local-part "${a['localpart']}" tampak acak`,
  GMAIL_VIA_ESP_HINT: (a) => `dikirim melalui "${a['esp']}"`,
  NO_DISPLAY_NAME: () => 'pengirim tidak menampilkan nama apa pun',
  GENERIC_TOKEN_ONLY_DISPLAYNAME: () => 'display name hanya berisi peran layanan tanpa identitas',
  HUMAN_NAME_PATTERN: () => 'display name mengikuti pola nama orang',
  GMAIL_OWN_WARNING_PRESENT: () => 'webmail sendiri menampilkan peringatan pada pesan ini',
};

function describe(code: RuleCode, args: Args, trace: string): string {
  const template = TEMPLATES[code];
  return template === undefined ? trace : template(args);
}

// ---------------------------------------------------------------------------
// Pelaporan
// ---------------------------------------------------------------------------

interface SenderFinding {
  readonly identity: EmailIdentity;
  readonly state: string;
  readonly confidence: string;
  readonly gate: string;
  readonly evidence: readonly {
    readonly code: string;
    readonly polarity: string;
    readonly strength: string;
    readonly sentence: string;
  }[];
}

/**
 * Kode bukti yang tetap ditampilkan walaupun verdiktnya bukan INCONSISTENT.
 *
 * Keduanya penting justru ketika engine memilih tidak menilai: bila Gmail sendiri
 * menandai pesan ("via", peringatan pengirim), keterangan itu tidak boleh hilang
 * hanya karena tidak ada yang bisa dibandingkan.
 *
 * Daftar ini ada di lapisan tampilan, bukan di engine — engine tetap memancarkan
 * semua bukti dan tidak tahu apa yang ditampilkan.
 */
const CONTEXT_NOTE_CODES: readonly string[] = ['GMAIL_VIA_ESP_HINT', 'GMAIL_OWN_WARNING_PRESENT'];

const POLARITY_LABEL: Record<string, string> = {
  consistency: 'mendukung',
  inconsistency: 'menentang',
  context: 'konteks',
  neutral: 'netral',
};

/** Kode bukti yang ditampilkan sebagai keterangan konteks. */
function isContextNote(item: SenderFinding['evidence'][number]): boolean {
  return shortPolarity(item.polarity) === 'context' && CONTEXT_NOTE_CODES.includes(item.code);
}

/**
 * Menampilkan bukti satu pengirim.
 *
 * Hanya ada **satu** tempat yang memutuskan bagaimana sebuah polarity diperlakukan.
 * Sebelumnya keputusan itu ada di dua tempat sekaligus — satu jalur menyaring dengan
 * `shortPolarity` dan satu jalur membandingkan string mentah — dan ketika keduanya
 * tidak sinkron, seluruh bukti `menentang` hilang tanpa satu pun error. Perbandingannya
 * sekarang selalu lewat `shortPolarity` karena engine memancarkan `supports_inconsistency`
 * sedangkan label yang dipakai di sini `inconsistency`.
 */
function printFindingEvidence(evidence: SenderFinding['evidence']): void {
  for (const item of evidence) {
    if (shortPolarity(item.polarity) === 'neutral') continue;

    if (isContextNote(item)) {
      console.log(`    [konteks] ${item.sentence} (${item.code})`);
      continue;
    }

    const label = POLARITY_LABEL[shortPolarity(item.polarity)] ?? shortPolarity(item.polarity);
    console.log(`    [${label}/${item.strength}] ${item.sentence}`);
  }
}

function contextNotes(evidence: SenderFinding['evidence']): string[] {
  return evidence.filter(isContextNote).map((item) => `${item.sentence} (${item.code})`);
}

/** `Nama <alamat>`, bentuk yang dipakai baik di judul blok maupun di baris ringkas. */
function senderLabel(finding: SenderFinding): string {
  const label = finding.identity.displayName ?? '(tanpa nama)';
  return `${label} <${finding.identity.fromAddress}>`;
}

function reportFindings(findings: readonly SenderFinding[]): void {
  const counts = new Map<string, number>();
  for (const finding of findings) {
    counts.set(finding.state, (counts.get(finding.state) ?? 0) + 1);
  }

  const summary = [...counts.entries()].map(([state, count]) => `${state}=${count}`).join('  ');
  console.log(`\npengirim terbaca: ${findings.length}`);
  console.log(`sebaran state   : ${summary || '—'}`);

  const flagged = findings.filter((finding) => finding.state === 'INCONSISTENT');
  const rest = findings.filter((finding) => finding.state !== 'INCONSISTENT');

  if (flagged.length === 0) {
    console.log('\nTidak ada pengirim dengan state INCONSISTENT pada halaman ini.');
  } else {
    console.log(`\n--- INCONSISTENT (${flagged.length}) ---`);
    for (const finding of flagged) {
      console.log(`\n${MARK['INCONSISTENT'] ?? '⚠'} ${senderLabel(finding)}`);
      if (finding.identity.replyTo !== undefined) {
        console.log(`  reply-to: ${finding.identity.replyTo}`);
      }
      console.log(`  ${finding.state}/${finding.confidence}   gate: ${finding.gate}`);
      // Bukti `menentang` dan `mendukung` dicetak, dan bukti `konteks` tidak lagi
      // dibuang di sini. Sebelumnya ia dibuang, sehingga keterangan seperti
      // "via sendgrid.net" tidak pernah terlihat — padahal `docs/USAGE.md` dan contoh
      // di `examples/` menampilkannya.
      printFindingEvidence(finding.evidence);
    }
  }

  // Pengirim yang tidak ditandai tidak dicetak seluruhnya: pada inbox nyata
  // jumlahnya puluhan dan akan menenggelamkan sinyal. Yang tetap dicetak hanyalah
  // pengirim yang punya keterangan konteks, karena keterangan itu berguna justru
  // ketika engine memilih untuk tidak menilai.
  const withNotes = rest.filter((finding) => contextNotes(finding.evidence).length > 0);
  if (withNotes.length > 0) {
    console.log(`\n--- keterangan pada pengirim lain (${withNotes.length}) ---`);
    for (const finding of withNotes) {
      console.log(`\n${senderLabel(finding)}`);
      console.log(`  ${finding.state}/${finding.confidence}`);
      for (const note of contextNotes(finding.evidence)) {
        console.log(`    [konteks] ${note}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------

/**
 * Titik masuk skrip.
 *
 * Diekspor supaya dapat dipanggil test dengan DOM tiruan. Itu satu-satunya cara
 * memeriksa teks yang dicetaknya tanpa membuka Gmail: `main.ts` hanya berjalan di
 * halaman Gmail, dan dua kerusakan pelaporan pernah lolos tanpa satu pun error.
 */
export function main(): void {
  const view = detectGmailView(location);

  printHeaderBlock([
    'SENDER-CHECK · PROBE + ANALISIS',
    `halaman : ${view}`,
    `url     : ${location.href}`,
  ]);

  if (view === 'show-original') {
    runShowOriginal();
    return;
  }

  if (view === 'inbox') {
    runInbox();
    return;
  }

  console.log('\nHalaman ini bukan Gmail. Buka inbox Gmail atau halaman "Show original", lalu jalankan ulang.');
}

function runInbox(): void {
  const report: AdapterReport = scanGmailInbox(document);

  console.log(`\nselector digunakan: ${report.selectorUsed ?? 'TIDAK ADA'}`);
  printProbeReport(report.probes);
  printNotes(report.notes);

  const findings: SenderFinding[] = report.senders.map((sender) => {
    // `viaHint` diteruskan apa adanya. Hanya adapter yang boleh mengisinya, dan hanya
    // dari indikator "via" di tampilan pesan — bukan dari kolom "dikirim oleh" pada
    // halaman Show original, yang artinya berbeda.
    const identity: EmailIdentity = {
      displayName: sender.displayName,
      fromAddress: sender.fromAddress,
      ...(sender.viaHint !== undefined ? { gmailViaHint: sender.viaHint } : {}),
      gmailOwnWarning: report.gmailOwnWarning,
    };

    const verdict: Verdict = analyze(identity);

    return {
      identity,
      state: verdict.state,
      confidence: verdict.confidence,
      gate: verdict.gate.passed ? (verdict.gate.claim ?? 'lolos') : verdict.gate.reason,
      evidence: verdict.evidence.map((item) => ({
        code: item.code,
        polarity: item.polarity,
        strength: item.strength,
        sentence: describe(item.code, item.args, item.trace),
      })),
    };
  });

  reportFindings(findings);

  console.log(`\nalgorithmVersion: ${analyze({ displayName: null, fromAddress: 'a@b.com' }).algorithmVersion}`);
  console.log('Catatan penting: pada Tier A, Reply-To dan Return-Path tidak tersedia di DOM inbox.');
  console.log('Kelas serangan seperti "identitas hanya diakui domain tujuan balasan" hanya dapat');
  console.log('terdeteksi dari halaman "Show original". Jalankan skrip ini juga di halaman itu.');

  copyToClipboard({
    kind: 'inbox-probe',
    view: 'inbox',
    url: location.href,
    probe: report,
    // `report.senders` sudah memuat `viaHint` per pengirim; disertakan di sini supaya
    // laporan yang dikirim kembali dapat dipakai untuk memverifikasi pembacaan
    // indikator "via" pada DOM Gmail yang sesungguhnya.
    senders: report.senders,
    findings,
  });
}

function runShowOriginal(): void {
  const report: HeaderReport = scanGmailShowOriginal(document);

  console.log(`\nblok header ditemukan: ${report.matched ? 'ya' : 'TIDAK'}`);
  printProbeReport(report.probes);
  printNotes(report.notes);

  if (!report.matched || report.identity === null) {
    console.log('\nTidak ada header yang terbaca. Kirimkan keluaran ini apa adanya — justru inilah');
    console.log('yang dibutuhkan untuk memperbaiki adapter.');
    copyToClipboard({ kind: 'show-original-probe', view: 'show-original', url: location.href, probe: report });
    return;
  }

  console.log('\nheader terurai:');
  for (const [name, value] of Object.entries(report.headers)) {
    const shown = value.length > 100 ? `${value.slice(0, 100)}…` : value;
    console.log(`  ${name.padEnd(26)} ${shown}`);
  }

  const identity: EmailIdentity = {
    displayName: report.identity.displayName ?? null,
    fromAddress: report.identity.fromAddress ?? '(tidak ada header From)',
    ...(report.identity.replyTo !== undefined ? { replyTo: report.identity.replyTo } : {}),
    ...(report.identity.returnPath !== undefined ? { returnPath: report.identity.returnPath } : {}),
    ...(report.identity.authenticationResults !== undefined
      ? { authenticationResults: report.identity.authenticationResults }
      : {}),
  };

  const verdict = analyze(identity);

  const finding: SenderFinding = {
    identity,
    state: verdict.state,
    confidence: verdict.confidence,
    gate: verdict.gate.passed ? (verdict.gate.claim ?? 'lolos') : verdict.gate.reason,
    evidence: verdict.evidence.map((item) => ({
      code: item.code,
      polarity: item.polarity,
      strength: item.strength,
      sentence: describe(item.code, item.args, item.trace),
    })),
  };

  reportFindings([finding]);

  console.log('\nbukti lengkap (termasuk konteks):');
  for (const item of verdict.evidence) {
    console.log(`  [${shortPolarity(item.polarity)}/${item.strength}] ${item.code}`);
    console.log(`      ${describe(item.code, item.args, item.trace)}`);
  }

  console.log(`\nalgorithmVersion: ${verdict.algorithmVersion}`);
  console.log(`pslVersion      : ${verdict.pslVersion}`);

  copyToClipboard({
    kind: 'show-original-probe',
    view: 'show-original',
    url: location.href,
    probe: report,
    identity,
    finding,
  });
}

main();
