import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Penjaga encoding berkas teks.
 *
 * Test ini ada karena masalahnya benar-benar terjadi: sebuah `Get-Content`/`Set-Content`
 * PowerShell membaca UTF-8 sebagai Windows-1252 lalu menulisnya kembali sebagai UTF-8,
 * sehingga seluruh karakter non-ASCII di `docs/DESIGN.md` berubah menjadi pasangan huruf
 * yang salah. Kerusakan itu tidak menggagalkan typecheck, tidak menggagalkan test, dan
 * tidak terlihat sampai dokumennya dibaca manusia.
 *
 * Pola disusun dari code point, bukan ditulis literal, supaya berkas penjaga ini sendiri
 * tidak memicu pemeriksaannya. Deteksinya juga bukan sekadar "ada karakter non-ASCII",
 * karena repositori ini memang sengaja memuat `≥`, `→`, `⊂`, `⚠`, dan huruf Cyrillic
 * sebagai contoh homoglyph.
 */

/** Membentuk string dari code point, agar berkas ini tidak memuat polanya secara literal. */
const cps = (...codes: readonly number[]): string => String.fromCodePoint(...codes);

/**
 * Byte UTF-8 yang terbaca sebagai CP1252 selalu menghasilkan pasangan
 * [U+00E2, salah satu karakter khusus CP1252]. Pasangan itu tidak muncul dalam bahasa
 * Indonesia maupun Inggris biasa, sehingga aman dipakai sebagai penanda.
 */
const MOJIBAKE_SECOND_BYTES = [
  0x2030, 0x2020, 0x20ac, 0x2039, 0x203a, 0x201a, 0x201e, 0x2026, 0x02c6, 0x02dc, 0x2122,
  0x0160, 0x0161, 0x017d, 0x017e, 0x0152, 0x0153, 0x0192,
];

const MOJIBAKE_MARKERS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'UTF-8 yang terbaca sebagai CP1252',
    pattern: new RegExp(`${cps(0xe2)}[${MOJIBAKE_SECOND_BYTES.map((cp) => cps(cp)).join('')}]`),
  },
  {
    label: 'awalan multi-byte yang rusak',
    pattern: new RegExp(`${cps(0xc3)}[${cps(0x80)}-${cps(0xbf)}]`),
  },
  { label: 'karakter pengganti Unicode', pattern: new RegExp(cps(0xfffd)) },
];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const TEXT_EXTENSIONS = new Set(['.ts', '.md', '.json', '.yaml', '.yml', '.mjs', '.txt']);
const EXTENSIONLESS_TEXT_FILES = new Set(['.gitignore']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.wxt',
  '.output',
  'reports',
]);

interface TextFile {
  readonly path: string;
  readonly content: string;
}

function collectTextFiles(directory: string): TextFile[] {
  const found: TextFile[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;

    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTextFiles(full));
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(entry.name)) && !EXTENSIONLESS_TEXT_FILES.has(entry.name)) {
      continue;
    }

    found.push({
      path: relative(repoRoot, full).replaceAll('\\', '/'),
      content: readFileSync(full, 'utf8'),
    });
  }

  return found;
}

const textFiles = collectTextFiles(repoRoot);

function file(path: string): TextFile | undefined {
  return textFiles.find((item) => item.path === path);
}

