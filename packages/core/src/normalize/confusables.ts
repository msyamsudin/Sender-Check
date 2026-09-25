/**
 * Skeleton confusable menurut Unicode TR39.
 *
 * Definisi TR39: NFD -> map confusables -> NFD -> buang default-ignorable.
 *
 * Kenapa bukan NFKC: NFKC **tidak** memetakan Cyrillic "а" (U+0430) ke Latin "a",
 * dan tidak pula Greek "ο" (U+03BF). Kekeliruan ini adalah penyebab paling umum
 * deteksi homoglyph yang gagal total, karena justru karakter itulah yang dipakai
 * penyerang.
 *
 * Tabel berasal dari confusables.txt resmi dan hanya memuat sumber non-ASCII
 * (lihat tools/gen-unicode/generate.ts untuk alasannya).
 */
import { CONFUSABLES_COUNT, CONFUSABLES_RAW } from '../data/confusables.generated.ts';

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

let table: Map<number, string> | null = null;

function getTable(): Map<number, string> {
  if (table !== null) return table;

  const parsed = new Map<number, string>();
  for (const line of CONFUSABLES_RAW.split('\n')) {
    if (line.length === 0) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const cp = Number.parseInt(line.slice(0, separator), 16);
    if (Number.isNaN(cp)) continue;
    parsed.set(cp, line.slice(separator + 1));
  }

  if (parsed.size !== CONFUSABLES_COUNT) {
    throw new Error(
      `tabel confusable rusak: terbaca ${parsed.size}, seharusnya ${CONFUSABLES_COUNT}`,
    );
  }

  table = parsed;
  return table;
}

/** Memetakan setiap karakter ke prototype ASCII-nya; karakter tanpa mapping dibiarkan. */
export function mapConfusables(text: string): string {
  const map = getTable();
  let out = '';
  let changed = false;

  for (const char of text) {
    const cp = char.codePointAt(0);
    if (cp === undefined) continue;
    const mapped = map.get(cp);
    if (mapped === undefined) {
      out += char;
    } else {
      out += mapped;
      changed = true;
    }
  }

  return changed ? out : text;
}

/**
 * Skeleton TR39 dari teks apa adanya.
 *
 * Hanya membuang default-ignorable; ia TIDAK membuang tanda diakritik, karena
 * penghapusan diakritik adalah tugas tahap normalisasi, bukan skeleton. Kalau
 * keduanya dicampur, "café" dan "cafe" akan terlihat sebagai perbedaan homoglyph
 * padahal hanya perbedaan diakritik — dan itu mengubah severity rule secara salah.
 *
 * Idempoten: seluruh target mapping adalah ASCII, dan sumber ASCII sengaja tidak
 * dimasukkan ke tabel, sehingga penerapan kedua tidak mengubah apa pun. Sifat ini
 * diuji oleh property test.
 */
export function toSkeleton(text: string): string {
  const nfd = text.normalize('NFD');
  const mapped = mapConfusables(nfd);
  const renfd = mapped.normalize('NFD');
  return renfd.replace(DEFAULT_IGNORABLE, '');
}

/**
 * `true` bila kedua teks hanya berbeda pada tingkat homoglyph, yaitu sama setelah
 * di-skeleton, tetapi berbeda sebelum di-skeleton.
 */
export function isConfusableOnlyDifference(a: string, b: string): boolean {
  if (a === b) return false;
  return toSkeleton(a) === toSkeleton(b);
}
