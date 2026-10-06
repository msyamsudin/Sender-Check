/**
 * Kontrak pesan antara popup dan content script.
 *
 * Keduanya berjalan di konteks yang terpisah: popup tidak punya akses ke DOM halaman, dan
 * content script tidak tahu apa pun tentang jendela popup. Satu-satunya jembatannya adalah
 * pesan runtime, dan berkas ini memegang bentuk keduanya supaya tidak ada dua tempat yang
 * menulis string yang sama dengan ejaan sedikit berbeda — perbedaan semacam itu tidak
 * pernah menghasilkan error, hanya popup yang diam.
 *
 * Kenapa pesan dan bukan `chrome.storage` atau skrip yang di-inject: `docs/DESIGN.md`
 * bagian 10 menetapkan permission minimal, dan keduanya memerlukan permission atau
 * injeksi tambahan. `runtime.onMessage` tidak memerlukan apa pun selain content script
 * yang memang sudah ada.
 *
 * Berkas ini bebas DOM dan bebas `browser.*`, sehingga berkas yang sama dapat diuji di Node.
 */

/** Meminta isi panel terkini dari content script. Balasannya `PanelModel | null`. */
export const SNAPSHOT_REQUEST = 'sender-check:snapshot';

/**
 * Meminta content script membuka halaman "Show original" (Tier B) lewat menu Gmail.
 *
 * Ekstensi **tidak** mengambil halaman itu sendiri — keputusan D1 di `docs/DESIGN.md`.
 * Yang dilakukan content script hanyalah mendorong menu yang memang sudah disediakan Gmail,
 * persis seperti yang dilakukan pengguna; kalau menu itu tidak dapat ditemukan, ia hanya
 * melaporkan kegagalan dan pengguna membukanya sendiri.
 */
export const OPEN_HEADER_REQUEST = 'sender-check:open-header';

/**
 * Hasil percobaan membuka halaman header.
 *
 * Tiga keadaan dipisahkan karena ketiganya membutuhkan jawaban yang berbeda dari popup —
 * dan menyatukannya menjadi satu `boolean` akan membuat popup menebak.
 */
export interface OpenHeaderResult {
  /** `true` bila item menu ditemukan dan diklik, sehingga Gmail membuka halaman header. */
  readonly opened: boolean;
  /**
   * `true` bila menu pesan berhasil dibuka walaupun itemnya tidak dikenali.
   *
   * Keadaan ini yang paling sering terjadi pada bahasa selain Indonesia dan Inggris:
   * menunya terbuka, hanya namanya yang tidak cocok. Bagi pengguna hasilnya sama —
   * pilihannya sudah terlihat di layar.
   */
  readonly menuOpened: boolean;
}
