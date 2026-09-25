import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentLike } from '@sender-check/adapters';
import { FakeDocument, fakeDocument } from '../../../packages/adapters/tests/fake-dom.ts';

/**
 * Penjaga untuk laporan yang dicetak skrip konsol.
 *
 * Kenapa test ini ada: `main.ts` hanya dapat dijalankan di browser pada halaman Gmail,
 * sehingga tidak ada satu pun test yang menyentuh cara ia melaporkan hasil. Dua
 * kerusakan nyata pernah lolos karena itu, dan keduanya tidak menggagalkan typecheck
 * maupun test mana pun:
 *
 *  1. bukti berpolarity `context` dibuang dari blok INCONSISTENT, sehingga keterangan
 *     "via sendgrid.net" tidak pernah terlihat walaupun adapter sudah membacanya;
 *  2. saat laporan itu diperbaiki, penyaringan polarity membandingkan
 *     `supports_inconsistency` dengan `inconsistency`, dan seluruh bukti `menentang`
 *     hilang dari luaran — tanpa satu pun error.
 *
 * Keduanya hanya dapat ditangkap dengan menjalankan skripnya dan memeriksa teks yang
 * dicetak. Itulah yang dilakukan di sini: DOM tiruan memenuhi `DocumentLike`, dan
 * `globalThis.document`/`globalThis.location` diisi sementara.
 *
 * Yang tetap **tidak** dapat diuji di sini adalah apakah selectornya benar untuk Gmail
 * hari ini. Itu tetap diverifikasi skrip probe terhadap halaman sungguhan.
 */

declare global {
  // `lib` proyek ini sengaja tidak memuat DOM; dua global ini dideklarasikan hanya
  // selama test berjalan.
  // eslint-disable-next-line no-var
  var document: DocumentLike | undefined;
  // eslint-disable-next-line no-var
  var location: { href: string } | undefined;
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Menjalankan skrip konsol pada halaman tiruan dan mengembalikan teks yang dicetaknya.
 *
 * Modulnya diimpor secara **dinamis**, bukan statis, karena skrip itu memanggil dirinya
 * sendiri saat dimuat — persis seperti yang dibutuhkan ketika ditempel ke konsol
 * Firefox. Import statis akan menjalankannya sebelum global tiruan sempat dipasang.
 *
 * `vi.resetModules()` diperlukan karena modul di-cache: tanpa itu skripnya hanya
 * benar-benar berjalan pada test pertama, dan test berikutnya menerima keluaran kosong.
 */
async function runScript(href: string, document: DocumentLike): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  });

  globalThis.document = document;
  globalThis.location = { href };

  try {
    vi.resetModules();
    await import('../src/main.ts');
  } finally {
    spy.mockRestore();
    globalThis.document = undefined;
    globalThis.location = undefined;
  }

  return lines.join('\n');
}

/**
 * Halaman inbox dengan dua pengirim:
 *
 *  - yang pertama tidak dinilai engine (nama manusia di domain pribadi), tetapi
 *    barisnya memuat penanda "via" — inilah kombinasi yang dulu membuang keterangan;
 *  - yang kedua tidak dinilai, dan tidak punya penanda apa pun.
 */
function inboxWithViaMarker(): DocumentLike {
  return fakeDocument(
    {
      tag: 'tr',
      children: [
        {
          tag: 'td',
          children: [
            {
              tag: 'span',
              attrs: { email: 'budi@example.com', name: 'Budi Santoso' },
              text: 'Budi Santoso',
            },
          ],
        },
        {
          tag: 'td',
          children: [
            { tag: 'span', attrs: { class: 'zx' }, text: 'via sendgrid.net' },
            { tag: 'span', attrs: { class: 'y2' }, text: `Pesanan Anda ${'x'.repeat(500)}` },
          ],
        },
      ],
    },
    {
      tag: 'tr',
      children: [
        {
          tag: 'span',
          attrs: { email: 'siti@example.org', name: 'Siti Aminah' },
          text: 'Siti Aminah',
        },
      ],
    },
  );
}

