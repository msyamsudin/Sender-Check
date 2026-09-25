/**
 * Pencocokan token display name terhadap bagian-bagian alamat.
 *
 * Modul ini sengaja memisahkan **tiga kanal** yang tidak boleh dicampur, karena
 * masing-masing punya tingkat kepercayaan yang berbeda:
 *
 *  - `exactMatches`      — kecocokan literal/fuzzy biasa. Bukti kuat.
 *  - `confusableMatches` — sama setelah skeleton TR39, berbeda sebelum itu. Bukti
 *                          kuat: ini definisi serangan homoglyph.
 *  - `foldMatches`       — sama setelah substitusi digit/huruf. Bukti lemah, kecuali
 *                          bila terjadi pada label registrable (lihat rules).
 *
 * Ketiadaan kecocokan BUKAN bukti ketidakcocokan, dan modul ini tidak pernah
 * menyimpulkan demikian.
 */
import { isFoldEquivalent } from '../normalize/fold.ts';
import { toSkeleton } from '../normalize/confusables.ts';
import { tokenize, type DisplayToken } from '../normalize/index.ts';
import {
  MIN_CONFUSABLE_LENGTH,
  MIN_FOLD_LENGTH,
  bestSimilarity,
  type SimilarityHit,
} from '../similarity/index.ts';
import type { DomainParts } from '../types.ts';
import type { NameAnalysis } from '../name/analyzer.ts';

export type TargetKind =
  | 'localpart'
  | 'localpart-compact'
  | 'registrable-label'
  | 'registrable-compact'
  | 'registrable-component'
  | 'subdomain-label'
  | 'address-compact';

export interface MatchTarget {
  readonly kind: TargetKind;
  readonly value: string;
}

export interface TokenMatch {
  readonly token: string;
  readonly target: string;
  readonly targetKind: TargetKind;
  readonly hit: SimilarityHit;
}

export interface ConfusableMatch {
  readonly token: string;
  readonly target: string;
  readonly targetKind: TargetKind;
  readonly evidence: string;
}

export interface FoldMatch {
  readonly token: string;
  readonly target: string;
  readonly targetKind: TargetKind;
  readonly evidence: string;
}

export interface MatchAnalysis {
  readonly targets: readonly MatchTarget[];
  /**
   * Komponen label registrable, dipecah pada pemisah (`-`, `_`, `.`).
   *
   * Dipakai untuk membedakan pola "brand + kata tambahan" dari sekadar awalan:
   *   `bca-klik.com`  -> komponen ["bca", "klik"] -> "bca" adalah komponen utuh
   *   `risehq.com`    -> komponen ["risehq"]      -> "rise" hanya awalan
   * Pola pertama adalah lookalike; pola kedua adalah penamaan brand yang wajar.
   */
  readonly registrableComponents: readonly string[];
  readonly exactMatches: readonly TokenMatch[];
  readonly confusableMatches: readonly ConfusableMatch[];
  readonly foldMatches: readonly FoldMatch[];
  /** `true` bila minimal satu kanal menghasilkan kecocokan apa pun. */
  readonly hasAnyMatch: boolean;
}

/** Membuang pemisah yang lazim dipakai di alamat surel. */
export function compactAddressPart(value: string): string {
  return value.replace(/[._\-+]/g, '');
}

