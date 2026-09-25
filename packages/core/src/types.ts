/**
 * Kontrak tipe publik @sender-check/core.
 *
 * Aturan yang mengikat seluruh engine:
 *  - `undefined` pada field Tier B berarti "TIDAK DIKETAHUI", bukan "sama dengan From".
 *  - Engine tidak pernah menghasilkan kalimat jadi; hanya `code` + `args` untuk i18n.
 *  - Engine deterministik: tanpa jam, tanpa RNG, tanpa DOM, tanpa network.
 */

/** Dari mana data identitas berasal. Menentukan sinyal mana yang boleh dinilai. */
export type Provenance = 'dom-inbox' | 'dom-original';

/**
 * Input engine. Engine tidak pernah membaca body email.
 *
 * `provenance` boleh dihilangkan; bila kosong maka diturunkan otomatis:
 * ada field Tier B (`replyTo`/`returnPath`/`authenticationResults`) -> `dom-original`,
 * selain itu -> `dom-inbox`. Turunan ini sengaja dipilih agar data Tier B tidak
 * pernah diam-diam diabaikan.
 */
export interface EmailIdentity {
  readonly fromAddress: string;
  /** `null` = webmail tidak merender display name sama sekali. Berbeda dari string kosong. */
  readonly displayName: string | null;

  readonly provenance?: Provenance;

  /** Tier B. `undefined` = tidak diketahui. */
  readonly replyTo?: string;
  readonly returnPath?: string;
  readonly authenticationResults?: string;

  /** Tier A. Teks "via <esp>" yang dirender Gmail, mis. `"sendgrid.net"`. */
  readonly gmailViaHint?: string;
  /** Tier A. Banner peringatan milik Gmail sendiri terdeteksi pada pesan ini. */
  readonly gmailOwnWarning?: boolean;
}

/** Teks dengan tiga representasi. Original tidak pernah dibuang. */
export interface NormalizedText {
  readonly original: string;
  readonly normalized: string;
  readonly skeleton: string;
}

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/**
 * Kelas domain. Enam kelas, bukan dua: ESP memutus hubungan From/Reply-To secara
 * sah, sehingga tanpa kelas ini `REPLY_TO_DOMAIN_MISMATCH` akan salah menyala.
 */
export type DomainClass =
  | 'freemail'
  | 'disposable'
  | 'esp'
  | 'mailing-list'
  | 'subdomain-delegated'
  | 'corporate'
  | 'unknown';

