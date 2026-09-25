/**
 * Similarity Engine.
 *
 * Prinsip yang dipegang (dan menjadi sumber sebagian besar false positive kalau
 * dilanggar):
 *
 *  1. **Maximum meaningful signal, bukan rata-rata.** Satu kanal yang kuat sudah
 *     cukup; mencampurnya dengan kanal lemah hanya menurunkan sinyal.
 *  2. **Ambang berbeda menurut panjang.** Jaro-Winkler meledak pada string pendek
 *     karena bonus common prefix: "bca" vs "bcapro" mendapat skor tinggi hanya
 *     karena 3 huruf pertama sama. Karena itu pencocokan fuzzy hanya diizinkan bila
 *     kedua token minimal 6 karakter, sedangkan kecocokan persis sudah bermakna
 *     sejak 3 karakter (kesamaan penuh adalah bukti, kemiripan parsial bukan).
 *  3. **Bukti yang dilaporkan adalah substring konkret, bukan angka.** Angka 0,94
 *     tidak dapat diverifikasi pengguna; `"rise" ⊂ "risehq"` bisa.
 */

/** Kecocokan persis sudah bermakna sejak panjang ini. */
export const MIN_EXACT_TOKEN_LENGTH = 3;

/** Pencocokan fuzzy hanya diizinkan sejak panjang ini, di kedua sisi. */
export const MIN_FUZZY_LENGTH = 6;

/** Pencocokan hasil fold digit/huruf hanya diizinkan sejak panjang ini. */
export const MIN_FOLD_LENGTH = 4;

/**
 * Ambang untuk "berbeda tepat satu karakter".
 *
 * Pada token 3-5 karakter, ambang kemiripan persentase terlalu kasar: "gojek" dan
 * "gojeg" hanya mirip 80%, sedangkan Jaro-Winkler menuntut token minimal 6 karakter
 * sehingga pasangan itu tidak pernah diperiksa sama sekali. Padahal justru di situlah
 * typosquat lokal berada: `gojeg`, `bnl`, `br1`, `shope`.
 */
export const MIN_TYPO_LENGTH = 3;

/**
 * Ambang untuk kecocokan homoglyph.
 *
 * Jauh lebih pendek daripada ambang fold, dan itu disengaja: sebuah kecocokan
 * skeleton berarti "aksara berbeda, bentuk sama", yang merupakan definisi serangan
 * homoglyph dan tetap bermakna pada token pendek. Ambang 5 akan membuang justru
 * akronim yang paling sering dipalsukan — OVO, BCA, BRI, BNI, DANA.
 */
export const MIN_CONFUSABLE_LENGTH = 3;

/** Ambang Jaro-Winkler. Tinggi dengan sengaja karena hanya dipakai pada token panjang. */
export const JARO_WINKLER_THRESHOLD = 0.9;

/** Ambang kemiripan Damerau-Levenshtein, dinyatakan sebagai 1 - jarak/panjang. */
export const EDIT_SIMILARITY_THRESHOLD = 0.85;

export type SimilarityMethod =
  | 'EXACT'
  | 'PREFIX_OR_SUFFIX'
  | 'CONTAINS'
  | 'JARO_WINKLER'
  | 'DAMERAU_LEVENSHTEIN';

export interface SimilarityHit {
  readonly method: SimilarityMethod;
  readonly score: number;
  /** Bukti konkret yang dapat dibaca manusia dan diverifikasi. */
  readonly evidence: string;
}

/** Jaro similarity. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array<boolean>(aLen).fill(false);
  const bMatches = new Array<boolean>(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, bLen);
    for (let j = start; j < end; j++) {
      if (bMatches[j] === true) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;
  if (matches === aLen && matches === bLen) return 1;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (aMatches[i] !== true) continue;
    while (bMatches[k] !== true) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const m = matches;
  return (m / aLen + m / bLen + (m - transpositions / 2) / m) / 3;
}

/** Jaro-Winkler dengan bonus common prefix standar. */
export function jaroWinkler(a: string, b: string): number {
  const base = jaro(a, b);
  if (base < 0.7) return base;

  const maxPrefix = Math.min(4, a.length, b.length);
  let prefix = 0;
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;

  return base + prefix * 0.1 * (1 - base);
}

