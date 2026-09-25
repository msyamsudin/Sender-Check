/**
 * Contoh pemakaian engine.
 *
 * Jalankan: pnpm example
 *
 * Yang perlu diperhatikan saat membaca keluaran:
 *
 *  1. Perhatikan state UNASSESSABLE. Ia muncul jauh lebih sering daripada state lain,
 *     dan itu memang tujuannya. Sebagian besar email sah tidak punya hubungan antara
 *     display name dan alamatnya, dan engine menolak menilai ketika tidak ada dasar.
 *  2. Perhatikan bahwa tidak ada satu pun angka skor di keluaran. Yang ada adalah
 *     daftar bukti dengan arah (`polarity`) dan bobot (`strength`).
 *  3. Perhatikan template di bawah. Engine tidak pernah menghasilkan kalimat jadi;
 *     ia menghasilkan `code` + `args`, dan kalimatnya dibentuk di lapisan tampilan.
 *     Itulah yang membuat teks dapat diterjemahkan tanpa menyentuh engine.
 */
import { analyze, type EmailIdentity, type RuleCode, type Verdict } from '@sender-check/core';

// ---------------------------------------------------------------------------
// Lapisan tampilan: menerjemahkan code + args menjadi kalimat.
//
// Setiap cabang menerima `args` yang sudah disediakan rule. Nilai yang tidak dikenal
// jatuh ke `trace`, yaitu bukti mentah yang selalu tersedia.
// ---------------------------------------------------------------------------

type Args = Readonly<Record<string, string | number>>;

const TEMPLATES: Partial<Record<RuleCode, (args: Args) => string>> = {
  REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT: (args) =>
    `"${args['token']}" muncul di domain tujuan balasan "${args['replyTo']}", tetapi tidak di domain pengirim "${args['from']}"`,

  FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME: (args) =>
    `display name mengklaim organisasi "${args['name']}", tetapi alamatnya di layanan surel gratis "${args['domain']}"`,

  ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN: (args) =>
    `display name mengklaim organisasi, tetapi "${args['domain']}" tidak memuat identitas tersebut`,

  CONFUSABLE_MATCH_TO_TOKEN: (args) =>
    `"${args['token']}" memakai aksara yang berbeda dari "${args['target']}", tetapi bentuknya sama`,

  MIXED_SCRIPT_WITHIN_LABEL: (args) =>
    `label "${args['label']}" mencampur aksara: ${args['scripts']}`,

  DIGIT_SUBSTITUTION_MATCH: (args) =>
    `"${args['token']}" meniru "${args['target']}" dengan mengganti karakter`,

  LOOKALIKE_NEAR_MISS: (args) =>
    `domain "${args['label']}" hampir sama dengan "${args['token']}", tetapi tidak persis`,

  DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT: (args) =>
    `"${args['token']}" dipakai sebagai kata tersendiri di domain "${args['label']}", bersama "${args['unexplained']}" yang tidak dijelaskan display name`,

  DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY: (args) =>
    `"${args['token']}" hanya muncul di subdomain "${args['subdomain']}", bukan di domain "${args['domain']}"`,

  DISPLAY_NAME_EMBEDS_OTHER_ADDRESS: (args) =>
    `display name menampilkan "${args['displayed']}", tetapi pengirim sebenarnya ${args['actual']}`,

  DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN: (args) =>
    `display name mengklaim domain "${args['claimed']}", pengirim berasal dari "${args['actual']}"`,

  TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL: (args) =>
    `"${args['token']}" hanya tertanam di dalam "${args['target']}"`,

  REPLY_TO_DOMAIN_MISMATCH: (args) =>
    `balasan diarahkan ke "${args['replyTo']}", berbeda dari domain pengirim "${args['from']}"`,

  REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE: (args) =>
    `balasan diarahkan ke surel gratis "${args['replyTo']}", bukan ke domain pengirim "${args['from']}"`,

  AUTH_DMARC_FAIL: (args) => `DMARC ${args['result']} untuk domain pengirim`,

  PUNYCODE_DOMAIN: (args) => `domain berpunycode; bentuk Unicode-nya "${args['unicode']}"`,

  DISPOSABLE_DOMAIN: (args) => `domain surel sekali pakai "${args['domain']}"`,

  MAILING_LIST_DOMAIN: (args) => `alamat milis "${args['domain']}"`,

  NO_DISPLAY_NAME: () => 'pengirim tidak menampilkan nama apa pun',

  GENERIC_TOKEN_ONLY_DISPLAYNAME: () => 'display name hanya berisi peran layanan tanpa identitas',

  HUMAN_NAME_PATTERN: () => 'display name mengikuti pola nama orang',

  RANDOM_LOCAL_PART: (args) => `local-part "${args['localpart']}" tampak acak`,

  GMAIL_VIA_ESP_HINT: (args) => `webmail menandai pengiriman melalui "${args['esp']}"`,

  AUTH_ALIGNED_PASS: (args) => `DMARC lulus dan selaras dengan "${args['domain']}"`,

  DISPLAY_NAME_MATCHES_LOCALPART_EXACT: (args) =>
    `nama "${args['name']}" tercermin pada local-part "${args['localpart']}"`,

  DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL: (args) =>
    `"${args['token']}" cocok dengan bagian identitas domain "${args['label']}"`,

  DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS: (args) =>
    `display name memuat alamat pengirim itu sendiri: "${args['address']}"`,
};

function describe(code: RuleCode, args: Args, trace: string): string {
  const template = TEMPLATES[code];
  return template === undefined ? trace : template(args);
}

const MARK: Record<string, string> = {
  INCONSISTENT: '⚠',
  UNCLEAR: '·',
  CONSISTENT: '✓',
  UNASSESSABLE: '?',
};

const POLARITY_NOTE: Record<string, string> = {
  supports_inconsistency: 'menentang',
  supports_consistency: 'mendukung',
  context: 'konteks',
  neutral: 'netral',
};

function render(identity: EmailIdentity, verdict: Verdict): void {
  const mark = MARK[verdict.state] ?? '?';
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
      const label = POLARITY_NOTE[item.polarity] ?? item.polarity;
      console.log(`    [${label}/${item.strength}] ${describe(item.code, item.args, item.trace)}`);
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
