/**
 * Adapter Gmail, Tier B: pembaca halaman "Show original".
 *
 * Halaman itu (`...&view=om&th=...`) memuat pesan mentah beserta headernya di dalam
 * DOM. Karena itu `Reply-To`, `Return-Path`, dan `Authentication-Results` dapat dibaca
 * **tanpa network request tambahan**: pengguna yang membuka halamannya, extension
 * hanya membaca.
 *
 * ## Kenapa label tabel tidak dipakai
 *
 * Halaman Show original modern menampilkan ringkasan berlabel yang sudah
 * dilokalisasi ("dari:", "balas ke:", "dikirim oleh:"). Membaca label itu mengikat
 * adapter pada satu bahasa antarmuka. Sebaliknya, **header mentah selalu berbahasa
 * Inggris** dan selalu ada di halaman yang sama, sehingga itulah yang diurai.
 *
 * ## Model ancaman yang menentukan bentuk modul ini
 *
 * Isi pesan dikendalikan penyerang. Kalau header diurai dari seluruh teks halaman,
 * sebuah email cukup memuat baris `Return-Path: <pengirim-sah@bank.example>` di
 * badannya untuk memalsukan hasil analisis. Karena itu:
 *
 *  1. blok header dicari lewat **skor header tepercaya** — `Return-Path`,
 *     `Authentication-Results`, `DKIM-Signature`, `Delivered-To`, `Received` — yang
 *     tidak pernah muncul di badan pesan yang ditampilkan; minimal dua harus ada;
 *  2. penguraian **berhenti pada baris kosong pertama**, sesuai konvensi RFC 822 yang
 *     memisahkan header dari badan pesan.
 *
 * Tanpa dua penjagaan itu, alat ini bisa dibalik menjadi alat yang menipu penggunanya
 * sendiri.
 */
import { extractAddressPart, parseAddress } from '@sender-check/core';
import type {
  DocumentLike,
  ElementLike,
  HeaderReport,
  SelectorProbe,
} from './types.ts';

/**
 * Header yang tidak pernah muncul di badan pesan yang ditampilkan.
 *
 * Inilah yang dipakai menilai apakah sebuah blok teks benar-benar blok header, bukan
 * kutipan di dalam badan pesan.
 */
const TRUSTED_HEADERS: readonly string[] = [
  'return-path',
  'authentication-results',
  'dkim-signature',
  'delivered-to',
  'received',
  'received-spf',
];

/** Header yang diurai bila ditemukan. */
const WANTED_HEADERS: readonly string[] = [
  'from',
  'reply-to',
  'return-path',
  'authentication-results',
  'delivered-to',
  'received',
  'received-spf',
  'dkim-signature',
  'message-id',
  'date',
  'subject',
];

/** Kandidat wadah blok header, dari yang paling spesifik. */
const CONTAINER_SELECTORS: ReadonlyArray<{ selector: string; purpose: string }> = [
  { selector: 'div.aQy', purpose: 'wadah pesan mentah gaya lama' },
  { selector: 'div[role="main"] pre', purpose: 'blok teks di dalam area utama' },
  { selector: 'pre', purpose: 'blok teks terformat' },
  { selector: 'textarea', purpose: 'area teks' },
  { selector: 'td', purpose: 'sel tabel' },
  { selector: 'div', purpose: 'elemen blok' },
];

/** Jumlah minimum header tepercaya sebelum sebuah blok dianggap blok header. */
const MIN_TRUSTED_SCORE = 2;

/** Batas jumlah elemen yang diperiksa, agar halaman besar tidak membuat halaman macet. */
const MAX_CANDIDATES = 4000;

/** Panjang minimum teks sebelum sebuah elemen layak dipertimbangkan. */
const MIN_TEXT_LENGTH = 80;

const HEADER_LINE = /^([A-Za-z][A-Za-z0-9-]*):[ \t]?(.*)$/;

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;

function toArray(elements: ArrayLike<ElementLike>): ElementLike[] {
  const out: ElementLike[] = [];
  for (let index = 0; index < elements.length && out.length < MAX_CANDIDATES; index++) {
    const element = elements[index];
    if (element !== undefined) out.push(element);
  }
  return out;
}

function safeQuery(doc: DocumentLike, selector: string): ArrayLike<ElementLike> {
  try {
    return doc.querySelectorAll(selector);
  } catch {
    return [];
  }
}

