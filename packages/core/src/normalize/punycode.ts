/**
 * Decoder Punycode (RFC 3492).
 *
 * Kenapa harus ditulis sendiri: browser tidak mengekspos hasil decode punycode.
 * `new URL('https://xn--80ak6aa92e.com').hostname` tetap mengembalikan bentuk
 * `xn--...` karena Chrome sengaja mempertahankan bentuk ASCII-nya, dan
 * `URL.domainToUnicode` hanya ada di Node. Tanpa decoder ini, domain homoglyph
 * berpunycode tidak akan pernah terdeteksi.
 *
 * Implementasi sengaja mengembalikan `null` alih-alih melempar, karena input berasal
 * dari halaman web yang tidak dapat dipercaya dan tidak boleh bisa menghentikan
 * analisis.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

/** Batas aman agar input rusak tidak membuat loop melar. */
const MAX_OUTPUT_CODEPOINTS = 1024;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);

  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }

  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

function decodeDigit(codePoint: number): number {
  // '0'-'9' -> 26..35, 'a'-'z' -> 0..25, 'A'-'Z' -> 0..25
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 0x30 + 26;
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61;
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41;
  return BASE;
}

/**
 * Mendekode satu label punycode (tanpa awalan `xn--`).
 * Mengembalikan `null` bila label tidak valid.
 */
export function decodePunycodeLabel(input: string): string | null {
  if (input.length === 0) return null;
  // Label punycode hanya boleh berisi huruf/angka/dash.
  if (!/^[A-Za-z0-9-]+$/.test(input)) return null;

  const output: number[] = [];

  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;

  const delimiter = input.lastIndexOf('-');
  let inIndex = 0;

  if (delimiter > -1) {
    for (let j = 0; j < delimiter; j++) {
      const cp = input.charCodeAt(j);
      if (cp >= 0x80) return null;
      output.push(cp);
    }
    inIndex = delimiter + 1;
    if (output.length === 0 && delimiter === 0) {
      // Label diawali dash tanpa basic code point: tidak valid.
      return null;
    }
  }

  while (inIndex < input.length) {
    const oldi = i;
    let w = 1;

    for (let k = BASE; ; k += BASE) {
      if (inIndex >= input.length) return null;

      const cp = input.charCodeAt(inIndex);
      inIndex++;
      if (cp >= 0x80) return null;

      const digit = decodeDigit(cp);
      if (digit >= BASE) return null;
      if (digit > Math.floor((Number.MAX_SAFE_INTEGER - i) / w)) return null;

      i += digit * w;

      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;

      if (w > Math.floor(Number.MAX_SAFE_INTEGER / (BASE - t))) return null;
      w *= BASE - t;
    }

    const numPoints = output.length + 1;
    bias = adapt(i - oldi, numPoints, oldi === 0);

    if (i > Math.floor(Number.MAX_SAFE_INTEGER / numPoints)) return null;
    n += Math.floor(i / numPoints);
    i = i % numPoints;

    if (n < 0 || n > 0x10ffff) return null;
    if (n >= 0xd800 && n <= 0xdfff) return null;

    output.splice(i, 0, n);
    i++;

    if (output.length > MAX_OUTPUT_CODEPOINTS) return null;
  }

  let result = '';
  for (const cp of output) result += String.fromCodePoint(cp);
  return result;
}

/**
 * Mengubah hostname ASCII berpunycode menjadi bentuk Unicode.
 * Label yang bukan punycode dibiarkan apa adanya. Bila ada satu label yang gagal
 * didekode, seluruh hostname dikembalikan apa adanya agar pemanggil tidak pernah
 * membandingkan campuran bentuk ASCII dan Unicode.
 */
export function punycodeToUnicode(hostname: string): string {
  if (!hostname.toLowerCase().includes('xn--')) return hostname;

  const labels = hostname.split('.');
  const decoded: string[] = [];

  for (const label of labels) {
    if (!label.toLowerCase().startsWith('xn--')) {
      decoded.push(label);
      continue;
    }

    const result = decodePunycodeLabel(label.slice(4));
    if (result === null) return hostname;
    decoded.push(result);
  }

  return decoded.join('.');
}

/** `true` bila hostname memuat minimal satu label berpunycode. */
export function hasPunycodeLabel(hostname: string): boolean {
  return hostname
    .toLowerCase()
    .split('.')
    .some((label) => label.startsWith('xn--'));
}
