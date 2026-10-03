/**
 * Kalimat untuk setiap kode bukti.
 *
 * Engine tidak pernah menghasilkan kalimat jadi; ia menghasilkan `code` + `args`, supaya
 * teks dapat diubah tanpa menyentuh engine. Berkas ini adalah **satu-satunya** tempat kode
 * itu diterjemahkan, dan itu penting bukan karena kerapian: sebelum berkas ini ada,
 * terjemahannya hidup di dua tempat sekaligus — `tools/console/src/main.ts` dan
 * `examples/analyze-emails.ts` — dan keduanya sudah menyimpang. Untuk
 * `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`, yang satu menulis "ada di domain tujuan
 * balasan" sementara yang lain menulis "muncul di"; README dan `docs/USAGE.md` mengutip
 * versi yang kedua, sedangkan test skrip konsol menuntut versi yang pertama. Dua salinan
 * teks yang sama adalah dua versi kebenaran, dan keduanya tidak dapat benar bersamaan.
 *
 * ## Wording mana yang dipilih
 *
 * Yang dipakai di sini adalah versi `examples/analyze-emails.ts`, karena itulah yang sudah
 * dikutip dokumentasi dan karena ia lebih informatif pada beberapa kode — misalnya
 * `DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS` menyertakan alamatnya, bukan hanya menyatakan
 * bahwa alamat itu ada. Kode yang hanya ada di skrip konsol (`GMAIL_OWN_WARNING_PRESENT`)
 * ikut dibawa apa adanya, dan tiga kode yang sebelumnya tidak punya kalimat sama sekali
 * kini punya.
 *
 * ## Kode yang tidak punya template
 *
 * Jatuh ke `trace`, yaitu bukti mentah yang selalu tersedia. Jalur itu ada untuk keamanan
 * (versi engine yang lebih baru daripada lapisan ini tidak boleh membuat panel kosong),
 * tetapi **tidak boleh** dipakai oleh kode yang ada di katalog: `trace` ditulis untuk
 * pengembang, bukan untuk pengguna. Test `sentences.test.ts` menuntut kelengkapan itu, dan
 * `tools/corpus/tests/presentation.test.ts` merender setiap kode dengan `args` yang
 * benar-benar dipancarkan fixture, sehingga template yang menyebut nama argumen yang salah
 * tidak lolos sebagai "undefined".
 *
 * ## i18n
 *
 * Belum ada, dan itu disengaja: menerjemahkan kalimat untuk bahasa yang belum ada
 * penggunanya akan menghasilkan teks yang tidak pernah dibaca siapa pun. Yang sudah
 * dijamin adalah syaratnya — engine tidak memuat satu pun kalimat jadi, sehingga saat
 * lapisan ini perlu dua bahasa, `RULE_TEMPLATES` menjadi peta per-locale dan hanya berkas
 * ini yang berubah.
 */
import type { RuleCode } from '@sender-check/core';

/** Argumen template. Bentuknya sengaja longgar, mengikuti `Evidence.args` milik engine. */
export type Args = Readonly<Record<string, string | number>>;

export type SentenceTemplate = (args: Args) => string;

/**
 * Template per kode rule, diurutkan mengikuti `ALL_RULE_CODES` supaya kelengkapannya dapat
 * diaudit baris per baris terhadap katalog.
 */
