import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga arsitektur ekstensi.
 *
 * Ekstensi ini punya satu risiko yang tidak dimiliki paket lain: ia berjalan di dalam
 * halaman web milik orang lain, dengan sesi webmail pengguna yang sedang aktif. Dua aturan
 * di bawah karena itu bukan soal kerapian.
 *
 * **1. Modul logika tidak boleh menyentuh global browser.** `view.ts`, `scan.ts`, dan
 * `panel-model.ts` harus tetap dapat dijalankan di Node, karena di situlah seluruh
 * keputusannya diuji. Begitu salah satunya menyentuh `document`, testnya hanya dapat
 * dijalankan di browser, dan cakupannya akan turun tanpa ada yang menyadarinya.
 *
 * **2. Lapisan tampilan tidak boleh menafsirkan teks sebagai HTML.** Display name, alamat,
 * dan subjek yang ditampilkan berasal dari email yang dikendalikan penyerang. Satu
 * `innerHTML` saja cukup untuk menjalankan markupnya di dalam sesi webmail pengguna.
 *
 * Keduanya diperiksa pada **source**, bukan pada perilaku, karena pelanggarannya justru
 * tidak akan terlihat di test perilaku: kode yang menyentuh `document` hanya gagal di Node,
 * dan kode yang memakai `innerHTML` hanya berbahaya di browser.
 */
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/**
 * Membuang komentar sebelum memeriksa.
 *
 * Tanpa ini, penjaganya menjadi hampa dengan cara yang lucu: berkas `panel-view.ts`
 * **menyebut** `innerHTML` di dalam penjelasannya untuk menyatakan bahwa ia tidak
 * memakainya, dan pemeriksaan naif akan menuduhnya.
 *
 * ## Kenapa baris per baris, bukan regex
 *
 * Versi pertama fungsi ini memakai `replace(/\/\*[\s\S]*?\*\//g, '')`, dan regex itu
 * **menelan kode**. Penyebabnya adalah baris ini di content script:
 *
 * ```ts
 * matches: ['https://mail.google.com/*'],
 * ```
 *
 * `/*` di dalam string itu dibaca sebagai pembuka komentar blok, dan komentar itu baru
 * tertutup oleh `*​/` pada JSDoc jauh di bawahnya — sehingga dua ribu karakter isi berkas
 * hilang sebelum diperiksa, termasuk baris yang justru dicari test ini. Penjaganya gagal
 * bukan karena menemukan pelanggaran, melainkan karena kehilangan buktinya.
 *
 * Pengurai di bawah mengenali komentar hanya bila ia **memulai baris**, dan itu berlaku
 * untuk seluruh berkas di repositori ini: komentarnya selalu ditulis pada barisnya sendiri.
 * Batasnya disebutkan supaya tidak dikira lebih kuat daripada kenyataannya — komentar di
 * ujung baris kode tidak dibuang.
 */
function stripComments(source: string): string {
  const kept: string[] = [];
  let insideBlock = false;

  for (const line of source.split('\n')) {
    if (insideBlock) {
      if (line.includes('*/')) insideBlock = false;
      continue;
    }

    const trimmed = line.trimStart();

    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) insideBlock = true;
      continue;
    }

    if (trimmed.startsWith('//')) continue;

    kept.push(line);
  }

  return kept.join('\n');
}

function readSource(relativePath: string): string {
  return readFileSync(join(srcDir, relativePath), 'utf8');
}

const PURE_MODULES = ['lib/view.ts', 'lib/scan.ts', 'lib/panel-model.ts'] as const;

/** Global browser yang tidak boleh muncul di modul logika. */
const BROWSER_GLOBALS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'document.', pattern: /\bdocument\./ },
  { label: 'window.', pattern: /\bwindow\./ },
  { label: 'chrome.', pattern: /\bchrome\./ },
  { label: 'browser.', pattern: /\bbrowser\./ },
  { label: 'globalThis.', pattern: /\bglobalThis\./ },
  { label: 'MutationObserver', pattern: /\bMutationObserver\b/ },
];

