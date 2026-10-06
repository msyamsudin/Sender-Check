import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { scanGmailInbox, scanGmailList } from '../src/gmail.ts';
import { scanGmailShowOriginal } from '../src/gmail-headers.ts';
import type { DocumentLike } from '../src/types.ts';

/**
 * Verifikasi selector terhadap markup Gmail yang **tersimpan**, bukan yang ditebak.
 *
 * ## Kenapa berkas ini ada
 *
 * `gmail.test.ts` menguji logika adapter di atas `FakeDocument` yang ditulis tangan, dan
 * itu memang batasnya: DOM tiruan membuktikan urutan prioritas selector bekerja, tetapi
 * tidak dapat membuktikan bahwa selector itu **cocok** dengan apa yang Gmail kirim hari
 * ini. Selama hanya ada DOM tiruan, seluruh daftar selector di `src/gmail.ts` adalah
 * hipotesis — dan satu di antaranya (`VIA_ELEMENT_CLASSES`) memang sudah dinyatakan
 * belum pernah terbukti.
 *
 * Berkas ini menutup jarak itu dengan cara yang tidak menuntut browser: snapshot
 * `outerHTML` dari halaman Gmail sungguhan diurai `linkedom`, lalu diumpankan ke adapter
 * yang sama. Yang diuji karena itu bukan lagi "apakah logikanya masuk akal", melainkan
 * "apakah markup nyata masih terbaca".
 *
 * ## Kenapa testnya di-skip, bukan gagal, selama snapshot belum ada
 *
 * Empat berkas snapshot hanya dapat diambil dari sesi Gmail yang login — pekerjaan manual
 * yang tidak dapat dikerjakan CI. Membuat CI merah karena pekerjaan manual yang belum
 * selesai akan membuat seluruh repositori terlihat rusak, dan itu justru menyembunyikan
 * keadaan sebenarnya. Karena itu `describe.skipIf` dipakai: yang muncul di keluaran test
 * adalah "skipped", bukan "failed", dan berkas yang belum ada tetap terdaftar di sini
 * sehingga tidak ada yang terlupakan. Begitu berkasnya diletakkan di
 * `tools/corpus/dom-snapshots/`, assertion-nya hidup sendiri tanpa perubahan kode.
 *
 * ## Yang tidak dibuktikan berkas ini, dan tidak boleh diklaim
 *
 * Snapshot yang tersimpan **tidak berubah** ketika Gmail mengubah DOM-nya, sehingga test
 * ini tidak akan gagal karena Gmail berubah — ia gagal ketika adapter berhenti cocok
 * dengan markup yang sudah terekam. Canary yang benar-benar hidup tetap
 * `sender-check.probe.js` yang dijalankan di halaman sungguhan. Berkas ini adalah
 * **regression fixture** dan tempat selector diverifikasi, bukan penjaga terhadap
 * perubahan Gmail.
 *
 * Cara mengambil keempat berkasnya ada di `tools/corpus/dom-snapshots/README.md`.
 */

const SNAPSHOT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'tools',
  'corpus',
  'dom-snapshots',
);

const SNAPSHOTS = [
  'list-row.html',
  'thread-open.html',
  'thread-no-name.html',
  'show-original.html',
] as const;

type SnapshotName = (typeof SNAPSHOTS)[number];

/**
 * Mengurai `outerHTML` yang tersimpan menjadi `DocumentLike`.
 *
 * `linkedom` dipakai justru karena adapter bekerja pada antarmuka yang dipersempit:
 * `Document` miliknya memenuhi `DocumentLike` secara struktural, sehingga adapter tidak
 * perlu tahu apa pun tentang parser ini — dan `packages/core` tetap bebas DOM.
 */
function toDocument(html: string): DocumentLike {
  const { document } = parseHTML(html) as unknown as { document: DocumentLike };
  return document;
}

function loadDocument(file: SnapshotName): DocumentLike | null {
  const path = join(SNAPSHOT_DIR, file);
  return existsSync(path) ? toDocument(readFileSync(path, 'utf8')) : null;
}