export interface DomainParts {
  /** Hostname apa adanya dari alamat, lowercase. */
  readonly hostname: string;
  /** Bentuk ASCII (punycode) dari hostname. Sama dengan hostname bila sudah ASCII. */
  readonly asciiHostname: string;
  /** Bentuk Unicode hasil decode RFC 3492. Sama dengan hostname bila bukan punycode. */
  readonly unicodeHostname: string;
  /**
   * Domain yang dapat didaftarkan, mis. `example.co.id`.
   *
   * CATATAN BENTUK: `suffix`, `registrableDomain`, `registrableLabel`, `subdomain`,
   * dan `labels` semuanya dalam bentuk **Unicode**, bukan punycode, karena itulah
   * yang dibandingkan dengan display name dan yang diperiksa aksaranya. Pencocokan
   * PSL sendiri tetap dilakukan pada `asciiHostname`, sesuai aturan PSL.
   */
  readonly registrableDomain: string;
  /** Public suffix menurut PSL, mis. `co.id`. */
  readonly suffix: string;
  /** Bagian sebelum registrable domain, boleh string kosong. */
  readonly subdomain: string;
  /** Label registrable, mis. `example` dari `example.co.id`. */
  readonly registrableLabel: string;
  /** Semua label hostname, kiri-ke-kanan, bentuk Unicode. */
  readonly labels: readonly string[];
  readonly isPunycode: boolean;
  /**
   * `false` bila hostname tidak cocok dengan aturan PSL yang dibundel. Pemanggil
   * tidak boleh memperlakukan `registrableDomain` sebagai fakta bila nilainya `false`.
   */
  readonly pslMatch: boolean;
  /** `true` bila aturan PSL yang menang berasal dari bagian PRIVATE DOMAINS. */
  readonly isPrivateSuffix: boolean;
  readonly pslVersion: string;
  readonly domainClass: DomainClass;
  /** Label yang bercampur aksara secara tidak wajar, dalam bentuk Unicode. */
  readonly mixedScriptLabels: readonly string[];
  /** `true` bila hostname adalah alamat IP literal, bukan nama domain. */
  readonly isIpAddress: boolean;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Arah bukti. Dipisah dari `strength` supaya agregasi tidak pernah jadi penjumlahan bobot. */
export type Polarity =
  | 'supports_consistency'
  | 'supports_inconsistency'
  | 'neutral'
  | 'context';

export type Strength = 'strong' | 'medium' | 'weak';

/**
 * Katalog lengkap kode rule.
 *
 * Ditulis sebagai array runtime, bukan hanya union tipe, supaya kelengkapannya dapat
 * diuji: satu test memastikan **setiap** kode di sini benar-benar dipancarkan oleh
 * minimal satu fixture. Cara ini menangkap dua kesalahan sekaligus — rule yang
 * dideklarasikan tetapi tidak pernah berjalan (kode mati), dan rule yang berjalan
 * tetapi tidak diuji oleh korpus mana pun.
 *
 * `RuleCode` diturunkan dari array ini, sehingga keduanya tidak mungkin menyimpang.
 */
export const ALL_RULE_CODES = [
  // --- Tier A: hanya butuh metadata dari DOM inbox ---
  'DISPLAY_NAME_EMBEDS_OTHER_ADDRESS',
  'DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN',
  'DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS',
  'DISPLAY_NAME_MATCHES_LOCALPART_EXACT',
  'DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL',
  'DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY',
  'DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT',
  'LOOKALIKE_NEAR_MISS',
  'ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN',
  'FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME',
  'CONFUSABLE_MATCH_TO_TOKEN',
  'MIXED_SCRIPT_WITHIN_LABEL',
  'DIGIT_SUBSTITUTION_MATCH',
  'TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL',
  'PUNYCODE_DOMAIN',
  'GENERIC_TOKEN_ONLY_DISPLAYNAME',
  'HUMAN_NAME_PATTERN',
  'RANDOM_LOCAL_PART',
  'NO_DISPLAY_NAME',
  'MAILING_LIST_DOMAIN',
  'GMAIL_VIA_ESP_HINT',
  'GMAIL_OWN_WARNING_PRESENT',
  'DISPOSABLE_DOMAIN',

  // --- Tier B: butuh header dari halaman "Show original" ---
  'REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT',
  'REPLY_TO_DOMAIN_MISMATCH',
  'REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE',
  'RETURN_PATH_NULL_OR_MISMATCH',
  'AUTH_DMARC_FAIL',
  'AUTH_SPF_FAIL',
  'AUTH_DKIM_FAIL',
  'AUTH_ALIGNED_PASS',
] as const;

export type RuleCode = (typeof ALL_RULE_CODES)[number];

export interface Evidence {
  readonly code: RuleCode;
  readonly polarity: Polarity;
  readonly strength: Strength;
  readonly tier: 'A' | 'B';
  /**
   * Argumen untuk template i18n. Bukan kalimat jadi — teks dibentuk di lapisan UI
   * supaya mengubah copy tidak berarti mengubah engine.
   */
  readonly args: Readonly<Record<string, string | number>>;
  /** Bukti mentah yang bisa dibaca manusia, mis. `"rise" ⊂ "risehq"`. */
  readonly trace: string;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** Jenis klaim identitas yang membuat sebuah display name layak dinilai. */
export type ClaimKind =
  | 'embeds_address'
  | 'embeds_domain_token'
  | 'token_matches_address'
  | 'token_confusable_to_address'
  | 'reply_to_asserts_identity'
  | 'organization_claim_on_freemail'
  | 'organization_claim_on_domain';

export type GateReason =
  | 'claim_found'
  | 'no_display_name'
  | 'no_identity_claim'
  | 'mailing_list_domain'
  | 'personal_name_on_personal_domain';

export interface GateResult {
  /** `false` berarti engine sengaja tidak menilai. Pemanggil harus memetakan ke UNASSESSABLE. */
  readonly passed: boolean;
  readonly claim: ClaimKind | null;
  readonly reason: GateReason;
}

// ---------------------------------------------------------------------------
// Hasil
// ---------------------------------------------------------------------------

export type State = 'CONSISTENT' | 'UNCLEAR' | 'INCONSISTENT' | 'UNASSESSABLE';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DecisionTraceRow {
  /** Nomor baris pada DECISION_TABLE, 1-based. */
  readonly row: number;
  readonly condition: string;
  readonly matched: boolean;
}

export interface Verdict {
  readonly state: State;
  readonly confidence: Confidence;
  readonly evidence: readonly Evidence[];
  readonly gate: GateResult;
  /** Jejak evaluasi decision table, untuk mode diagnostik. */
  readonly trace: readonly DecisionTraceRow[];
  readonly algorithmVersion: string;
  readonly pslVersion: string;
}