export const RULE_TEMPLATES: Partial<Record<RuleCode, SentenceTemplate>> = {
  // --- Tier A ---
  DISPLAY_NAME_EMBEDS_OTHER_ADDRESS: (a) =>
    `display name menampilkan "${a['displayed']}", tetapi pengirim sebenarnya ${a['actual']}`,
  DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN: (a) =>
    `display name mengklaim domain "${a['claimed']}", pengirim berasal dari "${a['actual']}"`,
  DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS: (a) =>
    `display name memuat alamat pengirim itu sendiri: "${a['address']}"`,
  DISPLAY_NAME_MATCHES_LOCALPART_EXACT: (a) =>
    `nama "${a['name']}" tercermin pada local-part "${a['localpart']}"`,
  DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL: (a) =>
    `"${a['token']}" cocok dengan bagian identitas domain "${a['label']}"`,
  DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY: (a) =>
    `"${a['token']}" hanya muncul di subdomain "${a['subdomain']}", bukan di domain "${a['domain']}"`,
  DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT: (a) =>
    `"${a['token']}" dipakai sebagai kata tersendiri di domain "${a['label']}", bersama "${a['unexplained']}" yang tidak dijelaskan display name`,
  LOOKALIKE_NEAR_MISS: (a) =>
    `domain "${a['label']}" hampir sama dengan "${a['token']}", tetapi tidak persis`,
  ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN: (a) =>
    `display name mengklaim organisasi, tetapi "${a['domain']}" tidak memuat identitas tersebut`,
  FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME: (a) =>
    `display name mengklaim organisasi "${a['name']}", tetapi alamatnya di layanan surel gratis "${a['domain']}"`,
  CONFUSABLE_MATCH_TO_TOKEN: (a) =>
    `"${a['token']}" memakai aksara yang berbeda dari "${a['target']}", tetapi bentuknya sama`,
  MIXED_SCRIPT_WITHIN_LABEL: (a) => `label "${a['label']}" mencampur aksara: ${a['scripts']}`,
  DIGIT_SUBSTITUTION_MATCH: (a) =>
    `"${a['token']}" meniru "${a['target']}" dengan mengganti karakter`,
  TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL: (a) =>
    `"${a['token']}" hanya tertanam di dalam "${a['target']}"`,
  PUNYCODE_DOMAIN: (a) => `domain berpunycode; bentuk Unicode-nya "${a['unicode']}"`,
  GENERIC_TOKEN_ONLY_DISPLAYNAME: () =>
    'display name hanya berisi peran layanan tanpa identitas',
  HUMAN_NAME_PATTERN: () => 'display name mengikuti pola nama orang',
  RANDOM_LOCAL_PART: (a) => `local-part "${a['localpart']}" tampak acak`,
  NO_DISPLAY_NAME: () => 'pengirim tidak menampilkan nama apa pun',
  MAILING_LIST_DOMAIN: (a) => `alamat milis "${a['domain']}"`,
  GMAIL_VIA_ESP_HINT: (a) => `webmail menandai pengiriman melalui "${a['esp']}"`,
  GMAIL_OWN_WARNING_PRESENT: () => 'webmail sendiri menampilkan peringatan pada pesan ini',
  DISPOSABLE_DOMAIN: (a) => `domain surel sekali pakai "${a['domain']}"`,

  // --- Tier B ---
  REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT: (a) =>
    `"${a['token']}" muncul di domain tujuan balasan "${a['replyTo']}", tetapi tidak di domain pengirim "${a['from']}"`,
  REPLY_TO_DOMAIN_MISMATCH: (a) =>
    `balasan diarahkan ke "${a['replyTo']}", berbeda dari domain pengirim "${a['from']}"`,
  REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE: (a) =>
    `balasan diarahkan ke surel gratis "${a['replyTo']}", bukan ke domain pengirim "${a['from']}"`,
  /**
   * Dua keadaan berbeda, dan membedakannya penting: `returnPath` kosong berarti headernya
   * memang tidak ada, bukan bahwa domainnya bernama kosong. Kalimat yang menampilkan `""`
   * akan membuat pengguna mengira ada domain tak bernama.
   */
  RETURN_PATH_NULL_OR_MISMATCH: (a) =>
    a['returnPath'] === ''
      ? `header "dikirim oleh" tidak ada pada pesan ini, sedangkan domain pengirim "${a['from']}"`
      : `"dikirim oleh" menunjuk ke "${a['returnPath']}", berbeda dari domain pengirim "${a['from']}"`,
  AUTH_DMARC_FAIL: (a) => `DMARC ${a['result']} untuk domain pengirim`,
  AUTH_SPF_FAIL: (a) => `SPF ${a['result']} untuk domain pengirim`,
  AUTH_DKIM_FAIL: (a) => `DKIM ${a['result']} untuk domain pengirim`,
  AUTH_ALIGNED_PASS: (a) => `DMARC lulus dan selaras dengan "${a['domain']}"`,
};

/**
 * Kalimat untuk satu kode bukti.
 *
 * `trace` diteruskan pemanggil karena hanya engine yang memilikinya, dan ia dipakai sebagai
 * jalur cadangan — bukan sebagai hasil normal.
 */
export function describeRule(code: RuleCode, args: Args, trace: string): string {
  const template = RULE_TEMPLATES[code];
  return template === undefined ? trace : template(args);
}
