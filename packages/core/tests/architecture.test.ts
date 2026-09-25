import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Test arsitektur.
 *
 * Desain menyatakan bahwa `packages/core` bebas DOM, bebas `chrome.*`, bebas
 * jaringan, dan deterministik. Pernyataan itu mudah diucapkan dan mudah dilanggar
 * tanpa sadar. Test ini menegakkannya pada tingkat source, sehingga pelanggaran
 * langsung gagal di CI alih-alih baru ketahuan saat extension berjalan.
 */
const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = join(here, '..', 'src');
const adaptersSrc = join(here, '..', '..', 'adapters', 'src');

function collectTypeScriptFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectTypeScriptFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Membuang komentar sebelum memeriksa.
 *
 * Test ini menguji KODE, bukan prosa. Tanpa langkah ini, komentar yang menjelaskan
 * "engine tidak boleh memakai document" justru akan dianggap pelanggaran.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const sourceFiles = collectTypeScriptFiles(coreSrc).map((path) => ({
  path: relative(coreSrc, path).replaceAll('\\', '/'),
  content: readFileSync(path, 'utf8'),
  code: stripComments(readFileSync(path, 'utf8')),
}));

/**
 * Daftar terlarang berupa pola kode, bukan kata, supaya sebutan seperti "dokumen" di
 * dalam komentar tidak ikut tertangkap.
 */
const FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'DOM document', pattern: /\bdocument\s*\./ },
  { label: 'DOM window', pattern: /\bwindow\s*\./ },
  { label: 'chrome API', pattern: /\bchrome\s*\./ },
  { label: 'browser API', pattern: /\bbrowser\s*\./ },
  { label: 'localStorage', pattern: /\blocalStorage\b/ },
  { label: 'sessionStorage', pattern: /\bsessionStorage\b/ },
  { label: 'fetch', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { label: 'WebSocket', pattern: /\bWebSocket\b/ },
  { label: 'navigator', pattern: /\bnavigator\s*\./ },
  { label: 'Node process', pattern: /\bprocess\s*\./ },
  { label: 'Node builtin', pattern: /from\s+['"]node:/ },
  { label: 'require', pattern: /\brequire\s*\(/ },
  { label: 'jam', pattern: /\bDate\s*\.\s*now\s*\(/ },
  { label: 'RNG', pattern: /\bMath\s*\.\s*random\s*\(/ },
  { label: 'eval', pattern: /\beval\s*\(/ },
  { label: 'timer', pattern: /\bsetTimeout\s*\(|\bsetInterval\s*\(/ },
];

describe('arsitektur core: bebas DOM, chrome, jaringan, dan waktu', () => {
  it('menemukan berkas sumber untuk diperiksa', () => {
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`tidak memakai ${label}`, () => {
      const offenders = sourceFiles
        .filter((file) => pattern.test(file.code))
        .map((file) => file.path);
      expect(offenders, `${label} ditemukan di: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('tidak memuat database brand atau daftar jaringan sosial bawaan', () => {
    // Batas kelas ESP mudah dilanggar tanpa sadar, dan pelanggarannya menciptakan
    // lubang false negative yang sistematis.
    const esp = sourceFiles.find((file) => file.path === 'data/esp.ts');
    expect(esp).toBeDefined();
    for (const brand of ['github.com', 'google.com', 'paypal.com', 'netflix.com', 'bca.co.id']) {
      expect(esp?.code).not.toContain(`'${brand}'`);
    }
  });
});

describe('arsitektur core: tidak ada skor', () => {
  it('tidak ada medan atau fungsi bernama skor di seluruh engine', () => {
    // Satu-satunya "score" yang diizinkan adalah skor kemiripan di kanal similarity,
    // yang tidak pernah dipakai sendirian untuk memutuskan state.
    const allowedFiles = new Set(['similarity/index.ts', 'evidence/matches.ts']);

    for (const file of sourceFiles) {
      if (allowedFiles.has(file.path)) continue;
      expect(/\bphishingScore\b|\briskScore\b/.test(file.code), file.path).toBe(false);
    }
  });
});

describe('arsitektur adapters: bekerja pada DOM yang dipersempit', () => {
  const adapterFiles = collectTypeScriptFiles(adaptersSrc).map((path) => ({
    path: relative(adaptersSrc, path).replaceAll('\\', '/'),
    content: readFileSync(path, 'utf8'),
    code: stripComments(readFileSync(path, 'utf8')),
  }));

  it('menemukan berkas sumber adapters untuk diperiksa', () => {
    expect(adapterFiles.length).toBeGreaterThanOrEqual(4);
  });

  it('tidak menyentuh global DOM secara langsung', () => {
    // Adapter bekerja pada `DocumentLike` dan `ElementLike`. Itu yang membuat logikanya
    // dapat diuji di Node memakai DOM tiruan, tanpa jsdom dan tanpa browser. Begitu satu
    // berkas menyentuh `document` secara langsung, sifat itu hilang.
    const offenders = adapterFiles
      .filter((file) => /\bdocument\s*\.|\bwindow\s*\.|\blocation\s*\./.test(file.code))
      .map((file) => file.path);

    expect(offenders, `global DOM disentuh langsung di: ${offenders.join(', ')}`).toEqual([]);
  });

  for (const { label, pattern } of FORBIDDEN) {
    it(`tidak memakai ${label}`, () => {
      const offenders = adapterFiles
        .filter((file) => pattern.test(file.code))
        .map((file) => file.path);
      expect(offenders, `${label} ditemukan di: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('tidak mengimpor engine secara penuh', () => {
    // Adapter hanya membutuhkan penguraian alamat dan tipe. Mengimpor `analyze` akan
    // menarik seluruh engine beserta tabel PSL ke dalam bundel adapter, dan menghapus
    // batas antara "menerjemahkan DOM" dan "menganalisis".
    for (const file of adapterFiles) {
      expect(file.code, file.path).not.toMatch(/\banalyze\s*\(/);
    }
  });
});

describe('arsitektur core: data yang dibundel konsisten dengan generator', () => {
  it('berkas data yang di-generate menyebut sumbernya dan cara regenerasi', () => {
    for (const name of ['data/psl.generated.ts', 'data/confusables.generated.ts']) {
      const file = sourceFiles.find((item) => item.path === name);
      expect(file, name).toBeDefined();
      expect(file?.content).toContain('AUTO-GENERATED');
      expect(file?.content).toContain('JANGAN DIEDIT MANUAL');
    }
  });

  it('tidak ada berkas data yang diimpor tetapi tidak ada', () => {
    for (const file of sourceFiles) {
      for (const match of file.content.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const resolved = join(dirname(join(coreSrc, file.path)), specifier);
        expect(() => statSync(resolved), `${file.path} -> ${specifier}`).not.toThrow();
      }
    }
  });
});