/**
 * Damerau-Levenshtein dengan transposisi (optimal string alignment).
 * Dipakai lewat `editSimilarity`, tidak diekspos langsung ke rule.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Baris sebelumnya-sebelumnya diperlukan untuk menangani transposisi.
  let prevPrev = new Array<number>(bLen + 1).fill(0);
  let prev = new Array<number>(bLen + 1).fill(0);
  let current = new Array<number>(bLen + 1).fill(0);

  for (let j = 0; j <= bLen; j++) prev[j] = j;

  for (let i = 1; i <= aLen; i++) {
    current[0] = i;

    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const substitution = (prev[j - 1] ?? 0) + cost;

      let best = Math.min(deletion, insertion, substitution);

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        const transposition = (prevPrev[j - 2] ?? 0) + 1;
        if (transposition < best) best = transposition;
      }

      current[j] = best;
    }

    prevPrev = prev;
    prev = current;
    current = new Array<number>(bLen + 1).fill(0);
  }

  return prev[bLen] ?? Math.max(aLen, bLen);
}

/** Kemiripan berbasis edit distance, dinormalkan ke rentang 0..1. */
export function editSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - damerauLevenshtein(a, b) / longest;
}

/** Panjang substring bersama terpanjang. */
export function longestCommonSubstringLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;

  let previous = new Array<number>(b.length + 1).fill(0);
  let best = 0;

  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        const value = (previous[j - 1] ?? 0) + 1;
        current[j] = value;
        if (value > best) best = value;
      }
    }
    previous = current;
  }

  return best;
}

/** `true` bila token yang lebih pendek adalah awalan atau akhiran yang lain. */
export function isPrefixOrSuffixMatch(shorter: string, longer: string): boolean {
  if (shorter.length >= longer.length) return false;
  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

/**
 * Mencari sinyal kemiripan terkuat antara dua token.
 *
 * Mengembalikan `null` bila tidak ada kanal yang layak dilaporkan. Pemanggil tidak
 * boleh memperlakukan `null` sebagai "tidak cocok": itu berarti "tidak ada bukti",
 * dan ketiadaan bukti bukan bukti ketidakcocokan.
 */
export function bestSimilarity(rawA: string, rawB: string): SimilarityHit | null {
  const a = rawA.toLowerCase();
  const b = rawB.toLowerCase();

  if (a.length === 0 || b.length === 0) return null;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  if (a === b) {
    if (shorter.length < MIN_EXACT_TOKEN_LENGTH) return null;
    return { method: 'EXACT', score: 1, evidence: `"${rawA}" = "${rawB}"` };
  }

  if (shorter.length >= MIN_EXACT_TOKEN_LENGTH && isPrefixOrSuffixMatch(shorter, longer)) {
    return {
      method: 'PREFIX_OR_SUFFIX',
      score: shorter.length / longer.length,
      evidence: `"${shorter}" ${longer.startsWith(shorter) ? 'awalan' : 'akhiran'} dari "${longer}"`,
    };
  }

  // Fuzzy hanya pada token yang cukup panjang. Inilah penjaga terhadap ledakan
  // Jaro-Winkler pada string pendek.
  if (shorter.length >= MIN_FUZZY_LENGTH && longer.length >= MIN_FUZZY_LENGTH) {
    const jw = jaroWinkler(a, b);
    const edit = editSimilarity(a, b);
    const score = Math.max(jw, edit);

    if (score >= JARO_WINKLER_THRESHOLD) {
      return {
        method: jw >= edit ? 'JARO_WINKLER' : 'DAMERAU_LEVENSHTEIN',
        score,
        evidence: `"${rawA}" ≈ "${rawB}" (kemiripan ${score.toFixed(2)})`,
      };
    }
  }

  // Jalur kedua untuk token pendek: bukan ambang persentase, melainkan syarat mutlak
  // "berbeda tepat satu karakter". Jauh lebih ketat daripada ambang kemiripan, dan
  // karena itu aman dipakai pada string sependek tiga karakter.
  if (shorter.length >= MIN_TYPO_LENGTH && damerauLevenshtein(a, b) <= 1) {
    return {
      method: 'DAMERAU_LEVENSHTEIN',
      score: editSimilarity(a, b),
      evidence: `"${rawA}" ≈ "${rawB}" (berbeda satu karakter)`,
    };
  }

  if (shorter.length >= MIN_EXACT_TOKEN_LENGTH && longer.includes(shorter)) {
    return {
      method: 'CONTAINS',
      score: shorter.length / longer.length,
      evidence: `"${shorter}" ⊂ "${longer}"`,
    };
  }

  return null;
}

/** `true` bila kedua token cocok pada tingkat persis, awalan/akhiran, atau fuzzy. */
export function isMeaningfullySimilar(a: string, b: string): boolean {
  const hit = bestSimilarity(a, b);
  if (hit === null) return false;
  return hit.method !== 'CONTAINS';
}
