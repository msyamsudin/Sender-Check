/**
 * Resolusi input mentah menjadi bentuk yang siap dianalisis.
 *
 * Dua keputusan penting di sini:
 *
 *  1. `provenance` diturunkan otomatis bila tidak diberikan: adanya salah satu field
 *     Tier B berarti `dom-original`. Turunan ini sengaja dipilih agar data Tier B
 *     tidak pernah diam-diam diabaikan — kesalahan yang jauh lebih berbahaya daripada
 *     salah menandai provenance.
 *  2. Semua bagian alamat (From, Reply-To, Return-Path) dianalisis sekali di sini,
 *     sehingga rule tidak perlu mengurai ulang dan tidak mungkin tidak konsisten.
 */
import { analyzeDomain } from './domain/analyzer.ts';
import { parseAddress } from './domain/address.ts';
import { parseAuthenticationResults, type AuthenticationResults } from './evidence/auth.ts';
import type { DomainParts, EmailIdentity, Provenance } from './types.ts';

export interface ResolvedIdentity {
  readonly provenance: Provenance;
  readonly displayName: string | null;
  readonly fromAddress: string;
  readonly fromParts: DomainParts | null;
  readonly localPart: string;
  readonly replyTo: string | undefined;
  readonly replyToParts: DomainParts | null;
  readonly returnPath: string | undefined;
  readonly returnPathParts: DomainParts | null;
  readonly authenticationResults: string | undefined;
  readonly auth: AuthenticationResults | null;
  readonly gmailViaHint: string | undefined;
  readonly gmailOwnWarning: boolean;
  /**
   * Domain infrastruktur pengiriman yang dapat dibuktikan dari input.
   * Dipakai untuk menekan mismatch Return-Path/Reply-To yang sah.
   */
  readonly viaEspDomains: readonly string[];
}

function domainOf(address: string | undefined): DomainParts | null {
  if (address === undefined || address.trim().length === 0) return null;
  const parsed = parseAddress(address);
  if (!parsed.valid) return null;
  return analyzeDomain(parsed.hostname);
}

function hasTierBFields(input: EmailIdentity): boolean {
  const hasReplyTo = input.replyTo !== undefined && input.replyTo.trim().length > 0;
  const hasReturnPath = input.returnPath !== undefined && input.returnPath.trim().length > 0;
  const hasAuth =
    input.authenticationResults !== undefined && input.authenticationResults.trim().length > 0;
  return hasReplyTo || hasReturnPath || hasAuth;
}

export function resolveIdentity(input: EmailIdentity): ResolvedIdentity {
  const provenance: Provenance = input.provenance ?? (hasTierBFields(input) ? 'dom-original' : 'dom-inbox');

  const fromParsed = parseAddress(input.fromAddress);
  const fromParts = fromParsed.valid ? analyzeDomain(fromParsed.hostname) : null;

  const replyToParts = domainOf(input.replyTo);
  const returnPathParts = domainOf(input.returnPath);

  const gmailViaHint =
    input.gmailViaHint !== undefined && input.gmailViaHint.trim().length > 0
      ? input.gmailViaHint.trim().toLowerCase()
      : undefined;

  const viaEspDomains: string[] = [];
  if (gmailViaHint !== undefined) viaEspDomains.push(gmailViaHint);
  if (returnPathParts !== null && returnPathParts.domainClass === 'esp') {
    viaEspDomains.push(returnPathParts.registrableDomain);
  }
  if (replyToParts !== null && replyToParts.domainClass === 'esp') {
    viaEspDomains.push(replyToParts.registrableDomain);
  }

  return {
    provenance,
    displayName: input.displayName,
    fromAddress: input.fromAddress,
    fromParts,
    localPart: fromParsed.localPart,
    replyTo: input.replyTo,
    replyToParts,
    returnPath: input.returnPath,
    returnPathParts,
    authenticationResults: input.authenticationResults,
    auth: parseAuthenticationResults(input.authenticationResults),
    gmailViaHint,
    gmailOwnWarning: input.gmailOwnWarning === true,
    viaEspDomains: [...new Set(viaEspDomains)],
  };
}

/** `true` bila ada bukti pengiriman lewat infrastruktur pihak ketiga. */
export function isEspDelivery(identity: ResolvedIdentity): boolean {
  if (identity.viaEspDomains.length > 0) return true;
  if (identity.fromParts !== null && identity.fromParts.domainClass === 'esp') return true;
  return false;
}
