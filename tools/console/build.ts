/**
 * Membundel skrip konsol menjadi dua berkas IIFE.
 *
 * Kenapa dua berkas, bukan satu: tabel PSL berukuran 211 KB, dan ia hanya dibutuhkan
 * oleh `analyze()`. Menempelkan 280 KB ke konsol hanya untuk menjawab pertanyaan
 * tentang selector adalah pemborosan yang juga menambah risiko penempelan gagal.
 *
 *  - `sender-check.probe.js`   — probe selector saja, kecil, untuk verifikasi cepat
 *  - `sender-check.console.js` — probe + analisis lengkap
 *
 * Jalankan: pnpm console:build
 */
import { build } from 'esbuild';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dist');

mkdirSync(outDir, { recursive: true });

const ENTRIES: ReadonlyArray<{ entry: string; outfile: string; banner: string }> = [
  {
    entry: 'probe.ts',
    outfile: 'sender-check.probe.js',
    banner: '/* Sender-Check · probe selector. Tempel ke konsol Firefox saat Gmail terbuka. */',
  },
  {
    entry: 'main.ts',
    outfile: 'sender-check.console.js',
    banner: '/* Sender-Check · probe + analisis. Tempel ke konsol Firefox saat Gmail terbuka. */',
  },
];

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

console.log('membundel skrip konsol\n');

for (const item of ENTRIES) {
  const outfile = join(outDir, item.outfile);

  const result = await build({
    entryPoints: [join(here, 'src', item.entry)],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['firefox115'],
    minify: true,
    legalComments: 'none',
    // Peta sumber tidak disertakan: berkasnya harus dapat ditempel sebagai satu
    // potongan teks, dan komentar penunjuk source map hanya menambah panjang.
    sourcemap: false,
    metafile: true,
    banner: { js: item.banner },
  });

  const size = statSync(outfile).size;
  console.log(`${item.outfile.padEnd(28)} ${kb(size).padStart(9)}`);

  const contributions = Object.entries(result.metafile.outputs)
    .flatMap(([, output]) => Object.entries(output.inputs))
    .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)
    .slice(0, 3);

  for (const [path, meta] of contributions) {
    console.log(`    ${kb(meta.bytesInOutput).padStart(9)}  ${path.replaceAll('\\', '/')}`);
  }
  console.log('');
}

// Berkas pendamping berisi cara pakai singkat, supaya berkas bundelnya tidak perlu
// dibuka hanya untuk tahu apa yang harus dilakukan.
writeFileSync(
  join(outDir, 'CARA-PAKAI.txt'),
  [
    'SENDER-CHECK · CARA PAKAI SKRIP KONSOL',
    '',
    'Pilih satu berkas:',
    '',
    '  sender-check.probe.js    kecil. Menjawab: selector mana yang bekerja?',
    '  sender-check.console.js  besar. Menjawab: apa hasil analisisnya?',
    '',
    'Mulai dari yang kecil. Kalau selectornya sudah benar, jalankan yang besar.',
    '',
    'LANGKAH',
    '',
    '1. Buka Gmail di Firefox.',
    '2. Buka konsol: Ctrl+Shift+K, atau menu aplikasi > More tools > Web Developer Tools > Console.',
    '3. Firefox memblokir penempelan kode secara default. Ketik persis ini lalu Enter:',
    '',
    '       allow pasting',
    '',
    '4. Buka berkas sender-check.probe.js dengan editor teks, salin SELURUH isinya,',
    '   tempel ke konsol, lalu Enter.',
    '5. Untuk Tier B: buka sebuah pesan > menu lainnya > Show original (Tampilkan',
    '   aslinya). Jalankan skrip yang sama di halaman itu.',
    '',
    'Di akhir keluaran, laporan JSON disalin otomatis ke clipboard lewat copy().',
    'Itulah yang perlu dikirimkan untuk memperbaiki selector.',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`cara pakai: ${join(outDir, 'CARA-PAKAI.txt')}`);
