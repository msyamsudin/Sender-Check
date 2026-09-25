/**
 * Generator build-time: mengubah `confusables.txt` resmi Unicode menjadi tabel
 * homoglyph yang dibundel extension.
 *
 * Kenapa generate dan bukan menulis tabel manual: tabel homoglyph manual selalu
 * ketinggalan versi Unicode, dan NFKC TIDAK menyelesaikan masalah ini — NFKC tidak
 * memetakan Cyrillic "а" (U+0430) ke Latin "a". Yang benar adalah TR39 skeleton
 * (NFD -> map confusables -> NFD -> buang default-ignorable).
 *
 * Kita hanya menyimpan mapping yang target akhirnya murni ASCII [a-z0-9], karena
 * itulah yang dibutuhkan untuk membandingkan token nama dengan label domain.
 * Sisanya ditangani NFKC.
 *
 * Jalankan: node tools/gen-unicode/generate.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const sourcePath = join(here, 'confusables.txt');
const outPath = join(repoRoot, 'packages', 'core', 'src', 'data', 'confusables.generated.ts');

const MAX_TARGET_LENGTH = 3;
const MAX_RESOLUTION_ROUNDS = 12;

interface Parsed {
  version: string;
  date: string;
  /** source codepoint -> target codepoints, apa adanya dari berkas. */
  rawMap: Map<number, number[]>;
}

function parseConfusables(raw: string): Parsed {
  const rawMap = new Map<number, number[]>();
  let version = 'unknown';
  let date = 'unknown';

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('#')) {
      const v = /^#\s*Version:\s*(\S+)/.exec(trimmed);
      if (v?.[1] !== undefined) version = v[1];
      const d = /^#\s*Date:\s*(.+)$/.exec(trimmed);
      if (d?.[1] !== undefined) date = d[1].trim();
      continue;
    }

    // Format: <source> ; <target> ; <type> # komentar
    const parts = trimmed.split(';');
    if (parts.length < 3) continue;

    const sourceField = parts[0]?.trim() ?? '';
    const targetField = parts[1]?.trim() ?? '';

    const source = parseCodepoints(sourceField);
    const target = parseCodepoints(targetField);

    // Kita hanya memetakan karakter tunggal; mapping bersumber multi-karakter
    // tidak relevan untuk perbandingan token.
    if (source.length !== 1 || target.length === 0) continue;

    const sourceCp = source[0];
    if (sourceCp === undefined) continue;

    rawMap.set(sourceCp, target);
  }

  return { version, date, rawMap };
}

function parseCodepoints(field: string): number[] {
  const out: number[] = [];
  for (const token of field.split(/\s+/)) {
    if (token.length === 0) continue;
    const cp = Number.parseInt(token, 16);
    if (Number.isNaN(cp)) return [];
    out.push(cp);
  }
  return out;
}

/**
 * confusables.txt memetakan ke karakter "prototype", yang sebagian masih non-ASCII
 * dan punya mapping lanjutan. Telusuri sampai fixpoint supaya hasilnya benar-benar
 * huruf ASCII, bukan prototype perantara.
 */
function resolve(cp: number, rawMap: Map<number, number[]>, cache: Map<number, number[]>): number[] {
  const cached = cache.get(cp);
  if (cached !== undefined) return cached;

  let current: number[] = [cp];
  cache.set(cp, current);

  for (let round = 0; round < MAX_RESOLUTION_ROUNDS; round++) {
    const next: number[] = [];
    let changed = false;

    for (const c of current) {
      const mapped = rawMap.get(c);
      if (mapped === undefined || (mapped.length === 1 && mapped[0] === c)) {
        next.push(c);
      } else {
        next.push(...mapped);
        changed = true;
      }
      // Cegah ledakan panjang pada mapping siklik.
      if (next.length > 16) break;
    }

    current = next.slice(0, 16);
    if (!changed) break;
  }

  cache.set(cp, current);
  return current;
}

function isPureAsciiAlnum(s: string): boolean {
  return s.length > 0 && /^[a-z0-9]+$/.test(s);
}

