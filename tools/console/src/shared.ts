/**
 * Bagian pelaporan yang dipakai bersama oleh skrip probe dan skrip lengkap.
 *
 * Dipisahkan supaya kedua skrip tetap kecil dan tidak ada dua versi kebenaran tentang
 * cara melaporkan hasil.
 */
import type { SelectorProbe } from '@sender-check/adapters';

export const MARK: Record<string, string> = {
  INCONSISTENT: '⚠',
  UNCLEAR: '·',
  CONSISTENT: '✓',
  UNASSESSABLE: '?',
};

export function shortPolarity(polarity: string): string {
  return polarity.replace('supports_', '');
}

export function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

export function printProbeReport(probes: readonly SelectorProbe[]): void {
  console.log('\nprobe selector (inilah yang tidak dapat saya verifikasi tanpa Gmail-mu):');
  for (const probe of probes) {
    const status = probe.matched > 0 ? `cocok ${probe.matched}` : 'tidak cocok';
    const mark = probe.contributed ? '  <- berkontribusi' : '';
    console.log(`  ${probe.selector.padEnd(26)} ${status.padEnd(14)}${mark}`);
    if (probe.matched === 0) console.log(`      (${probe.purpose})`);
  }
}

export function printNotes(notes: readonly string[]): void {
  if (notes.length === 0) return;
  console.log('\ncatatan:');
  for (const note of notes) console.log(`  - ${note}`);
}

/**
 * Menyalin laporan JSON ke clipboard lewat `copy()` milik konsol devtools.
 *
 * `copy()` bukan API standar, sehingga dibungkus try dan selalu disertai keluaran teks
 * sebagai jalur cadangan — laporan ini yang harus sampai ke pengembang, jadi ia tidak
 * boleh bergantung pada satu API yang mungkin tidak ada.
 */
export function copyToClipboard(payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);

  try {
    const copy = (globalThis as { copy?: (value: string) => void }).copy;
    if (typeof copy === 'function') {
      copy(json);
      console.log('\n>>> Laporan JSON sudah disalin ke clipboard. Kirimkan apa adanya.');
      return;
    }
  } catch {
    // Diabaikan: jalur cadangan di bawah tetap tersedia.
  }

  console.log('\n>>> copy() tidak tersedia. Salin JSON di bawah ini secara manual:');
  console.log(json);
}

export function printHeaderBlock(lines: readonly string[]): void {
  console.log('='.repeat(74));
  for (const line of lines) console.log(line);
  console.log('='.repeat(74));
}
