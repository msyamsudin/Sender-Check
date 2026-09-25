/**
 * Penguraian alamat surel.
 *
 * Sengaja minimal dan defensif: input berasal dari DOM halaman web yang tidak dapat
 * dipercaya, dan RFC 5322 penuh jauh lebih rumit daripada yang dibutuhkan di sini.
 * Yang penting adalah tidak pernah melempar, dan tidak pernah menebak ketika input
 * memang tidak dapat diurai — pemanggil harus tahu bedanya "tidak ada domain" dan
 * "domainnya string kosong".
 */

export interface ParsedAddress {
  readonly raw: string;
  /** Bagian sebelum '@' terakhir. String kosong bila tidak ada. */
  readonly localPart: string;
  /** Bagian setelah '@' terakhir, huruf kecil, tanpa titik di ujung. */
  readonly hostname: string;
  readonly valid: boolean;
}

const EMPTY: ParsedAddress = { raw: '', localPart: '', hostname: '', valid: false };

/**
 * Mengambil bagian alamat dari nilai header.
 * `"Budi <budi@example.com>"` -> `"budi@example.com"`.
 */
export function extractAddressPart(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return '';

  const open = trimmed.lastIndexOf('<');
  const close = trimmed.lastIndexOf('>');

  if (open !== -1 && close > open) {
    const inside = trimmed.slice(open + 1, close).trim();
    // Buang komentar dan tanda kutip yang membungkus alamat.
    return inside.replace(/^["']|["']$/g, '').trim();
  }

  // Tanpa kurung sudut: buang komentar dalam tanda kurung.
  return trimmed.replace(/\([^)]*\)/g, '').trim();
}

/** Mengurai satu alamat surel. Tidak pernah melempar. */
export function parseAddress(raw: string): ParsedAddress {
  const addressPart = extractAddressPart(raw);

  if (addressPart.length === 0) return { ...EMPTY, raw };

  const at = addressPart.lastIndexOf('@');
  if (at === -1) {
    return { raw, localPart: addressPart.toLowerCase(), hostname: '', valid: false };
  }

  const localPart = addressPart.slice(0, at).trim();
  const hostname = addressPart
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');

  if (localPart.length === 0 || hostname.length === 0) {
    return { raw, localPart, hostname, valid: false };
  }

  return { raw, localPart, hostname, valid: true };
}

/**
 * Mengambil semua alamat surel yang tertanam di dalam sebuah teks,
 * mis. display name berbentuk `"support@yourbank.com"`.
 */
export function findEmbeddedAddresses(text: string): string[] {
  const matches = text.match(/[^\s<>()[\]{},;:"]+@[^\s<>()[\]{},;:"]+/gu);
  if (matches === null) return [];
  return matches.filter((candidate) => candidate.includes('.'));
}

/**
 * Membuat kandidat local-part dari sebuah nama.
 *
 * Dipakai untuk menguji apakah local-part alamat tampak diturunkan dari nama yang
 * ditampilkan. Daftar ini sengaja terbatas dan deterministik; kanal similarity tetap
 * punya peran untuk bentuk yang tidak ada di sini.
 */
export function localPartCandidates(tokens: readonly string[]): string[] {
  const cleaned = tokens.map((token) => token.replace(/[^\p{L}\p{N}]/gu, '')).filter((t) => t.length > 0);

  if (cleaned.length === 0) return [];
  if (cleaned.length === 1) {
    const only = cleaned[0];
    return only === undefined ? [] : [only];
  }

  const first = cleaned[0] ?? '';
  const last = cleaned[cleaned.length - 1] ?? '';
  const middles = cleaned.slice(1, -1);

  const candidates = new Set<string>();

  candidates.add(cleaned.join(''));
  candidates.add(`${first}.${last}`);
  candidates.add(`${first}_${last}`);
  candidates.add(`${first}-${last}`);
  candidates.add(`${first}${last}`);
  candidates.add(`${last}${first}`);
  candidates.add(`${last}.${first}`);
  candidates.add(`${last}_${first}`);
  candidates.add(`${first}${last}${middles.join('')}`);

  const firstInitial = first.charAt(0);
  const lastInitial = last.charAt(0);
  if (firstInitial.length > 0) {
    candidates.add(`${firstInitial}${last}`);
    candidates.add(`${firstInitial}.${last}`);
    candidates.add(`${firstInitial}_${last}`);
    candidates.add(`${firstInitial}${lastInitial}`);
    candidates.add(`${firstInitial}.${lastInitial}`);
  }
  if (lastInitial.length > 0 && first.length > 1) {
    // Nama belakang diikuti inisial nama depan, mis. "smithj". Sebelumnya di sini
    // dipakai inisial nama belakang sehingga yang dihasilkan "smiths" — bentuk yang
    // tidak pernah dipakai orang dan membuat kandidat yang benar tidak pernah diuji.
    candidates.add(`${last}${firstInitial}`);
    candidates.add(`${last}.${firstInitial}`);
    candidates.add(`${last}_${firstInitial}`);
  }

  // Versi dengan sisa token sebagai inisial, mis. "john.p.smith".
  if (middles.length > 0) {
    const middleInitials = middles.map((token) => token.charAt(0)).join('');
    if (middleInitials.length > 0) {
      candidates.add(`${first}.${middleInitials}.${last}`);
      candidates.add(`${first}${middleInitials}${last}`);
    }
  }

  return [...candidates].filter((candidate) => candidate.length >= 2);
}
