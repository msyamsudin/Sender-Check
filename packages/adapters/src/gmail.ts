/**
 * Adapter Gmail, Tier A: display name dan alamat dari DOM inbox.
 *
 * ## Kenapa selector berbasis atribut, bukan berbasis kelas
 *
 * Gmail mengganti nama kelasnya secara berkala, dan nama kelas adalah urusan
 * *presentasi*. Yang jauh lebih stabil adalah **atribut data** milik Gmail sendiri:
 * `email`, `name`, dan `data-hovercard-id`. Ketiganya dipakai oleh JavaScript Gmail
 * untuk memfungsikan halaman, sehingga mengubahnya berarti merusak Gmail sendiri.
 *
 * Karena itu strategi utamanya adalah `[email][name]`, bukan `.yW` atau `.gD`.
 * Selector kelas tetap disertakan di daftar probe sebagai pembanding, supaya mode
 * diagnostik menunjukkan mana yang masih bekerja.
 *
 * ## Yang tidak dilakukan modul ini
 *
 * Ia tidak memanggil `analyze()` dan tidak tahu apa pun tentang rule. Ia hanya
 * menerjemahkan DOM menjadi `EmailIdentity`. Batas itu yang membuat engine tetap
 * bebas DOM dan dapat diuji tanpa browser.
 */
import { parseAddress } from '@sender-check/core';
import type {
  AdapterReport,
  DocumentLike,
  ElementLike,
  GmailView,
  LocationLike,
  SelectorProbe,
  SenderCandidate,
} from './types.ts';

interface SenderSelector {
  readonly selector: string;
  readonly purpose: string;
}

/**
 * Kandidat selector pembaca pengirim, berurutan dari yang paling spesifik.
 *
 * Daftarnya sengaja lebih panjang daripada yang diperkirakan berguna. Mode diagnostik
 * melaporkan berapa elemen yang cocok untuk **setiap** kandidat, sehingga kita belajar
 * mana yang masih bekerja pada Gmail hari ini alih-alih menebak.
 */
const SENDER_SELECTORS: readonly SenderSelector[] = [
  {
    selector: 'span[email][name]',
    purpose: 'span pengirim yang membawa alamat dan nama sekaligus',
  },
  {
    selector: '[email][name]',
    purpose: 'elemen mana pun yang membawa alamat dan nama',
  },
  {
    selector: 'span[email]',
    purpose: 'span pengirim dengan alamat saja',
  },
  {
    selector: '[email]',
    purpose: 'elemen mana pun dengan alamat',
  },
  {
    selector: '[data-hovercard-id]',
    purpose: 'atribut hovercard Gmail, berisi alamat tanpa nama',
  },
];

/** Kandidat selector untuk indikator "via". Dilaporkan di mode diagnostik; pembacaannya di `readViaHint`. */
const VIA_SELECTORS: readonly SenderSelector[] = [
  { selector: 'span.zx', purpose: 'penanda "via" pada baris pengirim' },
  { selector: '[aria-label*="via"]', purpose: 'penanda "via" lewat aria-label' },
];

/**
 * Kandidat selector untuk banner peringatan milik Gmail sendiri.
 *
 * Keberadaan elemen ini saja tidak cukup untuk menyimpulkan bahwa Gmail
 * memperingatkan sebuah pesan — lihat `looksLikeGmailWarning`.
 */
const WARNING_SELECTORS: readonly SenderSelector[] = [
  { selector: '[role="alert"]', purpose: 'banner peringatan berperan alert' },
  { selector: '.aZb', purpose: 'banner peringatan gaya lama Gmail' },
  { selector: '.aZc', purpose: 'banner peringatan gaya lama Gmail (varian)' },
];

