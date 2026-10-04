/**
 * Versi algoritma. WAJIB berubah setiap kali threshold, rule, atau decision table berubah,
 * karena versi ini menjadi bagian dari cache key di extension. Tanpa itu, hasil analisis lama
 * akan terus dipakai setelah algoritma diperbarui.
 *
 * **Nilainya tidak lagi diisi tangan.** `tools/release/src/prepare.ts` menaikkannya satu patch
 * saat rilis bila ada berkas di `packages/core/src` yang berubah — aturan yang lebih luas
 * daripada definisi di atas, dan sengaja begitu: menaikkannya terlalu sering hanya membuang
 * cache verdikt pengguna, sedangkan melewatkannya membuat hasil analisis lama terus dipakai.
 *
 * Riwayatnya tidak disimpan di sini: ia dicatat di **pesan tag rilis** (baris
 * `ALGORITHM_VERSION: <nilai>`, diperiksa CI) dan diindeks satu baris per rilis di
 * `CHANGELOG.md`. Untuk 0.1.0–0.3.0, yang dirilis sebelum tag dan rilis otomatis dipakai,
 * angkanya tidak dapat direkonstruksi — lihat `docs/CHANGELOG-0.x.md`.
 */
export const ALGORITHM_VERSION = '0.2.0';

/**
 * Tanggal rilis tabel data non-generated (freemail/ESP/dll) terakhir diperbarui.
 *
 * Seperti `ALGORITHM_VERSION`, nilainya diperbarui otomatis saat rilis bila ada berkas di
 * `packages/core/src/data/` yang berubah.
 */
export const DATA_UPDATED_AT = '2026-01-01';
