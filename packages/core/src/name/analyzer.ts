/**
 * Name Analyzer.
 *
 * Tugas utamanya bukan menghitung skor, melainkan menjawab satu pertanyaan yang
 * menentukan seluruh alur berikutnya: **apakah display name ini membuat klaim
 * identitas yang dapat diperiksa?**
 *
 * Mayoritas email sah tidak membuat klaim seperti itu. "Budi Santoso" dari alamat
 * acak bukanlah anomali, dan memperlakukannya sebagai anomali adalah cara tercepat
 * membuat extension ini dimatikan pengguna.
 */
import {
  ORGANIZATION_CLAIM_TOKENS,
  PERSON_TITLES,
  SERVICE_ROLE_TOKENS,
} from '../data/tokens.ts';
import { findEmbeddedAddresses } from '../domain/address.ts';
import { parsePublicSuffix } from '../domain/psl.ts';
import { displayTokens, normalizeForComparison, type DisplayToken } from '../normalize/index.ts';

/** Klaim domain yang ditemukan di dalam display name, mis. "paypal.com" di "PayPal.com Support". */
export interface DomainClaim {
  readonly text: string;
  readonly registrableDomain: string;
  readonly registrableLabel: string;
}

export interface NameAnalysis {
  readonly raw: string | null;
  /** `false` untuk `null` maupun string kosong. Keduanya berarti tidak ada yang dibandingkan. */
  readonly hasDisplayName: boolean;
  readonly normalized: string;
  readonly tokens: readonly DisplayToken[];
  /** Token yang membawa identitas: bukan peran layanan, bukan gelar, bukan klaim lembaga. */
  readonly identityTokens: readonly DisplayToken[];
  readonly serviceRoleValues: readonly string[];
  readonly personTitleValues: readonly string[];
  readonly organizationClaimValues: readonly string[];
  readonly embeddedAddresses: readonly string[];
  readonly domainClaims: readonly DomainClaim[];
  /** `true` bila tampak seperti nama orang. */
  readonly looksLikeHumanName: boolean;
  /**
   * `true` bila display name mengklaim sebuah organisasi. Ini yang memicu G5 ketika
   * alamatnya berada di freemail.
   */
  readonly looksLikeOrganization: boolean;
  /** `true` bila seluruh token hanyalah peran layanan/gelar tanpa identitas apa pun. */
  readonly isGenericOnly: boolean;
  /** `true` bila seluruh token adalah inisial satu huruf. */
  readonly isInitialsOnly: boolean;
  readonly hasNonAscii: boolean;
}

/**
 * Panjang minimum label registrable agar sebuah pola bertitik dianggap klaim domain.
 *
 * Ambang ini bukan hiasan: tanpa itu, display name seperti "Andi.id" akan dianggap
 * mengklaim domain `andi.id`, dan bila alamatnya `andi@gmail.com` engine akan
 * melaporkan mismatch kuat pada pengirim yang sepenuhnya sah.
 */
const MIN_CLAIMED_DOMAIN_LABEL_LENGTH = 5;

/** Pola kandidat domain bertitik, mis. `paypal.com` atau `bca.co.id`. */
const DOMAIN_CANDIDATE = /[\p{L}\p{N}][\p{L}\p{N}-]*(?:\.[\p{L}\p{N}][\p{L}\p{N}-]*)+/gu;

const EMPTY_ANALYSIS: NameAnalysis = {
  raw: null,
  hasDisplayName: false,
  normalized: '',
  tokens: [],
  identityTokens: [],
  serviceRoleValues: [],
  personTitleValues: [],
  organizationClaimValues: [],
  embeddedAddresses: [],
  domainClaims: [],
  looksLikeHumanName: false,
  looksLikeOrganization: false,
  isGenericOnly: true,
  isInitialsOnly: false,
  hasNonAscii: false,
};

function findDomainClaims(normalized: string): DomainClaim[] {
  const claims: DomainClaim[] = [];
  const seen = new Set<string>();

  for (const match of normalized.matchAll(DOMAIN_CANDIDATE)) {
    const candidate = match[0];
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const parsed = parsePublicSuffix(candidate);
    if (!parsed.matched) continue;
    if (parsed.registrableLabel.length < MIN_CLAIMED_DOMAIN_LABEL_LENGTH) continue;

    claims.push({
      text: candidate,
      registrableDomain: parsed.registrableDomain,
      registrableLabel: parsed.registrableLabel,
    });
  }

  return claims;
}

/** `true` bila display name kosong atau hanya berisi pemisah. */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

export function analyzeName(displayName: string | null): NameAnalysis {
  if (displayName === null || isBlank(displayName)) {
    return { ...EMPTY_ANALYSIS, raw: displayName };
  }

  const raw: string = displayName;
  const normalized = normalizeForComparison(raw);
  const tokens = displayTokens(raw);

  const identityTokens: DisplayToken[] = [];
  const serviceRoleValues: string[] = [];
  const personTitleValues: string[] = [];
  const organizationClaimValues: string[] = [];

  let hasNonAscii = false;

  for (const token of tokens) {
    if (token.hasNonAscii) hasNonAscii = true;

    // Urutan penting. Gelar lebih dulu karena beberapa di antaranya juga termuat di
    // daftar lain, lalu klaim lembaga, lalu peran layanan, dan sisanya identitas.
    if (PERSON_TITLES.has(token.value)) {
      personTitleValues.push(token.value);
      continue;
    }
    if (ORGANIZATION_CLAIM_TOKENS.has(token.value)) {
      organizationClaimValues.push(token.value);
      continue;
    }
    if (SERVICE_ROLE_TOKENS.has(token.value)) {
      serviceRoleValues.push(token.value);
      continue;
    }
    identityTokens.push(token);
  }

  const isInitialsOnly = tokens.length > 0 && tokens.every((token) => token.isInitial);

  // Akronim dan nama brand yang ditulis HURUF BESAR SEMUA bukan nama orang.
  // Tanpa penjaga ini, "BNI" dan "BCA" dilaporkan sebagai "pola nama orang" di panel,
  // dan penjelasan yang jelas salah akan merusak kepercayaan pada seluruh panel.
  const wordTokens = raw.match(/[\p{L}\p{N}]+/gu) ?? [];
  const isAllCapsAcronym =
    wordTokens.length > 0 &&
    wordTokens.every((token) => token.length >= 2 && token === token.toUpperCase() && /[A-Z]/.test(token));

  const isGenericOnly =
    identityTokens.length === 0 && organizationClaimValues.length === 0;

  const looksLikeOrganization =
    organizationClaimValues.length > 0 ||
    (identityTokens.length > 0 && serviceRoleValues.length > 0 && tokens.length >= 2);

  const looksLikeHumanName =
    !looksLikeOrganization &&
    !isInitialsOnly &&
    !isAllCapsAcronym &&
    identityTokens.length > 0 &&
    identityTokens.length <= 5 &&
    identityTokens.every((token) => token.length >= 2 && token.length <= 24);

  return {
    raw,
    hasDisplayName: true,
    normalized,
    tokens,
    identityTokens,
    serviceRoleValues,
    personTitleValues,
    organizationClaimValues,
    embeddedAddresses: findEmbeddedAddresses(raw),
    domainClaims: findDomainClaims(normalized),
    looksLikeHumanName,
    looksLikeOrganization,
    isGenericOnly,
    isInitialsOnly,
    hasNonAscii,
  };
}

/** Representasi yang dapat dibaca manusia untuk keperluan bukti. */
export function describeTokens(tokens: readonly DisplayToken[]): string {
  return tokens.map((token) => `"${token.value}"`).join(', ');
}
