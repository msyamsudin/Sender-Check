/**
 * Fold substitusi digit/huruf.
 *
 * Ini kanal yang **sengaja lemah**, terpisah dari skeleton confusable. Pemisahan ini
 * penting: di dalam `confusables.txt` resmi terdapat `U+0030 "0" -> "o"`,
 * `U+0031 "1" -> "l"`, dan `U+006D "m" -> "rn"`. Kalau mapping itu ikut masuk ke
 * skeleton, substitusi digit akan naik menjadi bukti berstrength kuat dan
 * "modern"/"modem" akan saling dianggap homoglyph. Karena itu:
 *
 *  - `toSkeleton` hanya menangani homoglyph non-ASCII.
 *  - modul ini menangani substitusi digit/huruf dan hasilnya selalu berstrength lemah.
 *
 * Fungsi di sini hanya menghasilkan kandidat yang BERUBAH; bentuk asli tidak pernah
 * dikembalikan, supaya pemanggil tidak pernah salah melaporkan kecocokan persis
 * sebagai kecocokan substitusi.
 */
import { AMBIGUOUS_LETTER_FOLD_WORDS } from '../data/fold-guard.ts';

/**
 * Substitusi digit yang cukup baku untuk dipakai. Sengaja tidak menyertakan
 * pemetaan spekulatif seperti 7->t atau 9->g karena menambah derau tanpa menambah
 * cakupan yang berarti.
 */
const DIGIT_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  '0': ['o'],
  '1': ['l', 'i'],
  '3': ['e'],
  '4': ['a'],
  '5': ['s'],
  '8': ['b'],
  '@': ['a'],
};

/** Batas jumlah posisi ambigu dan jumlah varian, agar input jahat tidak meledak. */
const MAX_AMBIGUOUS_POSITIONS = 3;
const MAX_VARIANTS = 8;

/**
 * Kandidat hasil substitusi digit. Mengembalikan array kosong bila token tidak
 * memuat karakter yang dapat disubstitusi.
 */
export function digitFoldVariants(token: string): string[] {
  const chars = [...token];
  const positions: number[] = [];

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char !== undefined && DIGIT_OPTIONS[char] !== undefined) positions.push(index);
  }

  if (positions.length === 0 || positions.length > MAX_AMBIGUOUS_POSITIONS) return [];

  let variants: string[][] = [chars];

  for (const position of positions) {
    const char = chars[position];
    if (char === undefined) continue;
    const options = DIGIT_OPTIONS[char];
    if (options === undefined) continue;

    const next: string[][] = [];
    for (const variant of variants) {
      for (const replacement of options) {
        const copy = variant.slice();
        copy[position] = replacement;
        next.push(copy);
        if (next.length >= MAX_VARIANTS) break;
      }
      if (next.length >= MAX_VARIANTS) break;
    }
    variants = next;
  }

  const results: string[] = [];
  for (const variant of variants) {
    const joined = variant.join('');
    if (joined !== token && !results.includes(joined)) results.push(joined);
    if (results.length >= MAX_VARIANTS) break;
  }
  return results;
}

/**
 * Fold bigram huruf: `rn` -> `m` dan `vv` -> `w`.
 *
 * Mengembalikan `null` bila token ada di penjaga kamus. Tanpa penjaga ini, kata asli
 * seperti "modern", "internet", dan "pernah" akan ter-fold menjadi "modem",
 * "intemet", dan "pemah", lalu mencocoki domain yang tidak ada hubungannya.
 */
export function letterFold(token: string): string | null {
  if (AMBIGUOUS_LETTER_FOLD_WORDS.has(token)) return null;

  let out = '';
  let changed = false;

  for (let index = 0; index < token.length; ) {
    if (token.startsWith('rn', index)) {
      out += 'm';
      index += 2;
      changed = true;
      continue;
    }
    if (token.startsWith('vv', index)) {
      out += 'w';
      index += 2;
      changed = true;
      continue;
    }
    out += token[index];
    index++;
  }

  return changed ? out : null;
}

/**
 * Semua kandidat fold untuk sebuah token, tanpa bentuk aslinya.
 * Urutan deterministik: fold huruf lebih dulu, lalu varian digit.
 */
export function foldVariants(token: string): string[] {
  const results: string[] = [];

  const letter = letterFold(token);
  if (letter !== null) results.push(letter);

  const digitBases = letter !== null ? [token, letter] : [token];
  for (const base of digitBases) {
    for (const variant of digitFoldVariants(base)) {
      if (!results.includes(variant)) results.push(variant);
      if (results.length >= MAX_VARIANTS) return results;
    }
  }

  return results;
}

/**
 * `true` bila kedua token hanya berbeda pada tingkat substitusi digit/huruf.
 * Dipakai rule untuk menaikkan bukti menjadi `DIGIT_SUBSTITUTION_MATCH`.
 */
export function isFoldEquivalent(a: string, b: string): boolean {
  if (a === b) return false;
  if (foldVariants(a).includes(b)) return true;
  if (foldVariants(b).includes(a)) return true;
  return false;
}
