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
 * ## Dua lingkup pembacaan
 *
 * `scanGmailInbox` dapat dipanggil dengan `scope: 'page'` (default) atau `'conversation'`.
 * Yang pertama membaca seluruh dokumen dan itu yang dibutuhkan skrip konsol — ia memang
 * ingin tahu apa saja yang cocok di halaman itu. Yang kedua hanya membaca pesan-pesan pada
 * percakapan yang sedang terbuka, dan itu yang dibutuhkan panel.
 *
 * Pembedaan ini ada karena satu temuan dari probe halaman sungguhan: **dokumen Gmail
 * memuat lebih dari satu elemen beralamat**, dan tidak semuanya pengirim. Di dalam satu
 * pesan, chip penerima ("to saya") sama-sama membawa `email` dan `name`. Di luar pesan,
 * ada avatar akun dan sisa DOM lain. Membaca seluruh dokumen lalu memilih temuan terberat
 * berarti panel dapat menjelaskan orang lain daripada yang sedang dibaca pengguna —
 * dan itu pernah terjadi.
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
  ScanOptions,
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

/**
 * Penanda satu pesan di dalam percakapan Gmail.
 *
 * Pada percakapan yang terbuka, setiap pesan berada di dalam satu elemen yang membawa
 * `data-message-id`, dengan nilai berbentuk `#msg-f:<angka>`. Itu **pengamatan dari probe
 * halaman thread sungguhan**, bukan tebakan: nilai yang sama juga terjawab oleh
 * `closest('[data-message-id]')` dari elemen pengirim, chip penerima, dan avatar pesan.
 *
 * Atribut ini yang membuat batas percakapan dapat ditentukan tanpa menyebut satu pun nama
 * kelas: baris list view membawa `data-legacy-thread-id`, bukan `data-message-id`, sehingga
 * daftar inbox tidak ikut terbaca sebagai percakapan.
 */
const MESSAGE_CONTAINER_SELECTOR = '[data-message-id]';

/**
 * Kandidat pembaca pengirim **di dalam satu pesan**, berurutan dari yang paling informatif.
 *
 * Urutannya berbeda dari `SENDER_SELECTORS`, dan alasannya adalah temuan dari halaman
 * sungguhan: di dalam satu pesan ada **lebih dari satu** elemen beralamat. Baris pengirim
 * dan chip penerima sama-sama membawa `email` dan `name` — pada probe nyata, chip itu
 * berbentuk `<span class="g2" email="..." name="saya">`, yaitu cara Gmail menulis "to me".
 *
 * Yang menentukan pengirim bukan ada-tidaknya atribut `name`, melainkan **urutan dokumen**:
 * pada header Gmail, baris pengirim selalu mendahului baris penerima. Karena itu
 * `[email]` didahulukan daripada `[email][name]` — bentuk terakhir akan memilih chip
 * penerima justru ketika pengirim tidak menampilkan nama, dan itu kebalikan dari yang benar.
 */
const MESSAGE_SENDER_SELECTORS: readonly SenderSelector[] = [
  {
    selector: '[email]',
    purpose: 'elemen beralamat pertama di dalam satu pesan, yaitu baris pengirim',
  },
  {
    selector: '[data-hovercard-id]',
    purpose: 'avatar pengirim, membawa alamat tanpa atribut email',
  },
];

