import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

/**
 * Konfigurasi ekstensi.
 *
 * Tujuh keputusan di berkas ini perlu dijelaskan, karena masing-masing adalah pilihan
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
 * **3. `browser_specific_settings.gecko.id` diisi secara eksplisit, dalam bentuk GUID.**
 * Firefox memakai id ini untuk mengenali ekstensi yang sama di antara pemuatan ulang; tanpa
 * id yang stabil, izin yang sudah diberikan pengguna tidak dapat dipertahankan, dan
 * `about:debugging` memperlakukannya sebagai ekstensi baru setiap kali dimuat.
 *
 * MDN menerima dua bentuk — string berformat alamat surel, atau GUID berbentuk
 * `{…}` — dan **menyarankan yang pertama** karena lebih mudah dibaca manusia. Yang kedua
 * dipilih di sini karena tidak ada domain yang dapat dipakai: bentuk alamat surel
 * mengharuskan memilih domain, dan proyek ini tidak punya domain sendiri. Konsekuensinya
 * perlu disebut apa adanya: id ini tidak terbaca di `about:addons`, dan itu ditukar dengan
 * tidak bergantung pada domain mana pun.
 *
 * Id ini **tidak dapat diganti setelah add-on terbit di AMO**: id yang berbeda adalah
 * add-on yang berbeda, dan pengguna tidak dapat dimigrasikan secara otomatis. Karena itu
 * ia ditulis di sini sebagai keputusan yang disengaja, bukan sebagai nilai sementara.
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
 *
 * **6. `manifest.version` diambil dari versi rilis repositori, bukan dari `package.json`
 * paket ini.** Angka itu yang dicatat AMO, dan AMO menuntut setiap unggahan lebih tinggi
 * daripada seluruh versi sebelumnya. Sebelum ini, `version` paket ekstensi tetap `0.3.0`
 * sepanjang rilis 0.4.0 sampai 0.6.3 — karena otomatisasi rilis hanya menaikkan
 * `package.json` akar — sehingga add-on pertama akan terbit sebagai 0.3.0 sementara tag,
 * `CHANGELOG.md`, dan catatan rilisnya menyebut 0.6.x. Menurunkannya dari akar membuat
 * penyimpangan itu tidak mungkin terjadi, bukan sekadar tidak terjadi sekarang.
 *
 * Konsekuensinya perlu disebut supaya tidak ada yang "memperbaiki"-nya nanti: field
 * `version` di `apps/extension/package.json` **bukan** versi yang diterbitkan, dan
 * menaikkannya tidak mengubah apa pun.
 *
 * **7. Ikon ditulis lima ukuran, dan tidak memakai nama maupun logo webmail.** Firefox
 * memakai 32 untuk daftar add-on dan 64 pada layar rapat; 16 dipakai tombol toolbar, 48
 * dipakai sebagian tampilan, dan 128 dipakai halaman listing AMO. Manifest ikon tidak
 * diwajibkan Mozilla, tetapi tanpa berkasnya Firefox memakai ikon bawaan yang generik.
 * Bentuknya sengaja abstrak — dua bidang yang dipisahkan satu celah diagonal, yaitu gagasan
 * "dua hal yang seharusnya sejalan" — karena ikon centang akan menyiratkan "sudah aman",
 * dan justru itulah kesimpulan yang alat ini menolak berikan. Berkasnya dihasilkan
 * `tools/gen-icon/generate.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Versi rilis repositori, dibaca dari `package.json` akar workspace.
 *
 * Dibaca sebagai berkas, bukan diimpor sebagai JSON, karena `apps/extension/tsconfig.json`
 * menyetel `types: []` dan berkas ini ikut typecheck — sedangkan akar workspace berada di
 * luar proyek ini, sehingga jalur impornya akan bergantung pada penyetelan yang tidak
 * dimiliki berkas ini.
 */
const releaseVersion = (
  JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as { version: string }
).version;

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,

  /**
   * Nama berkas zip memakai versi manifes, bukan versi nominal paket ini.
   *
   * Berkas inilah yang diunggah ke AMO, dan nama yang menyebut versi berbeda dari versi yang
   * dicatat AMO adalah kebingungan pada langkah yang tidak dapat diulang — sebelum ini namanya
   * tetap `0.3.0` sementara manifesnya 0.6.3. `zip.name` diisi eksplisit karena nilai bawaannya
   * adalah nama paket (`@sender-check/extension`), dan nama itu dipakai apa adanya sebagai nama
   * berkas beserta tanda `@` dan `/`-nya. `{{modeSuffix}}` dipertahankan supaya zip mode
   * pengembangan tidak menimpa zip yang akan dikirim.
   */
  zip: {
    name: 'sender-check',
    artifactTemplate: '{{name}}-{{version}}-{{browser}}{{modeSuffix}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources{{modeSuffix}}.zip',
  },

  manifest: {
    name: 'Sender-Check',
    version: releaseVersion,
    description:
      'Menjelaskan mengapa sebuah nama pengirim sejalan atau tidak sejalan dengan alamatnya. Tanpa network request, tanpa telemetri, tanpa membaca isi pesan.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      64: 'icon/64.png',
      128: 'icon/128.png',
    },
    permissions: [],
    host_permissions: ['https://mail.google.com/*'],
    browser_specific_settings: {
      gecko: {
        id: '{5edc8414-50a9-4b71-957d-77a729f962ff}',
        strict_min_version: '115.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
