import { defineConfig } from 'wxt';

/**
 * Konfigurasi ekstensi.
 *
 * Empat keputusan di berkas ini perlu dijelaskan, karena masing-masing adalah pilihan
 * yang lebih sempit daripada yang dimungkinkan WXT.
 *
 * **1. `host_permissions` hanya `https://mail.google.com/*`.** Bukan `<all_urls>`, bukan
 * `tabs`, bukan `webRequest`. Ekstensi ini membaca metadata pengirim dari halaman yang
 * sudah dibuka pengguna, dan **tidak pernah melakukan permintaan jaringan** — batas itu
 * ditegakkan `tests/architecture.test.ts` untuk seluruh berkas di `src`. `docs/DESIGN.md`
 * bagian 10 menetapkan batas itu; permission yang tidak dibutuhkan adalah permission yang
 * tidak boleh diminta, terutama bagi ekstensi yang menyentuh kotak masuk orang.
 *
 * **2. Tidak ada permission `storage` untuk sekarang.** DESIGN merencanakan cache
 * `chrome.storage.session`, tetapi panel ini baru bekerja pada satu thread yang sedang
 * dibuka, bukan pada ratusan baris list view. Meminta permission yang belum dipakai akan
 * membuat tinjauan izin di toko add-on menanyakan sesuatu yang belum dapat dijelaskan.
 * Cache dan LRU-nya menyusul bersama list view.
 *
 * **3. `browser_specific_settings.gecko.id` diisi secara eksplisit.** Firefox memakai id
 * ini untuk mengenali ekstensi yang sama di antara pemuatan ulang; tanpa id yang stabil,
 * izin yang sudah diberikan pengguna tidak dapat dipertahankan, dan `about:debugging`
 * memperlakukannya sebagai ekstensi baru setiap kali dimuat.
 *
 * **4. `srcDir: 'src'` ditulis eksplisit.** WXT menebak direktori sumber, dan tebakan itu
 * berubah ketika struktur proyek berubah. Menuliskannya membuat letak entrypoint tidak
 * bergantung pada tebakan.
 *
 * **5. `data_collection_permissions` menyatakan `none`, dan itu bukan formalitas.** Firefox
 * mewajibkan pernyataan ini untuk ekstensi baru, dan nilainya harus sama dengan perilaku
 * kode: tidak ada network request, tidak ada telemetri, dan tidak ada data yang dikirim ke
 * mana pun. `test/architecture.test.ts` menjaga agar pernyataan ini tidak diam-diam
 * bertentangan dengan permission yang diminta manifesnya.
 */
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'Sender-Check',
    description:
      'Menjelaskan mengapa sebuah nama pengirim sejalan atau tidak sejalan dengan alamatnya. Tanpa network request, tanpa telemetri, tanpa membaca isi pesan.',
    permissions: [],
    host_permissions: ['https://mail.google.com/*'],
    browser_specific_settings: {
      gecko: {
        id: 'sender-check@msyamsudin.invalid',
        strict_min_version: '115.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