/**
 * Kandidat selector untuk indikator "via". Dilaporkan di mode diagnostik; pembacaannya
 * di `readViaHint`. Keduanya **belum pernah cocok** pada probe nyata mana pun — lihat
 * catatan pada `VIA_ELEMENT_CLASSES`.
 */
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
 * Kandidat kelas elemen penanda "via". **Hipotesis, bukan hasil pengukuran.**
 *
 * `span.zx` berasal dari dugaan awal tentang cara Gmail merender penanda "via", dan
 * sampai sekarang **belum pernah terbukti**. Pada setiap probe nyata yang tercatat,
 * selector ini melaporkan **0 kecocokan**: dua halaman inbox (47 dan 12 baris, yang
 * pertama contoh keluarannya ada di `docs/FIREFOX.md`), satu thread terbuka, dan satu
 * tampilan Promotions. Belum ada satu pun halaman yang menghasilkan kecocokan.
 *
 * Versi sebelumnya menulis di sini bahwa `span.zx` "dilaporkan cocok 1 pada probe
 * halaman inbox sungguhan". Angka itu salah tempat: **1** adalah jumlah kecocokan
 * `[role="alert"]` pada keluaran yang sama, dan contoh keluaran nyata di
 * `docs/FIREFOX.md` mencatat `span.zx` justru sebagai "tidak cocok". Klaim itu dicabut
 * di sini karena klaim salah yang tampak terverifikasi lebih berbahaya daripada tidak
 * ada klaim sama sekali: ia menghentikan orang berikutnya dari memeriksanya.
 *
 * Akibatnya jalur ini **tidak boleh diandalkan**. `readViaHint` tetap mencobanya karena
 * biayanya nol dan ia akan bekerja begitu Gmail memang memakai kelas ini — tetapi
 * pembacaan "via" yang berhasil belum pernah teramati sama sekali.
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
 * Bentuk di bawah ini **asumsi, bukan pengamatan**: penanda "via" bersaudara dengan
 * elemen pengirim, dan kelasnya `zx`.
 *
 * ```html
 * <tr class="zA">
 *   <td><span email="no-reply@mngl.in" name="Rise">Rise</span></td>
 *   <td><span class="zx">via sendgrid.net</span></td>
 * </tr>
 * ```
 *
 * Yang **tidak** diasumsikan adalah letaknya: apa pun nama kelasnya, penanda itu berada
 * di dalam baris pesan yang sama. Karena itu pencarian dimulai dari wadah baris (`tr`,
 * atau leluhur terdekat yang tersedia) dan dilakukan **ke dalam**, bukan ke atas. Arah
 * itu benar terlepas dari kelasnya, dan itulah perbaikan sebenarnya — versi sebelumnya
 * menaiki `parentElement` dan membaca `textContent` setiap leluhur, sehingga tidak dapat
 * mencapai elemen bersaudara, ditambah batas 400 karakter yang selalu terlampaui oleh
 * panjang baris Gmail.
 *
 * Perilaku barunya diuji dengan DOM tiruan. Perlu ditegaskan: test itu **membuktikan
 * mekanismenya, bukan asumsinya** — DOM tiruannya dibangun dari bentuk di atas, jadi ia
 * tidak dapat membuktikan bahwa Gmail sungguhan memakai kelas `zx`. Sampai sekarang tidak
 * ada probe nyata yang pernah menemukan elemen itu.
 */