/** Pola "via <domain>" di dalam teks. Dipakai untuk indikator "via". */
const VIA_IN_TEXT = /(?:^|\s)via\s+([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;

/** Nama domain yang dibersihkan dari tanda baca di ujungnya. */
const DOMAIN_TAIL = /^([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;

/**
 * Kelas elemen yang Gmail pakai khusus untuk penanda "via" pada baris pengirim.
 *
 * `span.zx` dilaporkan **cocok 1** pada probe halaman inbox sungguhan, sementara
 * `[aria-label*="via"]` tidak cocok. Karena itu penanda ini dipakai lebih dulu;
 * tingkat berikutnya hanya cadangan bila Gmail mengganti namanya.
 */
const VIA_ELEMENT_CLASSES: readonly string[] = ['span.zx', 'span[class*="zx"]'];

/** Atribut yang membawa penanda "via" sebagai label aksesibilitas. */
const VIA_ARIA_SELECTORS: readonly string[] = ['[aria-label*="via"]', '[title*="via"]'];

/**
 * Batas teks baris yang masih dipakai sebagai cadangan terakhir.
 *
 * Bukan pembatas keamanan, hanya pembatas biaya. Teks baris memuat cuplikan pesan
 * yang dikendalikan pengirim, karena itu cadangan ini diperiksa paling akhir.
 */
const MAX_ROW_TEXT_LENGTH = 2000;

/**
 * Frasa yang muncul di banner peringatan milik Gmail sendiri.
 *
 * Diperiksa dalam huruf kecil dan tanpa tanda diakritik. Daftar ini sengaja
 * dijadikan pengaman: `[role="alert"]` dipakai Gmail untuk banyak hal, sehingga
 * keberadaan elemen itu saja tidak membuktikan bahwa Gmail memperingatkan pesan.
 * Positif palsu di sini berarti pengguna diberi tahu hal yang tidak benar.
 */
const WARNING_MESSAGES: readonly string[] = [
  'hati-hati dengan pesan ini',
  'pesan ini mungkin tidak berasal',
  'jangan klik link',
  'jangan klik tautan',
  'be careful with this message',
  'this message may not have been sent',
  'this message seems dangerous',
  'it may be a phishing',
  'avoid clicking links',
  'ne provient peut-etre pas',
  'soyez prudent',
  'evitez de cliquer',
];

/**
 * Halaman Gmail yang sedang dibuka.
 *
 * Parameternya dinamai `page`, bukan `location`, dengan sengaja: menamainya `location`
 * akan menutupi global browser, dan kebiasaan itu mengundang pemakaian global asli
 * tanpa sadar di dalam modul yang seharusnya hanya bekerja pada antarmuka yang
 * dipersempit.
 */
export function detectGmailView(page: LocationLike): GmailView {
  const href = page.href.toLowerCase();

  // `view=om` adalah halaman "Show original". Diperiksa lebih dulu karena halaman itu
  // juga berada di bawah /mail/u/ dan akan salah dikenali sebagai inbox.
  if (/[?&]view=om\b/.test(href)) return 'show-original';

  if (href.includes('mail.google.com') && href.includes('/mail/u/')) return 'inbox';

  return 'unknown';
}

function toArray(elements: ArrayLike<ElementLike>): ElementLike[] {
  const out: ElementLike[] = [];
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    if (element !== undefined) out.push(element);
  }
  return out;
}

/** Membaca alamat dari atribut Gmail. `data-hovercard-id` dipakai sebagai cadangan. */
function readAddress(element: ElementLike): string | null {
  const candidates = [element.getAttribute('email'), element.getAttribute('data-hovercard-id')];
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const parsed = parseAddress(candidate);
    if (parsed.valid) return parsed.hostname.length > 0 ? candidate.trim() : null;
  }
  return null;
}

interface NameReading {
  readonly displayName: string | null;
  /** `true` bila nama diambil dari teks, bukan dari atribut `name`. */
  readonly fromText: boolean;
}

/**
 * Membaca display name.
 *
 * Atribut `name` adalah sumber yang benar. Teks elemen hanya dipakai sebagai cadangan,
 * dan pemakaiannya dicatat sebagai catatan diagnostik — karena teks elemen bisa saja
 * berisi alamat itu sendiri, dan memperlakukannya sebagai nama akan mengubah hasil
 * analisis.
 */
function readDisplayName(element: ElementLike, address: string): NameReading {
  const attribute = element.getAttribute('name');
  if (attribute !== null && attribute.trim().length > 0) {
    return { displayName: attribute.trim(), fromText: false };
  }

  const text = element.textContent?.trim() ?? '';
  if (text.length === 0) return { displayName: null, fromText: false };

  // Kalau yang ditampilkan adalah alamatnya sendiri, Gmail sedang tidak menampilkan
  // nama. Itu berbeda dari menampilkan nama yang kebetulan sama.
  if (text.toLowerCase() === address.trim().toLowerCase()) {
    return { displayName: null, fromText: false };
  }

  return { displayName: text, fromText: true };
}

/** Membersihkan domain hasil tangkapan dari tanda baca di ujungnya. */
function cleanDomain(raw: string): string | null {
  const match = DOMAIN_TAIL.exec(raw.trim());
  return match?.[1] === undefined ? null : match[1].toLowerCase();
}

function queryWithin(root: ElementLike, selector: string): ElementLike[] {
  try {
    return toArray(root.querySelectorAll(selector));
  } catch {
    // Selector yang tidak valid tidak boleh menghentikan seluruh pemindaian.
    return [];
  }
}

/**
 * Mencari indikator "via" pada baris pesan.
 *
 * ## Kenapa baris, bukan leluhur
 *
 * Gmail merender penanda "via" sebagai elemen **bersaudara** dengan elemen pengirim:
 *
 * ```html
 * <tr class="zA">
 *   <td><span email="no-reply@mngl.in" name="Rise">Rise</span></td>
 *   <td><span class="zx">via sendgrid.net</span></td>
 * </tr>
 * ```
 *
 * Versi sebelumnya menaiki `parentElement` dari elemen pengirim dan membaca
 * `textContent` setiap leluhur. Dua hal membuatnya tidak pernah bekerja:
 * penanda itu tidak berada di rantai leluhur, dan leluhur yang memuatnya
 * (baris pesan) hampir selalu lebih panjang daripada batas 400 karakter yang
 * dipakai saat itu, sehingga selalu ditolak. Terverifikasi dengan DOM tiruan:
 * `span.zx` berisi "via sendgrid.net" ada di baris yang sama, `viaHint` tetap
 * tidak terisi.
 *
 * Karena itu pencarian dimulai dari wadah baris (`tr`, atau leluhur terdekat
 * yang tersedia) dan dilakukan **ke dalam**, bukan ke atas.
 */
function readViaHint(el: ElementLike): string | null {
  const row = el.closest('tr') ?? el.parentElement ?? el;

  // Tingkat 1: elemen yang Gmail khususkan untuk penanda ini. Pada probe halaman
  // inbox sungguhan `span.zx` cocok 1, jadi jalur inilah yang diharapkan bekerja.
  for (const selector of VIA_ELEMENT_CLASSES) {
    for (const marker of queryWithin(row, selector)) {
      const text = marker.textContent ?? '';
      const match = VIA_IN_TEXT.exec(text);
      if (match?.[1] !== undefined) return match[1].toLowerCase();

      // Sebagian penanda hanya berisi nama domainnya, tanpa kata "via".
      if (text.length > 0 && text.length <= 60 && !/[\s@]/.test(text)) {
        const domain = cleanDomain(text);
        if (domain !== null) return domain;
      }
    }
  }

  // Tingkat 2: label aksesibilitas. Isinya sering berbentuk
  // "via sendgrid.net," dengan koma di ujung, sehingga hasilnya dibersihkan.
  for (const selector of VIA_ARIA_SELECTORS) {
    for (const marker of queryWithin(row, selector)) {
      for (const attribute of ['aria-label', 'title']) {
        const value = marker.getAttribute(attribute);
        if (value === null) continue;
        const match = VIA_IN_TEXT.exec(value);
        if (match?.[1] !== undefined) return match[1].toLowerCase();
      }
    }
  }

  // Tingkat 3: cadangan terakhir, yaitu teks baris. Baris memuat cuplikan pesan
  // yang dikendalikan pengirim, jadi hasil dari sini paling lemah — tetapi tetap
  // lebih baik daripada melaporkan "tidak ada indikator" ketika ada.
  const rowText = row.textContent ?? '';
  if (rowText.length > 0 && rowText.length <= MAX_ROW_TEXT_LENGTH) {
    const match = VIA_IN_TEXT.exec(rowText);
    if (match?.[1] !== undefined) return match[1].toLowerCase();
  }

  return null;
}

/**
 * Apakah elemen ini benar-benar banner peringatan Gmail.
 *
 * `[role="alert"]` dipakai Gmail untuk banyak hal di luar peringatan keamanan.
 * Mempercayai keberadaan elemennya saja membuat `gmailOwnWarning` menyala pada
 * halaman yang tidak memperingatkan apa pun, dan rule `GMAIL_OWN_WARNING_PRESENT`
 * memberi tahu pengguna sesuatu yang tidak benar. Karena itu isi teksnya diperiksa.
 */
export function looksLikeGmailWarning(element: ElementLike): boolean {
  const text = (element.textContent ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length === 0) return false;
  return WARNING_MESSAGES.some((message) => text.includes(message));
}

/**
 * Memindai halaman Gmail dan menghasilkan laporan lengkap.
 *
 * Tidak pernah melempar. Halaman web adalah input yang tidak dapat dipercaya, dan
 * adapter yang melempar akan mematikan extension pada halaman yang paling tidak
 * terduga.
 */
export function scanGmailInbox(doc: DocumentLike): AdapterReport {
  const probes: SelectorProbe[] = [];
  const notes: string[] = [];
  const byAddress = new Map<string, SenderCandidate>();
  const contributedBy = new Set<string>();

  for (const candidate of SENDER_SELECTORS) {
    const elements = toArray(safeQuery(doc, candidate.selector));
    let contributed = 0;

    for (const element of elements) {
      const address = readAddress(element);
      if (address === null) continue;

      const key = address.trim().toLowerCase();
      const reading = readDisplayName(element, address);

      if (reading.fromText) {
        notes.push(
          `display name "${reading.displayName}" dibaca dari teks, bukan atribut name (${candidate.selector})`,
        );
      }

      const existing = byAddress.get(key);

      // Penanda "via" dibaca untuk setiap elemen, bukan hanya yang pertama. Elemen
      // pembungkus dan elemen dalam sama-sama membawa atribut `email`, dan penanda
      // "via" hanya dapat ditemukan dari salah satunya. Membacanya hanya pada elemen
      // pertama berarti indikator itu hilang begitu elemen pembungkus muncul lebih
      // dulu — urutan yang ditentukan DOM Gmail, bukan oleh kita.
      const viaHint = existing?.viaHint ?? readViaHint(element) ?? undefined;

      // Elemen pembungkus dan elemen dalam sering sama-sama membawa atribut `email`.
      // Yang dipertahankan adalah yang punya display name, karena itulah yang benar.
      if (existing !== undefined) {
        const displayName = existing.displayName ?? reading.displayName;
        if (displayName !== existing.displayName || viaHint !== existing.viaHint) {
          byAddress.set(key, {
            displayName,
            fromAddress: existing.fromAddress,
            sourceSelector: candidate.selector,
            ...(viaHint !== undefined ? { viaHint } : {}),
          });
          contributed++;
          contributedBy.add(candidate.selector);
        }
        continue;
      }

      const sender: SenderCandidate = {
        displayName: reading.displayName,
        fromAddress: address.trim(),
        sourceSelector: candidate.selector,
        ...(viaHint !== undefined ? { viaHint } : {}),
      };

      byAddress.set(key, sender);
      contributed++;
      contributedBy.add(candidate.selector);
    }

    probes.push({
      selector: candidate.selector,
      purpose: candidate.purpose,
      matched: elements.length,
      contributed: contributed > 0,
    });
  }

  for (const candidate of VIA_SELECTORS) {
    probes.push({
      selector: candidate.selector,
      purpose: candidate.purpose,
      matched: safeQuery(doc, candidate.selector).length,
      contributed: false,
    });
  }

  const warningMatches = WARNING_SELECTORS.map((candidate) => {
    const elements = toArray(safeQuery(doc, candidate.selector));
    const confirmed = elements.some((element) => looksLikeGmailWarning(element));
    return { candidate, matched: elements.length, confirmed };
  });

  for (const { candidate, matched, confirmed } of warningMatches) {
    probes.push({
      selector: candidate.selector,
      purpose: candidate.purpose,
      matched,
      // `contributed` berarti "selector ini membuktikan adanya peringatan Gmail",
      // bukan sekadar "selector ini cocok". Pada probe halaman sungguhan
      // `[role="alert"]` cocok 1 tanpa membuktikan apa pun.
      contributed: confirmed,
    });
  }

  const gmailOwnWarning = warningMatches.some((entry) => entry.confirmed);
  if (gmailOwnWarning) {
    notes.push('banner peringatan milik Gmail terdeteksi pada halaman ini');
  } else if (warningMatches.some((entry) => entry.matched > 0)) {
    // Dicatat terpisah supaya mode diagnostik tidak menyembunyikan fakta bahwa
    // elemennya ada; hanya kesimpulannya yang tidak diambil.
    notes.push(
      'elemen berperan alert ada di halaman, tetapi tidak satu pun berisi teks peringatan Gmail; gmailOwnWarning tidak dinyalakan',
    );
  }

  const senders = [...byAddress.values()];
  const selectorUsed =
    SENDER_SELECTORS.find((candidate) => contributedBy.has(candidate.selector))?.selector ?? null;

  if (senders.length === 0) {
    notes.push(
      'tidak ada pengirim yang terbaca: tidak satu pun kandidat selector cocok. Extension harus no-op, bukan gagal diam-diam.',
    );
  }

  return {
    matched: senders.length > 0,
    selectorUsed,
    probes,
    senders,
    gmailOwnWarning,
    notes,
  };
}

/**
 * `querySelectorAll` yang tidak pernah melempar.
 *
 * Selector yang tidak valid, atau DOM yang tidak terduga, tidak boleh menghentikan
 * seluruh pemindaian.
 */
function safeQuery(doc: DocumentLike, selector: string): ArrayLike<ElementLike> {
  try {
    return doc.querySelectorAll(selector);
  } catch {
    return [];
  }
}
