import { describe, expect, it } from 'vitest';
import { classifyPage } from '../src/lib/view.ts';

const at = (href: string): { href: string } => ({ href });

/**
 * Id thread Gmail yang dipakai di test ini adalah bentuk yang benar-benar muncul:
 * string campuran huruf besar-kecil sepanjang 33 karakter, dan 16 digit heksadesimal.
 */
const THREAD_ID = 'FMfcgzQhWfTQKcgkqjfRTgcjdqRfjvSM';
const HEX_ID = '17b1a2c3d4e5f6a7';
const U = 'https://mail.google.com/mail/u/0/';

describe('jenis halaman', () => {
  it('thread terbuka dikenali dari id di hash', () => {
    expect(classifyPage(at(`${U}#inbox/${THREAD_ID}`))).toBe('thread');
    expect(classifyPage(at(`${U}#all/${THREAD_ID}`))).toBe('thread');
    expect(classifyPage(at(`${U}#sent/${HEX_ID}`))).toBe('thread');
    expect(classifyPage(at(`${U}#spam/${THREAD_ID}`))).toBe('thread');
    expect(classifyPage(at(`${U}#label/Work/${THREAD_ID}`))).toBe('thread');
  });

  it('thread yang dibuka dari hasil pencarian juga dikenali', () => {
    // Bentuknya tiga segmen: `#search/<query>/<id>`. Ini yang membedakannya dari hasil
    // pencarian biasa, dan sekaligus alasan query tidak boleh dianggap id.
    expect(classifyPage(at(`${U}#search/dari%3Abank/${THREAD_ID}`))).toBe('thread');
  });

  it('hasil pencarian biasa bukan thread', () => {
    expect(classifyPage(at(`${U}#search/halo%20dunia`))).toBe('list');
    expect(classifyPage(at(`${U}#search/dari%3Abank`))).toBe('list');
    // Query yang panjang dan tanpa spasi pun bukan thread: pencarian dua segmen selalu
    // berarti daftar hasil, apa pun bentuk query-nya.
    expect(classifyPage(at(`${U}#search/FMfcgzQhWfTQKcgkqjfRTgcjdqRfjvSM`))).toBe('list');
  });

  it('list view bukan thread', () => {
    expect(classifyPage(at(`${U}#inbox`))).toBe('list');
    expect(classifyPage(at(`${U}#starred`))).toBe('list');
    expect(classifyPage(at(`${U}#label/Work`))).toBe('list');
    expect(classifyPage(at(`${U}#drafts`))).toBe('list');
    expect(classifyPage(at(`${U}`))).toBe('list');
  });

  it('halaman pengaturan bukan thread dan bukan list', () => {
    // Nama segmen di pengaturan dapat panjang, sehingga tanpa cabang khusus ia akan
    // lolos sebagai id thread dan panel muncul di halaman yang salah.
    expect(classifyPage(at(`${U}#settings/general`))).toBe('other');
    expect(classifyPage(at(`${U}#settings/filters`))).toBe('other');
  });

  it('halaman Show original dikenali lebih dulu', () => {
    expect(classifyPage(at(`${U}?ik=abc&view=om&th=${THREAD_ID}`))).toBe('show-original');
    // Halaman itu juga memuat id thread di query-nya; urutan pemeriksaan yang benar
    // membuatnya tidak pernah salah dikenali sebagai thread terbuka.
    expect(classifyPage(at(`${U}?view=om#inbox/${THREAD_ID}`))).toBe('show-original');
  });

  it('host yang menyerupai Gmail bukan Gmail', () => {
    // Pemeriksaannya beranker di awal URL, bukan mencari "mail.google.com" di seluruh
    // string: host seperti ini memuat nama itu, dan tetap bukan Gmail.
    expect(classifyPage(at(`https://mail.google.com.evil.example/mail/u/0/#inbox/${THREAD_ID}`))).toBe('other');
    expect(classifyPage(at(`https://notgmail.com/mail/u/0/#inbox/${THREAD_ID}`))).toBe('other');
    expect(classifyPage(at('https://example.com/'))).toBe('other');
  });

  it('HTTP biasa tetap diterima, karena hostnya yang menentukan', () => {
    expect(classifyPage(at(`http://mail.google.com/mail/u/0/#inbox/${THREAD_ID}`))).toBe('thread');
  });
});