/** Berapa banyak header tepercaya yang muncul sebagai baris di dalam teks. */
function trustedHeaderScore(text: string): number {
  const found = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = HEADER_LINE.exec(line);
    if (match?.[1] === undefined) continue;
    const name = match[1].toLowerCase();
    if (TRUSTED_HEADERS.includes(name)) found.add(name);
  }
  return found.size;
}

/**
 * Mendekode *encoded-word* RFC 2047 pada nilai header.
 *
 * Tanpa ini, display name non-ASCII tiba dalam bentuk `=?UTF-8?B?...?=` dan seluruh
 * analisis nama menjadi tidak berarti — persis untuk nama seperti "José Álvarez" atau
 * "Müller", yang justru menjadi sasaran perbandingan.
 */
export function decodeEncodedWords(value: string): string {
  return value.replace(ENCODED_WORD, (whole, charset: string, encoding: string, data: string) => {
    try {
      const bytes =
        encoding.toUpperCase() === 'B' ? base64ToBytes(data) : quotedPrintableToBytes(data);
      const label = charset.toLowerCase() === 'utf8' ? 'utf-8' : charset.toLowerCase();
      return new TextDecoder(label).decode(new Uint8Array(bytes));
    } catch {
      // Charset yang tidak dikenal bukan alasan untuk menggagalkan seluruh pembacaan.
      return whole;
    }
  });
}

function base64ToBytes(data: string): number[] {
  const binary = atob(data.replace(/\s+/g, ''));
  const bytes: number[] = [];
  for (let index = 0; index < binary.length; index++) {
    bytes.push(binary.charCodeAt(index));
  }
  return bytes;
}

function quotedPrintableToBytes(data: string): number[] {
  const normalized = data.replace(/_/g, ' ');
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    if (char === '=' && index + 2 < normalized.length) {
      const hex = normalized.slice(index + 1, index + 3);
      const value = Number.parseInt(hex, 16);
      if (!Number.isNaN(value)) {
        bytes.push(value);
        index += 2;
        continue;
      }
    }
    bytes.push(char === undefined ? 0 : char.charCodeAt(0));
  }

  return bytes;
}

/**
 * Mengurai blok header dari teks mentah.
 *
 * Berhenti pada baris kosong pertama, dan hanya memulai dari baris yang terlihat
 * seperti header. Keduanya penting: yang pertama memisahkan header dari badan pesan
 * sesuai RFC 822, yang kedua melewati teks antarmuka di atas blok header.
 */
export function parseHeaderBlock(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);

  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const match = HEADER_LINE.exec(line);
    if (match?.[1] === undefined) continue;
    if (WANTED_HEADERS.includes(match[1].toLowerCase())) {
      start = index;
      break;
    }
  }

  if (start === -1) return {};

  const headers: Record<string, string> = {};
  let currentName: string | null = null;
  let currentValue = '';

  const commit = (): void => {
    if (currentName === null) return;
    // Kemunculan terakhir yang menang. Untuk `Authentication-Results` ini disengaja:
    // hop terakhir adalah yang paling dekat dengan penerima.
    headers[currentName] = decodeEncodedWords(currentValue.trim());
  };

  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? '';

    // Baris kosong mengakhiri bagian header.
    if (line.trim().length === 0) break;

    // Baris lanjutan (folding) dimulai dengan spasi atau tab.
    if (/^[ \t]/.test(line)) {
      currentValue += ` ${line.trim()}`;
      continue;
    }

    const match = HEADER_LINE.exec(line);
    if (match?.[1] === undefined) {
      // Baris yang bukan header dan bukan lanjutan: berhenti, karena header tidak
      // pernah terputus oleh baris bebas.
      break;
    }

    commit();
    currentName = match[1].toLowerCase();
    currentValue = match[2] ?? '';
  }

  commit();
  return headers;
}

