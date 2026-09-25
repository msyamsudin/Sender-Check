import { describe, expect, it } from 'vitest';
import {
  decodeEncodedWords,
  extractDisplayName,
  parseHeaderBlock,
  scanGmailShowOriginal,
} from '../src/gmail-headers.ts';
import { fakeDocument } from './fake-dom.ts';

/**
 * Blok header realistis, disusun mengikuti urutan pesan Gmail yang sebenarnya:
 * Delivered-To dan Received lebih dulu, lalu Return-Path dan Authentication-Results,
 * baru From dan Reply-To.
 *
 * Alamat penerimanya sengaja memakai domain contoh, bukan alamat asli. Alamat pribadi
 * tidak pernah dibutuhkan untuk menguji penguraian header, dan berkas ini ikut
 * terunggah ke repositori publik.
 */
const REAL_HEADER_BLOCK = [
  'Delivered-To: penerima@example.com',
  'Received: by 2002:a05:6e02:1a8f:b0:6f1:2c3d:4e5f with SMTP id abc123;',
  '        Tue, 22 Sep 2026 03:54:11 -0700 (PDT)',
  'Return-Path: <no-reply@mngl.in>',
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@mngl.in header.s=sel2023;',
  '       spf=pass (google.com: domain of no-reply@mngl.in designates 1.2.3.4 as permitted sender) smtp.mailfrom=mngl.in;',
  '       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=mngl.in',
  'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mngl.in; s=sel2023;',
  'From: Rise <no-reply@mngl.in>',
  'Reply-To: support@riseworks.digital',
  'Subject: Action Required: Scheduled KYC Re-Verification',
  'Message-ID: <abc123@mngl.in>',
  'MIME-Version: 1.0',
].join('\n');

function showOriginalPage(bodyAfterBlankLine: string): ReturnType<typeof fakeDocument> {
  const text = `${REAL_HEADER_BLOCK}\n\n${bodyAfterBlankLine}`;
  return fakeDocument({ tag: 'div', attrs: { role: 'main' }, children: [{ tag: 'div', text }] });
}

describe('penguraian blok header', () => {
  it('mengurai header yang dicari dari blok realistis', () => {
    const headers = parseHeaderBlock(REAL_HEADER_BLOCK);

    expect(headers['return-path']).toBe('<no-reply@mngl.in>');
    expect(headers['reply-to']).toBe('support@riseworks.digital');
    expect(headers['from']).toBe('Rise <no-reply@mngl.in>');
    expect(headers['authentication-results']).toContain('dkim=pass');
  });

  it('menggabungkan baris lanjutan (folding)', () => {
    const headers = parseHeaderBlock(REAL_HEADER_BLOCK);
    // Authentication-Results terpotong menjadi beberapa baris dengan indentasi.
    expect(headers['authentication-results']).toContain('dmarc=pass');
    expect(headers['authentication-results']?.includes('\n')).toBe(false);
  });

  it('memakai kemunculan terakhir untuk header yang berulang', () => {
    const text = ['Return-Path: <lama@example.com>', 'Return-Path: <baru@example.com>'].join('\n');
    expect(parseHeaderBlock(text)['return-path']).toBe('<baru@example.com>');
  });

  it('mengembalikan objek kosong bila tidak ada header yang dikenal', () => {
    expect(parseHeaderBlock('ini bukan header sama sekali\nbaris kedua')).toEqual({});
  });
});

describe('penjagaan terhadap header palsu di badan pesan', () => {
  it('berhenti pada baris kosong pertama sehingga header palsu di badan diabaikan', () => {
    // Ini penjagaan terpenting di modul ini. Isi pesan dikendalikan penyerang, jadi
    // sebuah email cukup menulis header palsu di badannya untuk membalik hasil
    // analisis — kalau penguraian tidak berhenti di batas header.
    const forgedBody = [
      'Return-Path: <pengirim-sah@bank-resmi.co.id>',
      'Authentication-Results: mx.google.com; dmarc=pass header.from=bank-resmi.co.id',
      'From: Bank Resmi <cs@bank-resmi.co.id>',
    ].join('\n');

    const headers = parseHeaderBlock(`${REAL_HEADER_BLOCK}\n\n${forgedBody}`);

    expect(headers['return-path']).toBe('<no-reply@mngl.in>');
    expect(headers['from']).toBe('Rise <no-reply@mngl.in>');
    expect(headers['authentication-results']).not.toContain('bank-resmi.co.id');
  });

  it('menolak blok yang hanya berisi header tiruan tanpa header tepercaya', () => {
    // Tanpa `Return-Path`, `Authentication-Results`, `DKIM-Signature`, `Delivered-To`,
    // atau `Received`, sebuah blok teks bukan blok header.
    const doc = fakeDocument({
      tag: 'div',
      text: 'From: Bank Resmi <cs@bank-resmi.co.id>\nReply-To: cs@bank-resmi.co.id\n'.padEnd(
        200,
        'x',
      ),
    });

    const report = scanGmailShowOriginal(doc);
    expect(report.matched).toBe(false);
    expect(report.identity).toBeNull();
    expect(report.notes.some((note) => note.includes('tidak ditemukan'))).toBe(true);
  });
});

