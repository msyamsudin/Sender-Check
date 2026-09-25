/**
 * Generator build-time: mengubah `public_suffix_list.dat` resmi menjadi modul TS
 * yang dibundel extension.
 *
 * Kenapa generate dan bukan menulis daftar manual: daftar manual pasti salah, dan
 * kesalahan pada PSL langsung menghasilkan `registrableDomain` yang keliru sehingga
 * setiap rule domain ikut salah. Sumbernya satu-satunya URL resmi sesuai instruksi
 * di dalam file itu sendiri.
 *
 * Jalankan: node tools/gen-psl/generate.ts
 * Tidak ada network request saat runtime extension — file ini murni build-time.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const sourcePath = join(here, 'public_suffix_list.dat');
const outPath = join(repoRoot, 'packages', 'core', 'src', 'data', 'psl.generated.ts');

interface ParsedList {
  version: string;
  commit: string;
  exact: string[];
  wildcard: string[];
  exception: string[];
  privateRules: string[];
}

type Section = 'none' | 'icann' | 'private';

function parseList(raw: string): ParsedList {
  const result: ParsedList = {
    version: 'unknown',
    commit: 'unknown',
    exact: [],
    wildcard: [],
    exception: [],
    privateRules: [],
  };

  let section: Section = 'none';

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0) continue;

    if (line.startsWith('//')) {
      const versionMatch = /^\/\/\s*VERSION:\s*(\S+)/.exec(line);
      if (versionMatch?.[1] !== undefined) result.version = versionMatch[1];

      const commitMatch = /^\/\/\s*COMMIT:\s*(\S+)/.exec(line);
      if (commitMatch?.[1] !== undefined) result.commit = commitMatch[1];

      if (line.includes('===BEGIN ICANN DOMAINS===')) section = 'icann';
      else if (line.includes('===BEGIN PRIVATE DOMAINS===')) section = 'private';
      else if (line.includes('===END')) section = 'none';

      continue;
    }

    if (section === 'none') continue;

    // Sebuah baris aturan hanya boleh berisi karakter domain, '*', '!', '.', dan '-'.
    if (!/^[!*a-z0-9.\-_\u00a1-\uffff]+$/i.test(line)) continue;

    const isException = line.startsWith('!');
    const isWildcard = line.startsWith('*.');
    const bare = isException ? line.slice(1) : isWildcard ? line.slice(2) : line;
    const value = bare.toLowerCase();

    if (value.length === 0) continue;

    if (isException) result.exception.push(value);
    else if (isWildcard) result.wildcard.push(value);
    else result.exact.push(value);

    if (section === 'private') result.privateRules.push(value);
  }

  result.exact.sort();
  result.wildcard.sort();
  result.exception.sort();
  result.privateRules.sort();
  return result;
}

/**
 * Nilai di-encode sebagai isi template literal.
 *
 * Sebelumnya nilai digabung dengan newline nyata ke dalam string berkutip tunggal,
 * yang menghasilkan berkas TS yang tidak dapat di-parse. Template literal
 * menyelesaikannya sekaligus membuat berkas hasil dapat dibaca dan di-diff.
 */
function encode(values: readonly string[]): string {
  for (const value of values) {
    if (value.includes('`') || value.includes('${') || value.includes('\\')) {
      throw new Error(`aturan PSL memuat karakter yang tidak aman untuk template literal: ${value}`);
    }
  }
  return values.join('\n');
}

function emit(list: ParsedList): string {
  return `// AUTO-GENERATED — JANGAN DIEDIT MANUAL.
//
// Sumber : https://publicsuffix.org/list/public_suffix_list.dat
// VERSION: ${list.version}
// COMMIT : ${list.commit}
// Lisensi: Mozilla Public License 2.0 (berkas mentah: tools/gen-psl/public_suffix_list.dat)
//
// Regenerate: node tools/gen-psl/generate.ts
//
// Aturan dikelompokkan menurut sintaks PSL: exact, wildcard (disimpan tanpa awalan
// bintang-titik), dan exception (disimpan tanpa awalan tanda seru). PSL_PRIVATE_RAW
// menyimpan aturan dari bagian PRIVATE DOMAINS agar analyzer dapat menandai host yang
// didelegasikan lewat suffix privat (mis. foo.github.io) sebagai subdomain-delegated.

export const PSL_VERSION = '${list.version}';
export const PSL_COMMIT = '${list.commit}';

/** Suffix publik yang cocok persis. */
export const PSL_EXACT_RAW = \`${encode(list.exact)}\`;

/** Suffix publik berbentuk wildcard, disimpan tanpa awalan "*.". */
export const PSL_WILDCARD_RAW = \`${encode(list.wildcard)}\`;

/** Exception terhadap wildcard, disimpan tanpa awalan "!". */
export const PSL_EXCEPTION_RAW = \`${encode(list.exception)}\`;

/** Semua aturan yang berasal dari bagian PRIVATE DOMAINS. */
export const PSL_PRIVATE_RAW = \`${encode(list.privateRules)}\`;

/** Jumlah aturan, dipakai test sebagai sanity check terhadap data yang membusuk. */
export const PSL_COUNTS = {
  exact: ${list.exact.length},
  wildcard: ${list.wildcard.length},
  exception: ${list.exception.length},
  privateRules: ${list.privateRules.length},
} as const;
`;
}

const raw = readFileSync(sourcePath, 'utf8');
const list = parseList(raw);

if (list.exact.length < 1000) {
  throw new Error(
    `PSL terlihat rusak: hanya ${list.exact.length} aturan exact terbaca dari ${sourcePath}`,
  );
}
if (list.version === 'unknown') {
  throw new Error(`Header VERSION tidak ditemukan di ${sourcePath}`);
}

const output = emit(list);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output, 'utf8');

console.log(
  [
    `PSL v${list.version} (commit ${list.commit.slice(0, 12)})`,
    `  exact     : ${list.exact.length}`,
    `  wildcard  : ${list.wildcard.length}`,
    `  exception : ${list.exception.length}`,
    `  private   : ${list.privateRules.length}`,
    `  output    : ${outPath}`,
    `  ukuran    : ${(output.length / 1024).toFixed(1)} KB`,
  ].join('\n'),
);