describe('encoding berkas teks', () => {
  it('menemukan berkas teks untuk diperiksa', () => {
    expect(textFiles.length).toBeGreaterThan(20);
  });

  it('memeriksa berkas yang selama ini menjadi korban', () => {
    expect(file('docs/DESIGN.md')).toBeDefined();
    expect(file('README.md')).toBeDefined();
  });

  for (const { label, pattern } of MOJIBAKE_MARKERS) {
    it(`tidak memuat ${label}`, () => {
      const offenders = textFiles
        .filter((item) => pattern.test(item.content))
        .map((item) => item.path);
      expect(offenders, `${label} ditemukan di: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('dokumen memang memuat karakter non-ASCII yang disengaja', () => {
    // Kebalikan dari pemeriksaan di atas: memastikan penjaga tidak lulus hanya karena
    // seluruh karakter non-ASCII kebetulan hilang.
    const design = file('docs/DESIGN.md');
    expect(design).toBeDefined();
    const nonAscii = new Set(
      [...(design?.content ?? '')].filter((char) => (char.codePointAt(0) ?? 0) > 0x7f),
    );
    expect(nonAscii.size).toBeGreaterThan(5);
    expect(nonAscii.has(cps(0x2265))).toBe(true); // lebih besar atau sama dengan
    expect(nonAscii.has(cps(0x2192))).toBe(true); // panah kanan
  });

  it('seluruh berkas JSON dapat di-parse dan tidak diawali BOM', () => {
    // Test ini ada karena kerusakannya benar-benar terjadi: `Set-Content -Encoding utf8`
    // PowerShell menambahkan BOM, dan BOM di dalam package.json membuat `JSON.parse`
    // gagal. Versi pertama test ini hanya memeriksa berkas fixture, sehingga enam
    // package.json sempat rusak tanpa ada yang menangkapnya.
    const jsonFiles = textFiles.filter((item) => item.path.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(5);

    for (const item of jsonFiles) {
      expect(item.content.charCodeAt(0), `${item.path} diawali BOM`).not.toBe(0xfeff);
      expect(() => JSON.parse(item.content), item.path).not.toThrow();
    }
  });

  it('package.json memuat medan yang wajib ada', () => {
    const packages = textFiles.filter((item) => item.path.endsWith('package.json'));
    expect(packages.length).toBeGreaterThan(3);

    for (const item of packages) {
      const parsed = JSON.parse(item.content) as { name?: string; version?: string; license?: string };
      expect(parsed.name, `${item.path} tanpa name`).toBeTruthy();
      expect(parsed.version, `${item.path} tanpa version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(parsed.license, `${item.path} tanpa license`).toBe('MIT');
    }
  });

  it('berkas sumber TypeScript tidak diawali BOM', () => {
    for (const item of textFiles) {
      if (!item.path.endsWith('.ts')) continue;
      expect(item.content.charCodeAt(0), `${item.path} diawali BOM`).not.toBe(0xfeff);
    }
  });
});

describe('kebersihan repositori', () => {
  it('tidak meninggalkan berkas sementara di akar repositori', () => {
    const strays = readdirSync(repoRoot).filter(
      (name) => /^(tmp|temp|scratch|fix-|probe)/i.test(name) && statSync(join(repoRoot, name)).isFile(),
    );
    expect(strays, `berkas sementara tertinggal: ${strays.join(', ')}`).toEqual([]);
  });

  it('tidak meninggalkan skrip sementara berawalan zz-', () => {
    // Berkas sementara sungguhan pernah tertinggal di `tools/console/` setelah
    // verifikasi manual. Awalan `zz-` dipakai untuk menandainya justru supaya
    // pemeriksaan ini dapat menemukannya.
    const strays = textFiles
      .filter((item) => item.path.split('/').some((part) => part.startsWith('zz-')))
      .map((item) => item.path);
    expect(strays, `skrip sementara tertinggal: ${strays.join(', ')}`).toEqual([]);
  });

  it('tidak memuat alamat surel pribadi', () => {
    // Repositori ini publik, dan berkas uji tidak pernah membutuhkan alamat asli:
    // `example.com` sudah cukup untuk menguji penguraian header. Penjaga ini ada karena
    // satu alamat pribadi benar-benar sempat masuk ke blok header contoh, dan ia sudah
    // ter-commit sebelum ketahuan — pada titik itu menghapusnya dari riwayat jauh lebih
    // merepotkan daripada mencegahnya.
    //
    // Yang diperiksa hanya bagian pengenal alamatnya, bukan username publik yang memang
    // dipakai di LICENSE, README, dan package.json. Polanya dibentuk dari code point
    // supaya berkas penjaga ini tidak menuduh dirinya sendiri.
    //
    // Ratusan alamat fiktif di `tools/corpus/fixtures/` dan `tokens.ts` tidak tersentuh,
    // karena itu memang data uji yang disengaja, bukan data siapa pun.
    const personalLocalPart = cps(0x6d, 0x73, 0x79, 0x61, 0x6d, 0x73, 0x75, 0x64, 0x69, 0x6e, 0x31, 0x39, 0x39, 0x34);
    // Diperiksa bentuknya, bukan dibandingkan dengan literalnya: menulis literalnya di
    // sini akan membuat berkas ini menuduh dirinya sendiri.
    expect(personalLocalPart).toMatch(/^[a-z0-9]{8,}$/);

    const offenders = textFiles
      .filter((item) => item.content.toLowerCase().includes(personalLocalPart))
      .map((item) => item.path);
    expect(offenders, `alamat pribadi ditemukan di: ${offenders.join(', ')}`).toEqual([]);
  });

  it('seluruh berkas data yang di-generate menyebut cara regenerasinya', () => {
    for (const path of [
      'packages/core/src/data/psl.generated.ts',
      'packages/core/src/data/confusables.generated.ts',
    ]) {
      const generated = file(path);
      expect(generated, path).toBeDefined();
      expect(generated?.content).toContain('JANGAN DIEDIT MANUAL');
      expect(generated?.content).toMatch(/node tools\/gen-/);
    }
  });
});
