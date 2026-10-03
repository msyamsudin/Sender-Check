/**
 * Halaman mana yang sedang dibuka.
 *
 * `detectGmailView()` di `@sender-check/adapters` sudah menjawab pertanyaan yang berbeda:
 * ia menentukan **data apa yang boleh dibaca** (inbox atau header Show original). Berkas
 * ini menjawab pertanyaan tampilan: **apakah sebuah thread sedang terbuka**, karena panel
 * ini sengaja hanya muncul di situ. Pemisahan itu disengaja — adapter tidak perlu tahu
 * apa pun tentang UI, dan UI tidak perlu tahu apa pun tentang selector.
 *
 * ## Kenapa hanya thread, bukan list view
 *
 * Indikator di list view berarti sinyal muncul tanpa diminta, pada puluhan baris sekaligus,
 * dan itu menuntut presisi yang belum dimiliki alat ini. Panel yang muncul hanya ketika
 * pengguna membuka satu pesan jauh lebih mudah dipertanggungjawabkan: pengguna memang
 * sedang memeriksa pesan itu.
 *
 * ## Kenapa deteksinya heuristik
 *
 * Gmail tidak menyediakan penanda "thread terbuka" yang eksplisit di DOM, dan satu-satunya
 * sinyal yang stabil adalah bentuk URL-nya: `#<label>/<id>`. Yang membuatnya tidak
 * sepele adalah hash yang juga memakai garis miring untuk hal lain, terutama pencarian
 * (`#search/<query>`) dan pengaturan (`#settings/general`). Aturan di bawah membedakan
 * ketiganya, dan setiap keputusannya punya test.
 */
import type { LocationLike } from '@sender-check/adapters';

export type PageKind =
  /** Satu thread sedang dibaca. Ini satu-satunya keadaan yang menampilkan panel. */
  | 'thread'
  /** List view: inbox, label, hasil pencarian. Sengaja tidak ditangani. */
  | 'list'
  /** Halaman "Show original": sumber Tier B, tempat Reply-To dan Return-Path terbaca. */
  | 'show-original'
  /** Bukan Gmail, atau halaman Gmail yang tidak berhubungan (mis. pengaturan). */
  | 'other';

/**
 * Panjang minimum sebuah id thread Gmail.
 *
 * Id Gmail berbentuk 16 digit heksadesimal (`17b1a2c3d4e5f6a7`) atau string campuran
 * huruf besar-kecil sepanjang lebih dari 30 karakter (`FMfcgzQhWfTQKcgkqjfRTgcjdqRfjvSM`).
 * Ambang 12 memisahkannya dari potongan URL lain yang juga berupa kata, seperti
 * `settings`, `filters`, atau nama label seperti `Work`.
 */
const MIN_THREAD_ID_LENGTH = 12;

function isThreadId(segment: string): boolean {
  return (
    segment.length >= MIN_THREAD_ID_LENGTH &&
    // Pencarian yang belum dibuka menaruh query-nya di segmen ini, dan query dapat memuat
    // spasi yang di-encode. Sebuah id thread tidak pernah memuat `%`.
    !segment.includes('%') &&
    /^[A-Za-z0-9_-]+$/.test(segment)
  );
}

/** Mengurai hash URL menjadi segmen yang tidak kosong. */
function hashSegments(href: string): string[] {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return [];
  return href
    .slice(hashIndex + 1)
    .split('/')
    .filter((segment) => segment.length > 0);
}

export function classifyPage(page: LocationLike): PageKind {
  const href = page.href;

  // Dua syarat, bukan satu: `mail.google.com` muncul juga di URL lain (mis. di parameter
  // `continue=`), dan memeriksa host di awal lebih aman daripada mencari di seluruh string.
  if (!/^https?:\/\/mail\.google\.com\//i.test(href)) return 'other';

  // `view=om` diperiksa lebih dulu karena halaman Show original juga berada di bawah
  // `/mail/u/` dan hash-nya dapat memuat id thread, sehingga akan salah dikenali sebagai
  // thread terbuka.
  if (/[?&]view=om\b/i.test(href)) return 'show-original';

  const segments = hashSegments(href);
  if (segments.length === 0) return 'list';

  const first = (segments[0] ?? '').toLowerCase();
  const last = segments[segments.length - 1] ?? '';

  // `#settings/general`, `#settings/filters`, ...
  if (first.startsWith('settings')) return 'other';

  // Satu segmen selalu berarti list view: `#inbox`, `#starred`, `#label/Work`.
  if (segments.length === 1) return 'list';

  // `#search/<query>` adalah hasil pencarian, bukan thread. Thread yang dibuka dari hasil
  // pencarian berbentuk `#search/<query>/<id>`, dan itu tertangkap oleh cabang berikutnya.
  if (first === 'search' && segments.length === 2) return 'list';

  return isThreadId(last) ? 'thread' : 'list';
}
