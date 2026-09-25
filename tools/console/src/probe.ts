/**
 * Skrip probe: jawab satu pertanyaan saja — **selector mana yang bekerja**.
 *
 * Skrip ini sengaja tidak memuat engine. Tabel PSL saja berukuran 211 KB, dan
 * menempelkannya ke konsol hanya untuk menjawab pertanyaan tentang selector adalah
 * pemborosan yang juga menambah risiko penempelan gagal. Karena itu ada dua berkas:
 *
 *  - `sender-check.probe.js`  — probe selector saja, kecil
 *  - `sender-check.console.js` — probe + analisis lengkap, besar
 *
 * Jalankan yang kecil lebih dulu. Kalau selector-nya sudah benar, yang besar memberi
 * hasil analisis pada inbox nyata.
 */
import {
  detectGmailView,
  scanGmailInbox,
  scanGmailShowOriginal,
  type DocumentLike,
  type LocationLike,
} from '@sender-check/adapters';
import { copyToClipboard, printHeaderBlock, printNotes, printProbeReport, section } from './shared.ts';

// Hanya dua global browser yang dipakai, dideklarasikan eksplisit supaya tidak perlu
// menambahkan `lib: ["DOM"]` ke seluruh proyek.
declare const document: DocumentLike;
declare const location: LocationLike;

const view = detectGmailView(location);

printHeaderBlock(['SENDER-CHECK · PROBE SELECTOR', `halaman : ${view}`, `url     : ${location.href}`]);

if (view === 'show-original') {
  const report = scanGmailShowOriginal(document);

  console.log(`\nblok header ditemukan: ${report.matched ? 'ya' : 'TIDAK'}`);
  printProbeReport(report.probes);
  printNotes(report.notes);

  if (report.matched) {
    section('header terurai');
    for (const [name, value] of Object.entries(report.headers)) {
      const shown = value.length > 120 ? `${value.slice(0, 120)}…` : value;
      console.log(`  ${name.padEnd(26)} ${shown}`);
    }
  }

  copyToClipboard({
    kind: 'probe',
    view,
    url: location.href,
    matched: report.matched,
    probes: report.probes,
    notes: report.notes,
    headers: report.headers,
    identity: report.identity,
  });
} else if (view === 'inbox') {
  const report = scanGmailInbox(document);

  console.log(`\nselector digunakan: ${report.selectorUsed ?? 'TIDAK ADA'}`);
  printProbeReport(report.probes);
  printNotes(report.notes);

  section(`pengirim terbaca (${report.senders.length})`);
  for (const sender of report.senders.slice(0, 40)) {
    const name = sender.displayName ?? '(tanpa nama)';
    const via = sender.viaHint === undefined ? '' : `   via ${sender.viaHint}`;
    console.log(`  ${name} <${sender.fromAddress}>${via}`);
  }
  if (report.senders.length > 40) {
    console.log(`  … dan ${report.senders.length - 40} lagi`);
  }

  if (!report.matched) {
    console.log('\nTidak satu pun selector bekerja. Inilah yang perlu dilaporkan:');
    console.log('kirimkan seluruh keluaran ini, dan adapter akan disesuaikan dengan DOM Gmail');
    console.log('yang sebenarnya. Jangan menebak.');
  }

  copyToClipboard({
    kind: 'probe',
    view,
    url: location.href,
    matched: report.matched,
    selectorUsed: report.selectorUsed,
    probes: report.probes,
    notes: report.notes,
    gmailOwnWarning: report.gmailOwnWarning,
    senders: report.senders,
  });
} else {
  console.log('\nHalaman ini bukan Gmail. Buka inbox Gmail atau halaman "Show original",');
  console.log('lalu jalankan ulang skrip ini.');
}
