/**
 * Tipe adapter webmail.
 *
 * Dua keputusan bentuk ada di berkas ini, dan keduanya disengaja.
 *
 * **Pertama, adapter bekerja pada antarmuka DOM yang dipersempit**, bukan pada
 * `Document` dan `Element` bawaan. Dengan begitu logika adapter dapat diuji di Node
 * memakai DOM tiruan, tanpa menambah dependensi seperti jsdom, dan tanpa browser.
 * Yang tidak dapat diuji dengan cara ini adalah apakah **selectornya** benar — dan
 * itulah yang diverifikasi skrip konsol terhadap Gmail sungguhan. Pemisahan itu
 * disengaja: logika diuji di sini, selector diuji di sana.
 *
 * **Kedua, adapter menghasilkan `EmailIdentity`, bukan verdikt.** Ia tidak pernah
 * memanggil `analyze()` dan tidak tahu apa pun tentang rule. Batas ini yang membuat
 * engine tetap bebas DOM.
 */
import type { EmailIdentity } from '@sender-check/core';

/**
 * Bagian `Element` yang benar-benar dipakai adapter.
 *
 * `Element` bawaan browser memenuhi antarmuka ini secara struktural, sehingga
 * pemanggil di browser tidak perlu melakukan apa pun.
 */
export interface ElementLike {
  getAttribute(name: string): string | null;
  closest(selectors: string): ElementLike | null;
  readonly parentElement: ElementLike | null;
  readonly textContent: string | null;
  /**
   * Pencarian di dalam elemen ini saja.
   *
   * Dipakai untuk membaca penanda "via" di dalam baris pesan. Menaiki
   * `parentElement` tidak cukup: penanda itu bersaudara dengan elemen pengirim,
   * bukan leluhurnya, sehingga tidak pernah terjangkau dari arah itu.
   */
  querySelectorAll(selectors: string): ArrayLike<ElementLike>;
}

/** Bagian `Document` yang benar-benar dipakai adapter. */
export interface DocumentLike {
  querySelectorAll(selectors: string): ArrayLike<ElementLike>;
  querySelector(selectors: string): ElementLike | null;
}

/** Alamat halaman, dipersempit supaya adapter dapat diuji tanpa `window`. */
export interface LocationLike {
  readonly href: string;
}

/** Halaman Gmail yang sedang dibuka. */
export type GmailView = 'inbox' | 'show-original' | 'unknown';

/** Satu calon pengirim yang berhasil dibaca dari DOM. */
export interface SenderCandidate {
  /** `null` bila webmail tidak menampilkan nama sama sekali. */
  readonly displayName: string | null;
  readonly fromAddress: string;
  /** Selector yang menghasilkan calon ini, untuk mode diagnostik. */
  readonly sourceSelector: string;
  /** Diisi hanya bila indikator "via" berhasil dibaca. Belum terverifikasi. */
  readonly viaHint?: string;
}

/** Hasil satu selector: berapa elemen yang cocok. Ini inti mode diagnostik. */
export interface SelectorProbe {
  readonly selector: string;
  readonly purpose: string;
  readonly matched: number;
  /** `true` bila selector ini ikut menyumbang pengirim. */
  readonly contributed: boolean;
}

export interface AdapterReport {
  /** `false` berarti tidak ada satu pun selector yang bekerja: extension harus no-op. */
  readonly matched: boolean;
  /** Selector berprioritas tertinggi yang menghasilkan pengirim. */
  readonly selectorUsed: string | null;
  readonly probes: readonly SelectorProbe[];
  readonly senders: readonly SenderCandidate[];
  /**
   * Banner peringatan milik Gmail terdeteksi di halaman ini.
   *
   * Berada di tingkat halaman, bukan tingkat pengirim, sehingga tidak disimpan di
   * `SenderCandidate`. Pemanggil yang menggabungkannya saat membentuk `EmailIdentity`.
   */
  readonly gmailOwnWarning: boolean;
  /**
   * Catatan yang tidak menghentikan analisis, tetapi perlu terlihat di mode
   * diagnostik, mis. "display name dibaca dari teks karena atribut name tidak ada".
   */
  readonly notes: readonly string[];
}

/** Hasil pembacaan halaman "Show original". */
export interface HeaderReport {
  readonly matched: boolean;
  readonly probes: readonly SelectorProbe[];
  /** Header yang berhasil diurai, apa adanya. */
  readonly headers: Readonly<Record<string, string>>;
  /** Identitas lengkap bila header yang diperlukan tersedia. */
  readonly identity: Partial<EmailIdentity> | null;
  readonly notes: readonly string[];
}