export function buildTargets(localPart: string, parts: DomainParts): MatchTarget[] {
  const targets: MatchTarget[] = [];
  const seen = new Set<string>();

  const push = (kind: TargetKind, value: string): void => {
    const normalized = value.toLowerCase();
    if (normalized.length === 0) return;
    const key = `${kind}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ kind, value: normalized });
  };

  push('localpart', localPart);
  push('localpart-compact', compactAddressPart(localPart));
  push('registrable-label', parts.registrableLabel);
  push('registrable-compact', compactAddressPart(parts.registrableLabel));

  // Komponen label registrable. Tanpa target ini, `paypa1-secure.com` tidak pernah
  // dibandingkan terhadap token "paypal", karena perbandingan terhadap seluruh label
  // "paypa1-secure" terlalu jauh. Komponen adalah satuan yang benar-benar dibaca
  // manusia ketika memindai domain.
  for (const component of parts.registrableLabel.split(/[.\-_]+/)) {
    const trimmed = component.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.toLowerCase() === parts.registrableLabel.toLowerCase()) continue;
    push('registrable-component', trimmed);
  }

  // Label subdomain saja. Suffix publik (TLD) sengaja dilewati: "com", "co", "id"
  // tidak pernah membawa identitas dan hanya akan menghasilkan kecocokan palsu.
  for (const label of parts.subdomain.split('.')) {
    const trimmed = label.trim();
    if (trimmed.length === 0) continue;
    if (trimmed === parts.registrableLabel) continue;
    push('subdomain-label', trimmed);
  }

  push('address-compact', compactAddressPart(`${localPart}${parts.registrableLabel}`));

  return targets;
}

/**
 * Menghitung seluruh kecocokan untuk token identitas.
 *
 * Hanya token identitas yang diperiksa. Token peran layanan ("support", "tagihan")
 * dan gelar tidak pernah menjadi bukti kecocokan, karena token semacam itu muncul
 * di mana-mana dan tidak membuktikan apa pun.
 */
export function analyzeMatches(
  name: NameAnalysis,
  localPart: string,
  parts: DomainParts,
): MatchAnalysis {
  const targets = buildTargets(localPart, parts);

  const registrableComponents = parts.registrableLabel
    .split(/[.\-_]+/)
    .map((component) => component.trim().toLowerCase())
    .filter((component) => component.length > 0);

  const exactMatches: TokenMatch[] = [];
  const confusableMatches: ConfusableMatch[] = [];
  const foldMatches: FoldMatch[] = [];

  for (const token of name.identityTokens) {
    for (const target of targets) {
      // Kanal 1: kecocokan biasa.
      const hit = bestSimilarity(token.value, target.value);
      if (hit !== null) {
        exactMatches.push({
          token: token.value,
          target: target.value,
          targetKind: target.kind,
          hit,
        });
        continue;
      }

      // Kanal 2: homoglyph. Bedanya harus pada tingkat skeleton, bukan pada tingkat
      // diakritik — perbedaan diakritik sudah dihapus oleh normalisasi dan karena itu
      // tidak boleh sampai ke sini.
      const targetSkeleton = toSkeleton(target.value);
      if (
        token.value !== target.value &&
        token.skeleton === targetSkeleton &&
        token.skeleton.length >= MIN_CONFUSABLE_LENGTH
      ) {
        confusableMatches.push({
          token: token.value,
          target: target.value,
          targetKind: target.kind,
          evidence: `"${token.value}" menyamar sebagai "${target.value}" (aksara berbeda, bentuk sama)`,
        });
        continue;
      }

      // Kanal 3: substitusi digit/huruf.
      if (
        Math.min(token.value.length, target.value.length) >= MIN_FOLD_LENGTH &&
        isFoldEquivalent(token.value, target.value)
      ) {
        foldMatches.push({
          token: token.value,
          target: target.value,
          targetKind: target.kind,
          evidence: `"${token.value}" ≈ "${target.value}" setelah substitusi karakter`,
        });
      }
    }
  }

  return {
    targets,
    registrableComponents,
    exactMatches,
    confusableMatches,
    foldMatches,
    hasAnyMatch:
      exactMatches.length > 0 || confusableMatches.length > 0 || foldMatches.length > 0,
  };
}

/** Token dari local-part, dipakai kanal kandidat local-part manusia. */
export function localPartTokens(localPart: string): string[] {
  return tokenize(localPart);
}

/**
 * Token identitas display name yang menempel pada bagian **registrable** sebuah domain.
 *
 * Hanya kanal kecocokan biasa yang dihitung (persis, awalan, akhiran). Kanal homoglyph
 * dan near-miss sengaja dikecualikan karena keduanya pola lookalike, bukan pola
 * "domain ini memang mengklaim identitas tersebut" — dan keduanya sudah punya rule
 * sendiri dengan severity masing-masing.
 *
 * Dipakai untuk membandingkan domain From dengan domain Reply-To: yang dicari adalah
 * identitas yang diakui oleh satu domain tetapi tidak oleh domain lainnya.
 */
export function identityTokensMatchingDomain(
  name: NameAnalysis,
  parts: DomainParts,
): ReadonlySet<string> {
  const matches = analyzeMatches(name, '', parts);
  const tokens = new Set<string>();

  for (const match of matches.exactMatches) {
    if (
      match.targetKind !== 'registrable-label' &&
      match.targetKind !== 'registrable-compact' &&
      match.targetKind !== 'registrable-component'
    ) {
      continue;
    }
    if (match.hit.method === 'EXACT' || match.hit.method === 'PREFIX_OR_SUFFIX') {
      tokens.add(match.token);
    }
  }

  return tokens;
}

/** `true` bila token cocok pada label registrable, yaitu bagian domain yang dimiliki pengirim. */
export function matchesRegistrableLabel(matches: readonly TokenMatch[]): readonly TokenMatch[] {
  return matches.filter(
    (match) =>
      match.targetKind === 'registrable-label' ||
      match.targetKind === 'registrable-compact' ||
      match.targetKind === 'registrable-component',
  );
}

/** `true` bila token hanya muncul di subdomain, tidak di label registrable. */
export function matchesSubdomainOnly(
  matches: readonly TokenMatch[],
  token: string,
): boolean {
  const forToken = matches.filter((match) => match.token === token);
  if (forToken.length === 0) return false;
  const inSubdomain = forToken.some((match) => match.targetKind === 'subdomain-label');
  const inRegistrable = forToken.some(
    (match) =>
      match.targetKind === 'registrable-label' ||
      match.targetKind === 'registrable-compact' ||
      match.targetKind === 'registrable-component',
  );
  return inSubdomain && !inRegistrable;
}

/** Token yang hanya tercocokkan lewat kanal `CONTAINS` (tertanam di dalam label). */
export function embeddedInRegistrableLabel(
  matches: readonly TokenMatch[],
): readonly TokenMatch[] {
  return matches.filter(
    (match) =>
      match.hit.method === 'CONTAINS' &&
      (match.targetKind === 'registrable-compact' ||
        match.targetKind === 'registrable-label' ||
        match.targetKind === 'localpart-compact' ||
        match.targetKind === 'address-compact'),
  );
}

export type { DisplayToken };