/** Halaman Show original dengan header yang menyalin halaman aslinya. */
function showOriginalPage(): DocumentLike {
  const text = [
    'Delivered-To: penerima@gmail.com',
    'Return-Path: <no-reply@mngl.in>',
    'Authentication-Results: mx.google.com; dkim=pass header.i=@mngl.in; dmarc=pass (p=NONE sp=NONE) header.from=mngl.in',
    'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mngl.in; s=google',
    'Received: by smtp.gmail.com with ESMTPSA id 46e09a7af769',
    'From: Rise <no-reply@mngl.in>',
    'To: penerima@gmail.com',
    'Reply-To: support@riseworks.digital',
    'Subject: Action Required: Scheduled KYC Re-Verification',
    '',
    'Badan pesan tidak dibaca adapter.',
  ].join('\n');

  return new FakeDocument([{ tag: 'pre', text }]);
}

/** Membaca bundel yang benar-benar ditempel ke konsol Firefox. */
function readBundledScript(name: string): string {
  return readFileSync(join(here, '..', 'dist', name), 'utf8');
}

describe('laporan skrip konsol: halaman inbox', () => {
  it('mencetak keterangan via untuk pengirim yang tidak ditandai', async () => {
    const output = await runScript('https://mail.google.com/mail/u/0/#inbox', inboxWithViaMarker());

    // Inilah kerusakan yang dijaga test ini: keterangan konteks tidak boleh hilang
    // hanya karena pengirimnya tidak masuk state INCONSISTENT.
    expect(output).toContain('keterangan pada pengirim lain');
    expect(output).toContain('dikirim melalui "sendgrid.net"');
    expect(output).toContain('GMAIL_VIA_ESP_HINT');
  });

  it('tetap melaporkan pengirim terbaca dan sebaran state', async () => {
    const output = await runScript('https://mail.google.com/mail/u/0/#inbox', inboxWithViaMarker());

    expect(output).toContain('pengirim terbaca: 2');
    expect(output).toContain('sebaran state');
  });

  it('menyatakan dengan jelas bila tidak ada pengirim yang ditandai', async () => {
    const output = await runScript('https://mail.google.com/mail/u/0/#inbox', inboxWithViaMarker());

    expect(output).toContain('Tidak ada pengirim dengan state INCONSISTENT pada halaman ini.');
  });
});

describe('laporan skrip konsol: halaman Show original', () => {
  it('mencetak bukti menentang beserta bukti yang mendukung', async () => {
    const output = await runScript(
      'https://mail.google.com/mail/u/0/?ik=abc&view=om&permmsgid=msg-f:1',
      showOriginalPage(),
    );

    // Polarity dari engine berbentuk `supports_inconsistency`; label yang dicetak
    // `menentang`. Keduanya pernah dibandingkan langsung dan seluruh bukti hilang.
    expect(output).toContain('[menentang/strong]');
    expect(output).toContain('"rise" ada di domain tujuan balasan "riseworks.digital"');
    expect(output).toContain('[mendukung/medium]');
    expect(output).toContain('[konteks/weak]');
  });

  it('mencetak identitas tanpa alamat bersarang', async () => {
    const output = await runScript(
      'https://mail.google.com/mail/u/0/?ik=abc&view=om&permmsgid=msg-f:1',
      showOriginalPage(),
    );

    // `fromAddress` harus berisi alamat saja. Bila berisi nilai header utuh, baris ini
    // menjadi `Rise <Rise <no-reply@mngl.in>>`.
    expect(output).toContain('⚠ Rise <no-reply@mngl.in>');
    expect(output).not.toContain('<Rise <');
  });

  it('melaporkan reply-to dari header', async () => {
    const output = await runScript(
      'https://mail.google.com/mail/u/0/?ik=abc&view=om&permmsgid=msg-f:1',
      showOriginalPage(),
    );

    expect(output).toContain('reply-to: support@riseworks.digital');
  });
});

describe('bundel yang ditempel ke konsol Firefox', () => {
  it('memuat perbaikan pelaporan, bukan hanya kode sumbernya', () => {
    // `tools/console/dist/` diabaikan git, jadi bundelnya mudah tertinggal dari
    // sumbernya. Test ini gagal bila `pnpm console:build` belum dijalankan setelah
    // mengubah `src/`.
    const bundle = readBundledScript('sender-check.console.js');

    expect(bundle).toContain('keterangan pada pengirim lain');
    expect(bundle).toContain('konteks');
    expect(bundle.length).toBeGreaterThan(100_000);
  });

  it('probe tetap kecil dan memuat pembacaan penanda via', () => {
    const bundle = readBundledScript('sender-check.probe.js');

    expect(bundle).toContain('zx');
    expect(bundle).toContain('PROBE SELECTOR');
    // Berkas ini ditempel ke konsol; ukurannya harus tetap wajar.
    expect(bundle.length).toBeLessThan(40_000);
  });
});