/**
 * Snapshot yang keberadaannya sudah dijamin `describe.skipIf`.
 *
 * Dipanggil **di dalam** `it`, tidak di badan `describe`: vitest tetap menjalankan badan
 * `describe` saat mengoleksi test walaupun `skipIf` menyala, sehingga pembacaan di sana
 * akan melempar justru pada keadaan yang seharusnya di-skip. Alasan yang sama membuat
 * fungsi ini melempar alih-alih memakai `as DocumentLike`: cast akan tetap lolos
 * seandainya `skipIf` suatu saat dilepas tanpa sengaja.
 */
function required(document: DocumentLike | null): DocumentLike {
  if (document === null) {
    throw new Error('snapshot tidak tersedia; describe ini seharusnya di-skip');
  }
  return document;
}

function readdirNames(): string[] {
  return existsSync(SNAPSHOT_DIR) ? readdirSync(SNAPSHOT_DIR) : [];
}

describe('jembatan snapshot HTML → DocumentLike', () => {
  it('membaca markup HTML apa adanya tanpa browser', () => {
    // Test ini tidak bergantung pada satu pun berkas snapshot: ia menjaga jembatannya.
    // Tanpa ini, "snapshot belum diambil" dan "linkedom tidak dapat dipakai" akan tampak
    // sama — yaitu sama-sama tidak terlihat, karena seluruh test lain di berkas ini di-skip.
    const document = toDocument(
      '<div data-message-id="#msg-f:1"><span email="no-reply@mngl.in" name="Rise">Rise</span></div>',
    );

    const report = scanGmailInbox(document, { scope: 'conversation' });

    expect(report.matched).toBe(true);
    expect(report.senders[0]?.fromAddress).toBe('no-reply@mngl.in');
    expect(report.senders[0]?.displayName).toBe('Rise');
  });
});