const parsed = parseConfusables(readFileSync(sourcePath, 'utf8'));
const cache = new Map<number, number[]>();

const entries: Array<[number, string]> = [];

for (const [sourceCp, directTarget] of parsed.rawMap) {
  const resolved = resolve(sourceCp, parsed.rawMap, cache);

  let mapped = '';
  for (const cp of resolved) mapped += String.fromCodePoint(cp);

  mapped = mapped.toLowerCase();

  // Buang mapping identitas dan mapping yang tidak menghasilkan ASCII bersih.
  if (!isPureAsciiAlnum(mapped)) continue;
  if (mapped.length > MAX_TARGET_LENGTH) continue;

  // Buang sumber ASCII: substitusi digit/letter adalah bukti lemah dan ditangani
  // di fold.ts, bukan di skeleton. Lihat komentar pada berkas keluaran.
  if (sourceCp <= 0x7f) continue;

  const self = String.fromCodePoint(sourceCp).toLowerCase();
  if (self === mapped) continue;
  if (directTarget.length === 0) continue;

  entries.push([sourceCp, mapped]);
}

entries.sort((a, b) => a[0] - b[0]);

// Verifikasi: setiap entri harus lolos definisi skeleton-nya sendiri. Kalau tidak,
// tabel ini akan menghasilkan skeleton yang tidak konsisten dengan Unicode.
for (const [cp, mapped] of entries) {
  if (!isPureAsciiAlnum(mapped)) {
    throw new Error(`entri confusable tidak valid: U+${cp.toString(16)} -> ${JSON.stringify(mapped)}`);
  }
  if (cp <= 0x7f) {
    throw new Error(`sumber ASCII bocor ke tabel: U+${cp.toString(16)}`);
  }
}

const packed = entries.map(([cp, mapped]) => `${cp.toString(16)}:${mapped}`).join('\n');

const output = `// AUTO-GENERATED — JANGAN DIEDIT MANUAL.
//
// Sumber : https://www.unicode.org/Public/security/latest/confusables.txt
// Version: ${parsed.version}
// Date   : ${parsed.date}
// Lisensi: Unicode License (berkas mentah: tools/gen-unicode/confusables.txt)
//
// Regenerate: node tools/gen-unicode/generate.ts
//
// Berisi HANYA mapping dari sumber NON-ASCII yang target akhirnya murni ASCII
// [a-z0-9] dengan panjang maksimal ${MAX_TARGET_LENGTH}.
//
// Sumber ASCII sengaja DIBUANG, walaupun confusables.txt memuatnya:
//   U+0030 "0" -> "o", U+0031 "1" -> "l", U+0049 "I" -> "l", U+006D "m" -> "rn"
// Memasukkan mereka ke skeleton akan membuat substitusi digit/letter naik menjadi
// bukti berstrength kuat, padahal desain menetapkannya sebagai bukti LEMAH
// (DIGIT_SUBSTITUTION_MATCH) karena rawan false positive: "1password", "37signals",
// serta "modern"/"modem" yang memang confusable menurut Unicode.
// Substitusi tersebut ditangani di src/normalize/fold.ts dengan penjaga kamus.

export const CONFUSABLES_VERSION = '${parsed.version}';
export const CONFUSABLES_DATE = '${parsed.date}';

export const CONFUSABLES_RAW = \`${packed}\`;

/** Jumlah entri, dipakai test sebagai sanity check terhadap data yang membusuk. */
export const CONFUSABLES_COUNT = ${entries.length};
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output, 'utf8');

console.log(
  [
    `confusables v${parsed.version} (${parsed.date})`,
    `  mapping mentah     : ${parsed.rawMap.size}`,
    `  entri dipakai      : ${entries.length} (semua bersumber non-ASCII)`,
    `  sumber ASCII dibuang: ${[...parsed.rawMap.keys()].filter((cp) => cp <= 0x7f).length}`,
    `  output             : ${outPath}`,
    `  ukuran            : ${(output.length / 1024).toFixed(1)} KB`,
  ].join('\n'),
);
