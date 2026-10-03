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
import { analyze, type EmailIdentity } from '@sender-check/core';
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
  POLARITY_LABEL,
  contextNotes,
  describeRule,
  isContextNote,
  senderLabel,
  shortPolarity,
  toFinding,
  type SenderFinding,
} from '@sender-check/presentation';
import { copyToClipboard, printHeaderBlock, printNotes, printProbeReport } from './shared.ts';

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

// ---------------------------------------------------------------------------
// Pelaporan
// ---------------------------------------------------------------------------

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

    return toFinding(identity, analyze(identity));
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

  const finding: SenderFinding = toFinding(identity, verdict);

  reportFindings([finding]);

  console.log('\nbukti lengkap (termasuk konteks):');
  for (const item of verdict.evidence) {
    console.log(`  [${shortPolarity(item.polarity)}/${item.strength}] ${item.code}`);
    console.log(`      ${describeRule(item.code, item.args, item.trace)}`);
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