describe('ketersediaan snapshot', () => {
  it('direktori snapshot beserta kontraknya ada', () => {
    expect(existsSync(SNAPSHOT_DIR)).toBe(true);
    expect(existsSync(join(SNAPSHOT_DIR, 'README.md'))).toBe(true);
  });

  it('melaporkan berkas yang belum diambil tanpa menggagalkan CI', () => {
    // Daftarnya sengaja dicetak, bukan diam-diam dilewati: pekerjaan ini bergantung pada
    // satu sesi manual, dan satu-satunya cara ia tidak terlupakan adalah dengan terlihat
    // di setiap kali test dijalankan.
    const missing = SNAPSHOTS.filter((file) => !existsSync(join(SNAPSHOT_DIR, file)));

    if (missing.length > 0) {
      console.info(`[snapshot] belum diambil: ${missing.join(', ')}`);
    }

    // Yang diperiksa adalah kontraknya, bukan kelengkapannya: kelengkapan tidak dapat
    // dituntut dari CI, sedangkan berkas tak dikenal di direktori ini bisa.
    const known = new Set<string>([...SNAPSHOTS, 'README.md']);
    const unexpected = readdirNames().filter((name) => !known.has(name));

    expect(unexpected, `berkas tak dikenal di dom-snapshots: ${unexpected.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Satu bagian per snapshot
// ---------------------------------------------------------------------------

const listRow = loadDocument('list-row.html');

describe.skipIf(listRow === null)('snapshot: satu baris list view', () => {
  const readPage = (): ReturnType<typeof scanGmailInbox> =>
    scanGmailInbox(required(listRow), { scope: 'page' });

  it('selector masih menghasilkan pengirim', () => {
    const report = readPage();

    expect(report.matched).toBe(true);
    expect(report.selectorUsed).not.toBeNull();
    expect(report.senders.length).toBeGreaterThan(0);
  });

  it('halaman tanpa baris daftar tidak menghasilkan baris apa pun', () => {
    // `matched: false` dan daftar kosong adalah keadaan yang benar, bukan kegagalan:
    // ekstensi hanya memasang penanda bila daftarnya ada, dan berhenti melakukannya begitu
    // pengguna berpindah dari daftar ke thread.
    const report = scanGmailList(toDocument('<div>halaman tanpa tabel</div>'));

    expect(report.matched).toBe(false);
    expect(report.rows).toEqual([]);
  });

  it('setiap pengirim membawa alamat yang dapat diurai', () => {
    for (const sender of readPage().senders) {
      expect(sender.fromAddress).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    }
  });

  it('alamat yang muncul berkali-kali di markup tidak menjadi pengirim ganda', () => {
    // Baris Gmail yang tersimpan di sini memuat dua elemen bersarang yang sama-sama membawa
    // atribut `email` — pembungkus dan elemen di dalamnya. Adapter menggabungkannya per
    // alamat; tanpa itu, satu baris akan dilaporkan sebagai dua pengirim, dan `pickPrimary`
    // di panel dapat memilih salah satunya berdasarkan temuan yang paling berat.
    const addresses = readPage().senders.map((sender) => sender.fromAddress.toLowerCase());

    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it('baris list view bukan percakapan', () => {
    // Inilah alasan `MESSAGE_CONTAINER_SELECTOR` memakai `data-message-id`: baris daftar
    // membawa `data-legacy-thread-id`, sehingga daftar inbox tidak pernah dibaca sebagai
    // percakapan. Bila Gmail suatu saat ikut menaruh `data-message-id` di baris daftar,
    // panel akan mulai menjelaskan pengirim yang salah pada setiap email yang dibuka —
    // dan test ini yang menangkapnya lebih dulu.
    const conversation = scanGmailInbox(required(listRow), { scope: 'conversation' });

    expect(conversation.senders).toEqual([]);
  });

  it('pemindaian baris menghasilkan tepat satu entri untuk baris ini', () => {
    // Bentuk hasilnya yang diuji, bukan hanya isinya: satu entri per baris, urut dokumen.
    // Indikator list view menempatkan penanda pada baris ke-i berdasarkan entri ke-i, dan
    // kehilangan satu entri akan menggeser seluruh penanda sesudahnya ke baris yang salah.
    const report = scanGmailList(required(listRow));

    expect(report.matched).toBe(true);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.fromAddress).toBe('no-reply@contoh-sekuritas.example');
    expect(report.rows[0]?.displayName).toBe('Contoh Sekuritas In.');
    expect(report.rows[0]?.sourceSelector).toBe('[email]');
  });

  it('nama pada daftar membawa tanda pemotongan Gmail: 20 karakter dan berakhir titik', () => {
    // Inilah ukuran bukti yang mendasari keputusan perlakuan nama potong (§12.1 butir 6).
    // Bila suatu saat snapshot berisi nama berbeda, assertion ini yang memberi tahu bahwa
    // heuristiknya perlu ditinjau — dan itu lebih baik daripada indikator yang menilai nama
    // yang sudah dipotong tanpa seorang pun menyadarinya.
    const name = scanGmailList(required(listRow)).rows[0]?.displayName ?? '';

    expect(name).toHaveLength(20);
    expect(name.endsWith('.')).toBe(true);
  });
});

const threadOpen = loadDocument('thread-open.html');

describe.skipIf(threadOpen === null)('snapshot: thread terbuka', () => {
  const readConversation = (): ReturnType<typeof scanGmailInbox> =>
    scanGmailInbox(required(threadOpen), { scope: 'conversation' });

  it('percakapan terbaca', () => {
    const conversation = readConversation();

    expect(conversation.matched).toBe(true);
    expect(conversation.senders.length).toBeGreaterThan(0);
  });

  it('mengambil elemen beralamat pertama di dalam pesan, bukan yang membawa nama', () => {
    // Urutan inilah yang mencegah chip penerima ("to saya") menang atas baris pengirim.
    // Bila urutannya terbalik, yang dilaporkan panel adalah alamat pengguna sendiri.
    expect(readConversation().selectorUsed).toBe('[email]');
  });

  it('tidak membaca lebih banyak pengirim daripada jumlah pesan', () => {
    const containers = required(threadOpen).querySelectorAll('[data-message-id]').length;

    expect(containers).toBeGreaterThan(0);
    expect(readConversation().senders.length).toBeLessThanOrEqual(containers);
  });

  it('lingkup percakapan tidak lebih luas daripada seluruh halaman', () => {
    const page = scanGmailInbox(required(threadOpen), { scope: 'page' });

    expect(readConversation().senders.length).toBeLessThanOrEqual(page.senders.length);
  });
});

/**
 * Berkas ini belum ada, dan mungkin tidak akan pernah ada di akun pemelihara: Gmail tidak
 * merender pengirim tanpa nama di sana — inbox dan Spam sama-sama tidak memuat satu pun
 * `span[email]` tanpa atribut `name`. Alasan lengkapnya, termasuk bentuk markup yang benar
 * bila suatu saat ditemukan, ada di `tools/corpus/dom-snapshots/README.md`.
 *
 * Assertion-nya dibiarkan hidup: berkasnya hanya perlu diletakkan, dan test ini menyala.
 */
const threadNoName = loadDocument('thread-no-name.html');

describe.skipIf(threadNoName === null)('snapshot: thread tanpa display name', () => {
  const readConversation = (): ReturnType<typeof scanGmailInbox> =>
    scanGmailInbox(required(threadNoName), { scope: 'conversation' });

  it('pengirim tetap terbaca', () => {
    const report = readConversation();

    expect(report.matched).toBe(true);
    expect(report.senders.length).toBeGreaterThan(0);
  });

  it('nama yang tidak dirender Gmail menjadi null, bukan string kosong', () => {
    // Inilah satu-satunya berkas yang menguji keadaan ini pada markup sungguhan.
    expect(readConversation().senders[0]?.displayName).toBeNull();
  });
});

const showOriginal = loadDocument('show-original.html');

describe.skipIf(showOriginal === null)('snapshot: halaman Show original', () => {
  const read = (): ReturnType<typeof scanGmailShowOriginal> =>
    scanGmailShowOriginal(required(showOriginal));

  it('blok header mentah ditemukan di dalam DOM halaman', () => {
    const report = read();

    expect(report.matched).toBe(true);
    expect(Object.keys(report.headers).length).toBeGreaterThanOrEqual(2);
  });

  it('blok header dibaca dari elemen teks terformat, bukan pembungkus yang lebih luas', () => {
    // Temuan probe nyata: header mentah berada di `pre.raw_message_text`. Bila container
    // pertama yang cocok berubah menjadi pembungkus yang lebih luas, teks antarmuka Gmail
    // ikut terbaca dan penguraian header menjadi tidak dapat dipercaya.
    const note = read().notes.find((item) => item.startsWith('blok header dibaca dari'));

    expect(note).toBeDefined();
    expect(note).toContain('pre');
  });

  it('header From terurai menjadi alamat dan display name', () => {
    const report = read();

    expect(report.identity?.fromAddress).toMatch(/@/);

    if (report.headers['from'] !== undefined) {
      // `null` sah — artinya header From memang tanpa nama. Yang tidak sah adalah medannya
      // hilang sama sekali padahal headernya ada.
      expect('displayName' in (report.identity ?? {})).toBe(true);
    }
  });

  it('kolom Tier B diteruskan apa adanya ke identitas', () => {
    const { headers, identity } = read();

    if (headers['reply-to'] !== undefined) {
      expect(identity?.replyTo).toBe(headers['reply-to'].trim());
    }
    if (headers['return-path'] !== undefined) {
      expect(identity?.returnPath).toBe(headers['return-path'].trim());
    }
    if (headers['authentication-results'] !== undefined) {
      expect(identity?.authenticationResults).toBe(headers['authentication-results'].trim());
    }
  });

  it('"dikirim oleh" tidak pernah menjadi gmailViaHint', () => {
    // DESIGN bagian 12.1 butir 1. Kolom "dikirim oleh" adalah domain Return-Path, dan pada
    // pengiriman normal ia sama dengan domain From. Menyamakannya dengan "via" akan
    // mengisi `gmailViaHint` pada hampir semua email dan menekan sinyal Tier B diam-diam.
    expect(read().identity?.gmailViaHint).toBeUndefined();
  });
});