/** Mencari blok header di dalam halaman, lalu mengurainya. */
export function scanGmailShowOriginal(doc: DocumentLike): HeaderReport {
  const probes: SelectorProbe[] = [];
  const notes: string[] = [];

  let best: { text: string; score: number; selector: string } | null = null;

  for (const candidate of CONTAINER_SELECTORS) {
    const elements = toArray(safeQuery(doc, candidate.selector));
    let bestHere = 0;

    for (const element of elements) {
      const text = element.textContent ?? '';
      if (text.length < MIN_TEXT_LENGTH) continue;

      const score = trustedHeaderScore(text);
      if (score > bestHere) bestHere = score;

      if (score >= MIN_TRUSTED_SCORE) {
        // Elemen terkecil dengan skor tertinggi adalah blok header yang paling
        // spesifik; elemen pembungkusnya akan punya skor sama tetapi teks jauh lebih
        // panjang.
        if (
          best === null ||
          score > best.score ||
          (score === best.score && text.length < best.text.length)
        ) {
          best = { text, score, selector: candidate.selector };
        }
      }
    }

    probes.push({
      selector: candidate.selector,
      purpose: candidate.purpose,
      matched: elements.length,
      contributed: bestHere >= MIN_TRUSTED_SCORE,
    });

    // Skor tinggi berarti blok header hampir pasti sudah ditemukan; tidak perlu
    // memindai seluruh sisa halaman.
    if (best !== null && best.score >= 4) break;
  }

  if (best === null) {
    notes.push(
      `blok header mentah tidak ditemukan: tidak ada elemen dengan minimal ${MIN_TRUSTED_SCORE} header tepercaya. Halaman ini mungkin bukan halaman "Show original".`,
    );
    return { matched: false, probes, headers: {}, identity: null, notes };
  }

  const headers = parseHeaderBlock(best.text);
  const names = Object.keys(headers);

  if (names.length === 0) {
    notes.push('blok header ditemukan, tetapi tidak ada header yang berhasil diurai');
    return { matched: false, probes, headers, identity: null, notes };
  }

  notes.push(`blok header dibaca dari "${best.selector}" dengan ${names.length} header`);

  const identity = buildIdentity(headers, notes);

  return { matched: true, probes, headers, identity, notes };
}

/**
 * Membentuk bagian identitas dari header yang tersedia.
 *
 * `From` hanya dipakai bila ada. Bila tidak, pemanggil tetap dapat memakai bagian
 * Tier A sebagai sumber display name dan alamat — degradasi yang disengaja, bukan
 * kegagalan.
 */
function buildIdentity(
  headers: Readonly<Record<string, string>>,
  notes: string[],
): HeaderReport['identity'] {
  const identity: {
    displayName?: string | null;
    fromAddress?: string;
    replyTo?: string;
    returnPath?: string;
    authenticationResults?: string;
  } = {};

  const from = headers['from'];
  if (from !== undefined) {
    const address = parseAddress(from);
    if (address.valid) {
      // Yang disimpan adalah **alamatnya saja**, bukan nilai header utuh. Engine memang
      // menerima bentuk `"Nama <alamat>"` dan mengambil bagian alamatnya sendiri, tetapi
      // membiarkannya utuh membuat dua jalur menghasilkan bentuk yang berbeda: Tier A
      // mengisi alamat saja, Tier B mengisi header utuh. Setiap pemanggil yang mencetak
      // `displayName <fromAddress>` lalu menghasilkan `Rise <Rise <no-reply@mngl.in>>`.
      const addressOnly = extractAddressPart(from);
      identity.fromAddress = addressOnly.length > 0 ? addressOnly : from.trim();
      identity.displayName = extractDisplayName(from);
    } else {
      notes.push(`header From tidak dapat diurai: "${from}"`);
    }
  } else {
    notes.push('header From tidak ada di blok header; pakai display name dari Tier A');
  }

  const replyTo = headers['reply-to'];
  if (replyTo !== undefined) identity.replyTo = replyTo.trim();

  const returnPath = headers['return-path'];
  if (returnPath !== undefined) identity.returnPath = returnPath.trim();

  const authResults = headers['authentication-results'];
  if (authResults !== undefined) identity.authenticationResults = authResults.trim();

  const receivedSpf = headers['received-spf'];
  if (receivedSpf !== undefined && authResults === undefined) {
    // `Received-SPF` hanya dipakai bila tidak ada `Authentication-Results`, karena
    // yang terakhir lebih lengkap dan sudah memuat hasil SPF, DKIM, dan DMARC.
    notes.push('hanya Received-SPF yang tersedia; hasil DKIM dan DMARC tidak dapat dibaca');
  }

  return identity;
}

/**
 * Mengambil display name dari nilai header `From`.
 *
 * Nilai berbentuk `Nama <alamat@domain>`, `"Nama" <alamat>`, atau sekadar alamat.
 * Bila hanya ada alamat, hasilnya `null` — sesuai arti `displayName` di engine, yaitu
 * "webmail tidak menampilkan nama".
 */
export function extractDisplayName(from: string): string | null {
  const open = from.lastIndexOf('<');
  const close = from.lastIndexOf('>');

  if (open === -1 || close <= open) return null;

  const raw = from.slice(0, open).trim();
  if (raw.length === 0) return null;

  const unquoted = raw.replace(/^"(.*)"$/s, '$1').trim();
  return unquoted.length > 0 ? unquoted : null;
}
