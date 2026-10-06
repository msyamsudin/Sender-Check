/**
 * Menyalin satu teks ke clipboard dari dalam content script.
 *
 * ## Kenapa dua jalur
 *
 * Jalur pertama `navigator.clipboard.writeText`, yang standar hari ini. Ia dapat ditolak
 * browser: halaman harus sedang fokus, pengguna harus baru saja menekan tombol, dan
 * Firefox dapat menolaknya untuk konteks ekstensi tertentu. Penolakan itu bukan kegagalan
 * yang boleh diam-diam — karena itu fungsi ini mengembalikan `boolean`, dan tombol di panel
 * menuliskan apa yang sebenarnya terjadi.
 *
 * Jalur kedua adalah `document.execCommand('copy')`, yang sudah lama usang tetapi masih
 * bekerja pada pendorongan pengguna (user activation) tanpa permission tambahan. Keduanya
 * dijalankan dari dalam listener klik, sehingga keduanya masih berada di dalam gesture yang
 * sama.
 *
 * ## Kenapa bukan permission `clipboardWrite`
 *
 * `docs/DESIGN.md` bagian 10 menetapkan permission minimal, dan menambahkan permission
 * untuk satu tombol salin tidak sebanding — terutama karena keduanya tetap memerlukan
 * gesture pengguna. Bila kelak keduanya ternyata ditolak pada Firefox sungguhan, itulah
 * saatnya permission itu dipertimbangkan, beserta alasannya tertulis di dokumentasi.
 */

/** `true` bila teks benar-benar masuk clipboard; `false` bila kedua jalur ditolak. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Dijatuhkan ke jalur lama di bawah: bukan error yang perlu dilaporkan, karena jalur
    // lama memang disiapkan untuk keadaan persis seperti ini.
  }

  return legacyCopy(text);
}

/** Jalur lama, yang masih berfungsi selama pengguna baru saja menekan tombol. */
function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  // `readonly` diperlukan di iOS supaya keyboard tidak terbuka; posisi dan opasitas
  // menahan elemen keluar dari layar tanpa membuatnya `display:none` — elemen yang tidak
  // dirender tidak dapat diseleksi.
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';

  document.body.append(field);
  field.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    field.remove();
  }

  return copied;
}
