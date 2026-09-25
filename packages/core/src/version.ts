/**
 * Versi algoritma. WAJIB dinaikkan setiap kali threshold, rule, atau decision table
 * berubah, karena versi ini menjadi bagian dari cache key di extension. Tanpa itu,
 * hasil analisis lama akan terus dipakai setelah algoritma diperbarui.
 */
export const ALGORITHM_VERSION = '0.2.0';

/** Tanggal rilis tabel data non-generated (freemail/ESP/dll) terakhir diperbarui. */
export const DATA_UPDATED_AT = '2026-01-01';
