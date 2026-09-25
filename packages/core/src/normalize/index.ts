/**
 * Normalization Engine.
 *
 * Menyimpan tiga representasi — original, normalized, skeleton — karena masing-masing
 * dipakai untuk keperluan berbeda dan mencampurnya menyebabkan rule salah severity:
 *
 *  - `original`   : ditampilkan ke pengguna, tidak pernah diubah.
 *  - `normalized` : huruf kecil, diakritik dibuang, NFKC, pemisah diseragamkan.
 *                  Dipakai untuk perbandingan token dan pencocokan local-part.
 *  - `skeleton`   : TR39 confusable fold dari bentuk normalized. Dipakai HANYA untuk
 *                  kanal homoglyph, supaya kecocokan biasa tidak ikut naik severity.
 *
 * `normalizeForComparison` dihitung sampai fixpoint, sehingga idempoten secara
 * konstruksi: bila `f` adalah fixpoint, maka `normalize(f)` berhenti pada iterasi
 * pertama dan mengembalikan `f` itu sendiri.
 */
import type { NormalizedText } from '../types.ts';
import { toSkeleton } from './confusables.ts';

const COMBINING_MARK = /\p{Mn}|\p{Me}/gu;
/**
 * Karakter tak terlihat: soft hyphen, zero-width space/joiner, penanda arah, BOM.
 *
 * Wajib dibuang, bukan sekadar dirapikan. `goog\u200Ble` yang dibiarkan akan
 * terpecah menjadi dua token ("goog" dan "le") oleh tokenizer, sehingga penyisipan
 * satu karakter tak terlihat cukup untuk menggagalkan seluruh pencocokan.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const WHITESPACE = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu;
const DASH_LIKE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u2212\ufe58\ufe63\uff0d\u00ad]/gu;
const SLASH_LIKE = /[\u2044\u2215\uff0f\u29f8]/gu;

const MAX_NORMALIZE_ITERATIONS = 6;

/** Membuang tanda diakritik tanpa mengubah karakter dasar. */
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARK, '');
}

/**
 * Normalisasi untuk perbandingan. Idempoten.
 *
 * Urutannya NFD -> buang tanda -> NFKC, dan urutan itu penting:
 * **NFKC menyusun, bukan mengurai.** Memakai NFKC lebih dulu membuat "é" tetap
 * berupa "é" sehingga tidak ada tanda diakritik yang bisa dibuang, dan seluruh
 * tahap "strip diacritics" tidak pernah benar-benar bekerja.
 *
 * Dihitung sampai fixpoint karena ada karakter yang baru memunculkan tanda
 * diakritik setelah pemrosesan pertama, mis. U+1E9B ("ẛ") yang terurai menjadi
 * U+017F + U+0307. Sampai fixpoint, idempotensi berlaku secara konstruksi: bila `f`
 * adalah fixpoint dari langkah `g`, maka `normalize(f)` berhenti pada iterasi pertama
 * dan mengembalikan `f` itu sendiri.
 */
export function normalizeForComparison(input: string): string {
  let current = input.toLowerCase();

  for (let iteration = 0; iteration < MAX_NORMALIZE_ITERATIONS; iteration++) {
    const next = current
      .normalize('NFD')
      .replace(INVISIBLE, '')
      .replace(COMBINING_MARK, '')
      .normalize('NFKC')
      .replace(DASH_LIKE, '-')
      .replace(SLASH_LIKE, '/')
      .replace(WHITESPACE, ' ')
      .trim();

    if (next === current) break;
    current = next;
  }

  return current;
}

/** Tiga representasi teks yang dipakai seluruh engine. */
export function normalizeText(input: string): NormalizedText {
  const normalized = normalizeForComparison(input);
  return {
    original: input,
    normalized,
    skeleton: toSkeleton(normalized),
  };
}

/**
 * Memecah teks menjadi token alfanumerik.
 *
 * Sengaja TIDAK melakukan skeletonisasi: bentuk aksara asli harus tetap utuh supaya
 * kanal homoglyph punya sesuatu untuk dibandingkan. Kalau token sudah di-skeleton di
 * sini, informasi "ini sebenarnya Cyrillic" akan hilang sebelum sempat dinilai.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizeForComparison(text);
  const matches = normalized.match(/[\p{L}\p{N}]+/gu);
  return matches === null ? [] : matches;
}

/**
 * Token dari display name, dengan metadata panjang.
 * Token satu karakter dipertahankan karena inisial itu bermakna ("J. Smith").
 */
export interface DisplayToken {
  /** Bentuk normalized. */
  readonly value: string;
  /** Bentuk skeleton, untuk kanal homoglyph. */
  readonly skeleton: string;
  readonly length: number;
  /** `true` bila token hanya satu karakter (inisial). */
  readonly isInitial: boolean;
  /** `true` bila token sekaligus merupakan bentuk asli yang mengandung non-ASCII. */
  readonly hasNonAscii: boolean;
}

export function displayTokens(text: string): DisplayToken[] {
  const rawTokens = tokenize(text);
  const result: DisplayToken[] = [];

  for (const raw of rawTokens) {
    const skeleton = toSkeleton(raw);
    result.push({
      value: raw,
      skeleton,
      length: raw.length,
      isInitial: raw.length === 1,
      hasNonAscii: !/^[\x20-\x7e]*$/.test(raw),
    });
  }

  return result;
}

/** `true` bila teks hanya berisi karakter ASCII yang terlihat. */
export function isPlainAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}