describe('pemindaian halaman Show original', () => {
  it('menghasilkan identitas Tier B lengkap dari halaman yang sah', () => {
    const report = scanGmailShowOriginal(showOriginalPage('Isi pesan ada di sini.'));

    expect(report.matched).toBe(true);
    // Alamat saja, bukan nilai header utuh: engine memang menerima keduanya, tetapi
    // bentuk yang seragam dengan Tier A mencegah pemanggil mencetak
    // `Rise <Rise <no-reply@mngl.in>>`.
    expect(report.identity?.fromAddress).toBe('no-reply@mngl.in');
    expect(report.identity?.displayName).toBe('Rise');
    expect(report.identity?.replyTo).toBe('support@riseworks.digital');
    expect(report.identity?.returnPath).toBe('<no-reply@mngl.in>');
    expect(report.identity?.authenticationResults).toContain('dmarc=pass');
  });

  it('menyimpan alamat saja pada fromAddress, bukan nilai header utuh', () => {
    // Bentuk ini yang membuat `displayName <fromAddress>` dapat dicetak tanpa
    // menghasilkan alamat bersarang.
    const text = [
      'Return-Path: <bounce@sendgrid.net>',
      'Authentication-Results: mx.google.com; dmarc=pass header.from=example.com',
      'From: "Budi Santoso" <budi@example.com>',
    ].join('\n');

    const report = scanGmailShowOriginal(fakeDocument({ tag: 'div', text }));
    expect(report.identity?.fromAddress).toBe('budi@example.com');
    expect(report.identity?.displayName).toBe('Budi Santoso');
  });

  it('melaporkan header mana saja yang berhasil diurai', () => {
    const report = scanGmailShowOriginal(showOriginalPage('Isi pesan.'));
    expect(Object.keys(report.headers)).toContain('from');
    expect(Object.keys(report.headers)).toContain('reply-to');
  });

  it('melaporkan no-op ketika halaman bukan halaman Show original', () => {
    const doc = fakeDocument({ tag: 'div', text: 'Ini halaman inbox biasa tanpa header.' });
    const report = scanGmailShowOriginal(doc);

    expect(report.matched).toBe(false);
    expect(report.identity).toBeNull();
  });

  it('tetap bekerja bila header From tidak ada', () => {
    const text = [
      'Return-Path: <bounce@sendgrid.net>',
      'Authentication-Results: mx.google.com; dmarc=pass header.from=example.com',
      'Reply-To: support@example.com',
    ].join('\n');

    const report = scanGmailShowOriginal(fakeDocument({ tag: 'div', text }));
    expect(report.matched).toBe(true);
    expect(report.identity?.replyTo).toBe('support@example.com');
    expect(report.identity?.fromAddress).toBeUndefined();
  });

  it('deterministik', () => {
    const build = () => showOriginalPage('Isi pesan.');
    expect(scanGmailShowOriginal(build())).toEqual(scanGmailShowOriginal(build()));
  });
});

describe('display name pada nilai header', () => {
  it('mengambil nama dari bentuk bertanda kurung sudut', () => {
    expect(extractDisplayName('Rise <no-reply@mngl.in>')).toBe('Rise');
    expect(extractDisplayName('Budi Santoso <budi@example.com>')).toBe('Budi Santoso');
    expect(extractDisplayName('"Budi Santoso" <budi@example.com>')).toBe('Budi Santoso');
  });

  it('mengembalikan null bila hanya ada alamat', () => {
    // Sesuai arti `displayName: null` di engine: webmail tidak menampilkan nama.
    expect(extractDisplayName('no-reply@mngl.in')).toBeNull();
    expect(extractDisplayName('<no-reply@mngl.in>')).toBeNull();
    expect(extractDisplayName('   <a@b.com>')).toBeNull();
  });

  it('menangani nama yang memuat tanda kurung sudut di dalam kutipan', () => {
    expect(extractDisplayName('"Rise <Support>" <cs@rise.com>')).toBe('Rise <Support>');
  });
});

describe('decoding encoded-word RFC 2047', () => {
  it('mendekode bentuk base64', () => {
    const encoded = `=?UTF-8?B?${Buffer.from('José Álvarez', 'utf8').toString('base64')}?=`;
    expect(decodeEncodedWords(encoded)).toBe('José Álvarez');
  });

  it('mendekode bentuk quoted-printable', () => {
    expect(decodeEncodedWords('=?UTF-8?Q?Jos=C3=A9_=C3=81lvarez?=')).toBe('José Álvarez');
  });

  it('mendekode nama dengan aksara non-Latin', () => {
    for (const name of ['東京商事', '한국무역', 'Москва', 'भारत']) {
      const encoded = `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
      expect(decodeEncodedWords(encoded), name).toBe(name);
    }
  });

  it('membiarkan teks biasa apa adanya', () => {
    expect(decodeEncodedWords('Rise')).toBe('Rise');
    expect(decodeEncodedWords('Budi Santoso <budi@example.com>')).toBe('Budi Santoso <budi@example.com>');
  });

  it('membiarkan encoded-word yang rusak apa adanya, tidak melempar', () => {
    expect(() => decodeEncodedWords('=?UTF-8?B?!!!bukan-base64!!!?=')).not.toThrow();
    expect(() => decodeEncodedWords('=?charset-tidak-dikenal?B?YWJj?=')).not.toThrow();
  });

  it('mendekode display name yang ter-encode di dalam blok header', () => {
    const encoded = `=?UTF-8?B?${Buffer.from('José Álvarez', 'utf8').toString('base64')}?=`;
    const text = [
      'Return-Path: <jose@example.com>',
      'Authentication-Results: mx.google.com; dmarc=pass header.from=example.com',
      `From: ${encoded} <jose.alvarez@example.com>`,
    ].join('\n');

    const report = scanGmailShowOriginal(fakeDocument({ tag: 'div', text }));
    expect(report.identity?.displayName).toBe('José Álvarez');
  });
});