/** API yang menafsirkan teks sebagai HTML. */
const HTML_INJECTION: readonly { label: string; pattern: RegExp }[] = [
  { label: 'innerHTML', pattern: /\binnerHTML\b/ },
  { label: 'outerHTML', pattern: /\bouterHTML\b/ },
  { label: 'insertAdjacentHTML', pattern: /\binsertAdjacentHTML\b/ },
  { label: 'document.write', pattern: /\bdocument\.write\b/ },
  { label: 'eval', pattern: /\beval\s*\(/ },
];

describe('arsitektur ekstensi', () => {
  it('modul logika tidak menyentuh global browser', () => {
    const violations: string[] = [];

    for (const file of PURE_MODULES) {
      const code = stripComments(readSource(file));
      for (const { label, pattern } of BROWSER_GLOBALS) {
        if (pattern.test(code)) violations.push(`${file}: ${label}`);
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('lapisan tampilan tidak pernah menafsirkan teks sebagai HTML', () => {
    const code = stripComments(readSource('lib/panel-view.ts'));
    const violations = HTML_INJECTION.filter(({ pattern }) => pattern.test(code)).map(
      ({ label }) => `lib/panel-view.ts: ${label}`,
    );

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('penjaga membaca kode yang sebenarnya, bukan sisa komentar', () => {
    // Penjaga yang memeriksa berkas kosong akan selalu lulus. Batas panjang ini memastikan
    // `stripComments` tidak membuang seluruh isi berkas, sehingga hijau di atas bermakna.
    for (const file of [...PURE_MODULES, 'lib/panel-view.ts']) {
      const code = stripComments(readSource(file));
      expect(code.length, `${file} tersisa ${code.length} karakter`).toBeGreaterThan(500);
    }
  });

  it('entrypoint menyuntikkan gaya ke dalam shadow root, bukan ke halaman', () => {
    // Tanpa `cssInjectionMode: 'ui'`, CSS panel akan bocor ke webmail dan gaya webmail akan
    // masuk ke panel — persis dua hal yang dicegah oleh shadow root.
    const code = stripComments(readSource('entrypoints/gmail.content.ts'));

    expect(code).toContain("cssInjectionMode: 'ui'");
    expect(code).toMatch(/import\s+'[^']*panel\.css'/);
    expect(code).toContain("position: 'inline'");
  });

  it('manifest tidak meminta permission yang tidak dipakai', () => {
    // `docs/DESIGN.md` bagian 10 menetapkan batas ini: tanpa `<all_urls>`, tanpa `tabs`,
    // tanpa `webRequest`. Diperiksa pada teks berkasnya karena memuat berkas konfigurasi
    // WXT di dalam test berarti memuat seluruh rantai build-nya.
    const config = stripComments(readFileSync(join(here, '..', 'wxt.config.ts'), 'utf8'));

    expect(config).toContain("'https://mail.google.com/*'");
    for (const forbidden of ['<all_urls>', "'tabs'", "'webRequest'", "'cookies'", "'history'"]) {
      expect(config, `manifest meminta ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('pernyataan pengumpulan data sesuai dengan kode yang tidak mengirim apa pun', () => {
    // Firefox mewajibkan pernyataan ini, dan pernyataan yang salah adalah masalah yang
    // lebih serius daripada peringatan build: ia pernyataan resmi kepada pengguna.
    // Ekstensi ini tidak melakukan network request sama sekali, jadi `none` satu-satunya
    // nilai yang benar. Test ini ada supaya perubahannya tidak dapat terjadi diam-diam.
    const config = stripComments(readFileSync(join(here, '..', 'wxt.config.ts'), 'utf8'));

    expect(config).toContain("required: ['none']");
  });

  it('kode ekstensi tidak melakukan network request', () => {
    const network = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/];
    const violations: string[] = [];

    for (const file of ['lib/view.ts', 'lib/scan.ts', 'lib/panel-model.ts', 'lib/panel-view.ts', 'entrypoints/gmail.content.ts']) {
      const code = stripComments(readSource(file));
      for (const pattern of network) {
        if (pattern.test(code)) violations.push(`${file}: ${String(pattern)}`);
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
