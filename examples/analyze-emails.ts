/**
 * Contoh pemakaian engine.
 *
 * Jalankan: `pnpm example`
 *
 * Yang perlu diperhatikan saat membaca keluaran:
 *
 *  1. Perhatikan state UNASSESSABLE. Ia muncul jauh lebih sering daripada state lain,
 *     dan itu memang tujuannya. Sebagian besar email sah tidak punya hubungan antara
 *     display name dan alamatnya, dan engine menolak menilai ketika tidak ada dasar.
 *  2. Perhatikan bahwa tidak ada satu pun angka skor di keluaran. Yang ada adalah
 *     daftar bukti dengan arah (`polarity`) dan bobot (`strength`).
 *  3. Perhatikan bahwa kalimatnya tidak dibentuk di berkas ini. Engine menghasilkan
 *     `code` + `args`, dan terjemahannya ada di `@sender-check/presentation` — satu
 *     tempat untuk skrip konsol, contoh ini, dan panel ekstensi. Itulah yang membuat
 *     teks dapat diubah tanpa menyentuh engine.
 */
import { analyze, type EmailIdentity, type Verdict } from '@sender-check/core';
import { MARK, POLARITY_LABEL, describeRule, shortPolarity } from '@sender-check/presentation';

/**
 * Kalimat bukti **tidak lagi disusun di berkas ini**.
 *
 * Sebelumnya berkas ini memuat salinan template sendiri, dan salinan itu sudah menyimpang
 * dari yang dipakai skrip konsol: untuk `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`, yang
 * satu menulis "muncul di" dan yang lain "ada di". Contoh pemakaian yang memakai kalimat
 * berbeda dari produknya bukan contoh yang jujur, jadi keduanya kini berbagi satu sumber.
 */

function render(identity: EmailIdentity, verdict: Verdict): void {
  const mark = MARK[verdict.state];
  const replyTo = identity.replyTo === undefined ? '' : `  reply-to: ${identity.replyTo}`;

  console.log(`${mark} ${verdict.state} (${verdict.confidence})`);
  console.log(`  ${identity.displayName ?? '(tanpa nama)'} <${identity.fromAddress}>${replyTo}`);
  console.log(`  dinilai: ${verdict.gate.passed ? `ya (${verdict.gate.claim})` : `tidak (${verdict.gate.reason})`}`);
  console.log(`  psl: ${verdict.pslVersion}   algoritma: ${verdict.algorithmVersion}`);

  if (verdict.evidence.length === 0) {
    console.log('  bukti: —');
  } else {
    console.log('  bukti:');
    for (const item of verdict.evidence) {
      const label = POLARITY_LABEL[shortPolarity(item.polarity)] ?? item.polarity;
      console.log(`    [${label}/${item.strength}] ${describeRule(item.code, item.args, item.trace)}`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Kumpulan contoh
// ---------------------------------------------------------------------------

interface Sample {
  readonly note: string;
  readonly identity: EmailIdentity;
}

const SAMPLES: readonly Sample[] = [
  {
    note: 'Kasus nyata yang dilaporkan: identitas hanya diakui domain tujuan balasan.',
    identity: {
      displayName: 'Rise',
      fromAddress: 'no-reply@mngl.in',
      replyTo: 'support@riseworks.digital',
      returnPath: 'no-reply@mngl.in',
    },
  },
  {
    note: 'Kasus yang sama tanpa header Show original. Tidak ada dasar untuk menilai.',
    identity: { displayName: 'Rise', fromAddress: 'no-reply@mngl.in' },
  },
  {
    note: 'Nama manusia pada alamat acak. Normal, dan sengaja tidak dinilai.',
    identity: { displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' },
  },
  {
    note: 'Nama yang cocok dengan domain pengirim.',
    identity: { displayName: 'Rise', fromAddress: 'support@rise.com' },
  },
  {
    note: 'Klaim organisasi di atas surel gratis.',
    identity: { displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' },
  },
  {
    note: 'Domain homoglyph: dua huruf o adalah Cyrillic, bukan Latin.',
    identity: { displayName: 'Google', fromAddress: 'support@gооgle.com' },
  },
  {
    note: 'Nama brand hanya muncul di subdomain, bukan di domain yang dimiliki pengirim.',
    identity: { displayName: 'PayPal', fromAddress: 'support@paypal.com.secure-login.xyz' },
  },
  {
    note: 'Domain typosquat: brand ditambah satu huruf.',
    identity: { displayName: 'BCA', fromAddress: 'cs@bcaa.co.id' },
  },
  {
    note: 'Alamat surel sebagai display name. Sepenuhnya lazim.',
    identity: { displayName: 'john@example.com', fromAddress: 'john@example.com' },
  },
  {
    note: 'Tidak ada display name sama sekali.',
    identity: { displayName: null, fromAddress: 'no-reply@shopify.com' },
  },
  {
    note: 'Pola ESP yang sah: From di domain brand, Return-Path di infrastruktur pengiriman.',
    identity: {
      displayName: 'Rise',
      fromAddress: 'no-reply@riseworks.digital',
      replyTo: 'support@riseworks.digital',
      returnPath: 'bounce@sendgrid.net',
    },
  },
];

console.log('='.repeat(78));
console.log('Contoh pemakaian @sender-check/core');
console.log('='.repeat(78));
console.log('');

for (const sample of SAMPLES) {
  console.log(`— ${sample.note}`);
  render(sample.identity, analyze(sample.identity));
}

console.log('='.repeat(78));
console.log('Ringkasan yang perlu diingat:');
console.log('  · UNASSESSABLE adalah hasil yang sah dan sering, bukan kegagalan.');
console.log('  · INCONSISTENT berarti nama dan alamat tidak sejalan, bukan bahwa email jahat.');
console.log('  · Authentication PASS membuktikan domain, bukan display name.');
console.log('='.repeat(78));
