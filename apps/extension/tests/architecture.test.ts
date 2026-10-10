import { readdirSync, readFileSync } from 'node:fs';
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
 * **3. Tidak ada permintaan jaringan sama sekali.** Ini janji yang membuat ekstensi boleh
 * menyentuh kotak masuk orang, dan ia pernah dilonggarkan lalu dicabut kembali — lihat
 * catatan keputusan di `docs/DESIGN.md` D1. Aturan ini berlaku untuk **seluruh** berkas di
 * `src`, bukan hanya daftar berkas yang disebut namanya, supaya berkas baru tidak lolos
 * hanya karena belum terdaftar.
 *
 * Ketiganya diperiksa pada **source**, bukan pada perilaku, karena pelanggarannya justru
 * tidak akan terlihat di test perilaku: kode yang menyentuh `document` hanya gagal di Node,
 * kode yang memakai `innerHTML` hanya berbahaya di browser, dan permintaan jaringan hanya
 * terlihat di log jaringan milik orang lain.
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

/**
 * Seluruh berkas TypeScript di `src`, relatif terhadap `srcDir`.
 *
 * Dipakai penjaga jaringan supaya berkas baru tidak lolos hanya karena namanya belum
 * terdaftar pada daftar yang diperiksa.
 */
function sourceFiles(directory = ''): string[] {
  const absolute = join(srcDir, directory);
  const out: string[] = [];

  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(relative));
    else if (entry.name.endsWith('.ts')) out.push(relative);
  }

  return out;
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

  it('versi manifes berasal dari versi rilis, bukan angka yang ditulis di berkas ini', () => {
    // Angka ini yang dicatat AMO, dan AMO menuntut setiap unggahan lebih tinggi daripada
    // seluruh versi yang pernah diterbitkan di sana. Sebelum ini, angkanya datang dari
    // `package.json` paket ekstensi, dan angka itu tetap 0.3.0 sepanjang rilis 0.4.0 sampai
    // 0.6.3 — otomatisasi rilis hanya menaikkan `package.json` akar — sehingga add-on
    // pertama akan terbit sebagai 0.3.0 sementara tag dan catatan rilisnya menyebut 0.6.x.
    //
    // Kegagalan seperti itu tidak terlihat sebelum add-on terbit, dan setelah terbit ia tidak
    // dapat diperbaiki: versi yang sudah dipakai tidak dapat ditarik dari daftar versi AMO.
    // Karena itu angkanya dibaca dari akar workspace, dan test ini menjaga agar ia tidak
    // kembali ditulis di sini.
    const config = stripComments(readFileSync(join(here, '..', 'wxt.config.ts'), 'utf8'));

    expect(config, 'manifes tidak memakai versi rilis').toContain('version: releaseVersion');
    expect(config, 'versi rilis tidak dibaca dari package.json akar').toMatch(/package\.json/);
    expect(config, 'ada angka versi yang ditulis langsung di berkas ini').not.toMatch(
      /version:\s*\d/,
    );
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
    // Aturan ini sempat dilonggarkan: panel pernah punya tombol yang mengambil halaman
    // header pesan dari Gmail. Percobaan itu dicabut kembali, dan alasannya dicatat di
    // `docs/DESIGN.md` D1 — janji "tanpa permintaan jaringan" adalah alasan utama alat ini
    // boleh menyentuh kotak masuk orang, dan menukarnya dengan satu tombol tidak sebanding.
    // Yang menggantikannya bukan pengecualian, melainkan kalimat yang lebih preventif pada
    // panel state `UNASSESSABLE`: alasan mengapa tidak dinilai, dan langkah aman yang dapat
    // dikerjakan pengguna.
    const network = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bsendBeacon\b/];
    const violations: string[] = [];

    const files = [
      'lib/view.ts',
      'lib/scan.ts',
      'lib/panel-model.ts',
      'lib/panel-view.ts',
      'entrypoints/gmail.content.ts',
    ];

    for (const file of files) {
      const code = stripComments(readSource(file));
      for (const pattern of network) {
        if (pattern.test(code)) violations.push(`${file}: ${String(pattern)}`);
      }
    }

    // Berkas apa pun di `src` juga diperiksa, supaya berkas baru tidak lolos hanya karena
    // namanya belum terdaftar di atas.
    for (const file of sourceFiles()) {
      if (files.includes(file)) continue;
      const code = stripComments(readSource(file));
      for (const pattern of network) {
        if (pattern.test(code)) violations.push(`${file}: ${String(pattern)}`);
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
