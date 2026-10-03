import { describe, expect, it } from 'vitest';
import { ALL_RULE_CODES, type RuleCode } from '@sender-check/core';
import { RULE_TEMPLATES, describeRule } from '../src/sentences.ts';

/**
 * Kelengkapan kalimat bukti.
 *
 * Dua kesalahan yang dijaga di sini, dan keduanya pernah terjadi:
 *
 *  - **kode tanpa kalimat.** Tiga kode Tier B (`RETURN_PATH_NULL_OR_MISMATCH`,
 *    `AUTH_SPF_FAIL`, `AUTH_DKIM_FAIL`) tidak punya template sama sekali, sehingga pengguna
 *    melihat `trace` mentah yang ditulis untuk pengembang;
 *  - **template untuk kode yang tidak ada.** Sisa kode yang sudah dihapus dari katalog akan
 *    tetap dirawat tanpa alasan, dan menyembunyikan bahwa cakupannya tidak lagi lengkap.
 *
 * Yang **tidak** dijaga di sini adalah apakah nama argumen di dalam template benar. Itu
 * diuji di `tools/corpus/tests/presentation.test.ts`, karena hanya di sana `args` yang
 * benar-benar dipancarkan engine tersedia.
 */
describe('kalimat bukti', () => {
  it('setiap kode rule punya template kalimat', () => {
    const missing = ALL_RULE_CODES.filter((code) => RULE_TEMPLATES[code] === undefined);
    expect(missing, `kode tanpa kalimat: ${missing.join(', ')}`).toEqual([]);
  });

  it('tidak ada template untuk kode di luar katalog', () => {
    const catalog = new Set<string>(ALL_RULE_CODES);
    const extra = Object.keys(RULE_TEMPLATES).filter((code) => !catalog.has(code));
    expect(extra, `template tanpa kode: ${extra.join(', ')}`).toEqual([]);
  });

  it('tidak ada template yang menghasilkan kalimat kosong', () => {
    // Argumen kosong di sini hanya untuk memastikan setiap template mengembalikan sesuatu.
    // Apakah nama argumennya benar diuji di `tools/corpus/tests/presentation.test.ts`,
    // karena hanya di sana `args` yang benar-benar dipancarkan engine tersedia.
    const empty: string[] = [];
    for (const code of ALL_RULE_CODES) {
      const sentence = describeRule(code, {}, 'trace');
      if (sentence.trim().length === 0) empty.push(code);
    }
    expect(empty, `kalimat kosong: ${empty.join(', ')}`).toEqual([]);
  });

  it('jatuh ke trace hanya untuk kode di luar katalog', () => {
    // Jalur cadangan ini ada supaya versi engine yang lebih baru daripada lapisan ini tidak
    // membuat panel kosong. Ia bukan jalur normal.
    expect(describeRule('KODE_DARI_MASA_DEPAN' as RuleCode, {}, 'bukti mentah')).toBe(
      'bukti mentah',
    );
  });

  it('kalimat Return-Path yang tidak ada tidak menampilkan domain kosong', () => {
    // `returnPath` kosong berarti headernya tidak ada. Kalimat yang menampilkan `""` akan
    // membuat pengguna mengira ada domain tak bernama yang mengirim pesan.
    const absent = describeRule('RETURN_PATH_NULL_OR_MISMATCH', { returnPath: '', from: 'example.com' }, 't');

    expect(absent).toContain('tidak ada');
    expect(absent).toContain('example.com');
    expect(absent).not.toContain('""');
  });

  it('kalimat Return-Path yang berbeda menyebut kedua domain', () => {
    const differs = describeRule(
      'RETURN_PATH_NULL_OR_MISMATCH',
      { returnPath: 'sendgrid.net', from: 'example.com' },
      't',
    );

    expect(differs).toContain('sendgrid.net');
    expect(differs).toContain('example.com');
  });

  it('kegagalan SPF dan DKIM memakai bentuk yang sama dengan DMARC', () => {
    // Ketiganya adalah hasil autentikasi, dan pengguna membacanya berdampingan. Bentuk yang
    // berbeda untuk hal yang sama membuat salah satunya tampak lebih penting.
    const spf = describeRule('AUTH_SPF_FAIL', { result: 'fail' }, 't');
    const dkim = describeRule('AUTH_DKIM_FAIL', { result: 'softfail' }, 't');
    const dmarc = describeRule('AUTH_DMARC_FAIL', { result: 'fail' }, 't');

    expect(spf).toBe('SPF fail untuk domain pengirim');
    expect(dkim).toBe('DKIM softfail untuk domain pengirim');
    expect(dmarc).toBe('DMARC fail untuk domain pengirim');
  });

  it('kalimat utama kasus phishing nyata memakai wording yang dikutip dokumentasi', () => {
    // README dan `docs/USAGE.md` mengutip kalimat ini apa adanya. Sebelum lapisan ini ada,
    // skrip konsol memakai wording yang berbeda ("ada di" alih-alih "muncul di"), sehingga
    // dokumentasi dan keluaran tidak lagi sepakat.
    const sentence = describeRule(
      'REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT',
      { token: 'rise', replyTo: 'riseworks.digital', from: 'mngl.in' },
      't',
    );

    expect(sentence).toBe(
      '"rise" muncul di domain tujuan balasan "riseworks.digital", tetapi tidak di domain pengirim "mngl.in"',
    );
  });
});