function readViaHint(el: ElementLike): string | null {
  const row = el.closest('tr') ?? el.parentElement ?? el;

  // Tingkat 1: kelas yang *diharapkan* menjadi penanda "via". Belum pernah cocok pada
  // satu pun probe nyata, jadi ini hipotesis murah yang dicoba lebih dulu — bukan jalur
  // yang diandalkan. Lihat catatan pada VIA_ELEMENT_CLASSES.
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

interface MessageSender {
  readonly address: string;
  readonly displayName: string | null;
  /** `true` bila nama diambil dari teks elemen, bukan dari atribut `name`. */
  readonly fromText: boolean;
  readonly selector: string;
  readonly viaHint?: string;
}

/**
 * Membaca nama pengirim dari elemen jangkar di dalam satu pesan.
 *
 * Atribut `name` pada jangkar sendiri adalah sumber pertama. Bila tidak ada, nama dicari
 * pada keturunan jangkar — Gmail kadang membungkus baris pengirim dengan elemen yang juga
 * membawa `email` tetapi tanpa `name`. Teks jangkar diperiksa **paling akhir**, karena pada
 * elemen pembungkus teks itu memuat seluruh baris header, termasuk bagian penerima.
 */
function readSenderName(anchor: ElementLike, address: string): NameReading {
  const own = readDisplayName(anchor, address);
  if (own.displayName !== null && !own.fromText) return own;

  for (const inner of queryWithin(anchor, '[name]')) {
    const reading = readDisplayName(inner, address);
    if (reading.displayName !== null && !reading.fromText) return reading;
  }

  return own;
}

/**
 * Membaca pengirim dari satu wadah pesan.
 *
 * Mengembalikan elemen **pertama** yang alamatnya dapat diurai, mengikuti urutan
 * `MESSAGE_SENDER_SELECTORS` lalu urutan dokumen. Elemen kedua dan seterusnya di dalam
 * wadah yang sama sengaja diabaikan: pada header Gmail, yang datang setelah baris pengirim
 * adalah penerima, dan penerima bukan pengirim.
 *
 * `null` berarti pesan ini tidak menyediakan pengirim yang dapat dibaca. Itu bukan
 * kesalahan; pesan yang sedang dilipat, atau bentuk DOM yang belum dikenal, memang
 * menghasilkan itu.
 */
function readMessageSender(container: ElementLike): MessageSender | null {
  for (const candidate of MESSAGE_SENDER_SELECTORS) {
    for (const element of queryWithin(container, candidate.selector)) {
      const address = readAddress(element);
      if (address === null) continue;

      const reading = readSenderName(element, address);
      const viaHint = readViaHint(element) ?? undefined;

      return {
        address,
        displayName: reading.displayName,
        fromText: reading.fromText,
        selector: candidate.selector,
        ...(viaHint !== undefined ? { viaHint } : {}),
      };
    }
  }

  return null;
}

interface ConversationReading {
  readonly senders: readonly SenderCandidate[];
  readonly selectorUsed: string | null;
}

/**
 * Pengirim dari percakapan yang sedang terbuka, satu per pesan.
 *
 * Daftar kosong berarti lingkup percakapan **tidak dapat ditegakkan** — tidak ada penanda
 * pesan, atau penandanya ada tetapi tidak satu pun pesannya menyediakan pengirim.
 *
 * Yang **tidak** dilakukan fungsi ini adalah jatuh kembali ke seluruh halaman. Versi
 * pertamanya melakukannya, dengan alasan "kegagalan mengenali bentuk halaman tidak boleh
 * berarti panel kosong". Probe pada halaman Gmail sungguhan membuktikan alasan itu salah:
 * pada halaman yang URL-nya menunjuk sebuah thread, DOM dapat berisi **daftar inbox**
 * (103 elemen pengirim pada satu probe, termasuk alamat penerima) sementara percakapannya
 * belum ada. Jatuh kembali ke seluruh halaman di keadaan itu berarti panel menjelaskan
 * pengirim mana pun yang temuannya paling berat — persis bug yang membuat panel ini
 * pernah menampilkan orang yang sama untuk setiap email. Panel kosong lebih baik daripada
 * panel yang salah, dan itu aturan yang sudah tertulis di perekat ekstensinya.
 */
function collectConversationSenders(doc: DocumentLike, notes: string[]): ConversationReading {
  const containers = toArray(safeQuery(doc, MESSAGE_CONTAINER_SELECTOR));

  if (containers.length === 0) {
    notes.push(
      `lingkup percakapan diminta, tetapi tidak ada ${MESSAGE_CONTAINER_SELECTOR} di halaman; tidak ada pengirim yang ditampilkan, dan pemindaian **tidak** jatuh kembali ke seluruh halaman`,
    );
    return { senders: [], selectorUsed: null };
  }

  const byAddress = new Map<string, SenderCandidate>();
  const contributedBy = new Set<string>();

  for (const container of containers) {
    const sender = readMessageSender(container);
    if (sender === null) continue;

    const key = sender.address.trim().toLowerCase();
    if (byAddress.has(key)) continue;

    if (sender.fromText) {
      notes.push(
        `display name "${sender.displayName}" dibaca dari teks, bukan atribut name (${sender.selector}, di dalam pesan)`,
      );
    }

    byAddress.set(key, {
      displayName: sender.displayName,
      fromAddress: sender.address.trim(),
      sourceSelector: sender.selector,
      ...(sender.viaHint !== undefined ? { viaHint: sender.viaHint } : {}),
    });
    contributedBy.add(sender.selector);
  }

  if (byAddress.size === 0) {
    notes.push(
      'penanda pesan ditemukan, tetapi tidak ada pengirim yang terbaca di dalamnya; tidak ada pengirim yang ditampilkan',
    );
    return { senders: [], selectorUsed: null };
  }

  return {
    senders: [...byAddress.values()],
    selectorUsed:
      MESSAGE_SENDER_SELECTORS.find((candidate) => contributedBy.has(candidate.selector))
        ?.selector ?? null,
  };
}

/**
 * Memindai halaman Gmail dan menghasilkan laporan lengkap.
 *
 * Tidak pernah melempar. Halaman web adalah input yang tidak dapat dipercaya, dan
 * adapter yang melempar akan mematikan extension pada halaman yang paling tidak
 * terduga.
 */
export function scanGmailInbox(doc: DocumentLike, options: ScanOptions = {}): AdapterReport {
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

  // Lingkup percakapan dihitung setelah probe: probe tetap melaporkan kecocokan pada
  // seluruh halaman, karena justru itulah yang diperiksa mode diagnostik. Yang dipersempit
  // hanya daftar pengirim yang diserahkan ke pemanggil.
  const conversation =
    (options.scope ?? 'page') === 'conversation' ? collectConversationSenders(doc, notes) : null;

  const senders = conversation?.senders ?? [...byAddress.values()];
  const selectorUsed =
    conversation === null
      ? (SENDER_SELECTORS.find((candidate) => contributedBy.has(candidate.selector))?.selector ?? null)
      : conversation.selectorUsed;

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
