/**
 * Identity-Claim Gate.
 *
 * Ini pengungkit presisi terbesar di seluruh engine, dan juga bagian yang paling
 * mudah salah. Premisnya: mayoritas email sah **memang** tidak punya hubungan antara
 * display name dan alamatnya. "Budi Santoso" dari alamat acak bukan anomali;
 * memeriksanya sebagai anomali adalah cara tercepat membuat extension ini dimatikan.
 *
 * Karena itu engine hanya menilai ketika display name memuat klaim identitas yang
 * dapat diperiksa. Di luar itu hasilnya UNASSESSABLE, dan UI tidak menampilkan apa pun.
 *
 * Gate menerima seluruh `ResolvedIdentity`, bukan hanya bagian From. Alasannya datang
 * dari kasus nyata: penipuan yang paling sulit terlihat justru tidak meninggalkan
 * jejak di domain From sama sekali, dan hanya terbaca dari hubungan antara display
 * name, domain From, dan domain Reply-To.
 */
import type { NameAnalysis } from '../name/analyzer.ts';
import type { ResolvedIdentity } from '../identity.ts';
import type { GateReason, GateResult } from '../types.ts';
import { identityTokensMatchingDomain, type MatchAnalysis } from './matches.ts';

export interface GateInput {
  readonly identity: ResolvedIdentity;
  readonly name: NameAnalysis;
  readonly matches: MatchAnalysis;
}

function fail(reason: GateReason): GateResult {
  return { passed: false, claim: null, reason };
}

/**
 * Identitas yang diakui oleh domain Reply-To tetapi tidak oleh domain From.
 *
 * Ini pola serangan yang sangat spesifik dan sangat kuat: display name mengklaim
 * sebuah identitas, domain yang benar-benar mengirim pesan tidak memuatnya, tetapi
 * domain tujuan balasan memuatnya. Artinya identitas yang terlihat oleh pengguna
 * ditegakkan oleh domain yang tidak mengirim pesan itu.
 *
 * Dikecualikan bila domain From adalah infrastruktur pengiriman yang dikenal,
 * karena `From` di domain ESP dengan `Reply-To` di domain brand adalah konfigurasi
 * yang lazim dan sah.
 */
export function replyToOnlyIdentityTokens(input: GateInput): readonly string[] {
  const { identity, name } = input;
  const fromParts = identity.fromParts;
  const replyParts = identity.replyToParts;

  if (identity.provenance !== 'dom-original') return [];
  if (fromParts === null || replyParts === null) return [];
  if (fromParts.domainClass === 'esp') return [];
  if (replyParts.registrableDomain.toLowerCase() === fromParts.registrableDomain.toLowerCase()) {
    return [];
  }

  const fromTokens = identityTokensMatchingDomain(name, fromParts);
  const replyTokens = identityTokensMatchingDomain(name, replyParts);

  return [...replyTokens].filter((token) => !fromTokens.has(token));
}

/**
 * Catatan tentang `personal_name_on_personal_domain`: alasannya dibedakan dari
 * `no_identity_claim` semata-mata agar mode diagnostik dapat menjelaskan mengapa
 * sebuah email tidak dinilai. Efeknya pada state sama.
 */
export function evaluateGate(input: GateInput): GateResult {
  const { name, matches, identity } = input;
  const fromParts = identity.fromParts;

  if (!name.hasDisplayName) return fail('no_display_name');
  if (fromParts === null) return fail('no_identity_claim');
  if (fromParts.domainClass === 'mailing-list') return fail('mailing_list_domain');

  // Display name tanpa identitas apa pun ("Admin", "Support", "no-reply") tidak
  // dapat dinilai, sekalipun tokennya kebetulan cocok dengan local-part.
  if (name.isGenericOnly || name.identityTokens.length === 0) return fail('no_identity_claim');

  // G1 — display name memuat alamat surel lain.
  if (name.embeddedAddresses.length > 0) {
    return { passed: true, claim: 'embeds_address', reason: 'claim_found' };
  }

  // G2 — display name memuat klaim domain.
  if (name.domainClaims.length > 0) {
    return { passed: true, claim: 'embeds_domain_token', reason: 'claim_found' };
  }

  // G5 — klaim organisasi di atas alamat freemail.
  const isFreeMailClass =
    fromParts.domainClass === 'freemail' || fromParts.domainClass === 'disposable';
  if (isFreeMailClass && name.looksLikeOrganization) {
    return { passed: true, claim: 'organization_claim_on_freemail', reason: 'claim_found' };
  }

  // G3/G4 — token cocok, atau nyaris cocok, dengan bagian alamat From.
  if (matches.confusableMatches.length > 0) {
    return { passed: true, claim: 'token_confusable_to_address', reason: 'claim_found' };
  }
  if (matches.hasAnyMatch) {
    return { passed: true, claim: 'token_matches_address', reason: 'claim_found' };
  }

  // G7 — identitas diakui domain Reply-To, tetapi tidak oleh domain From.
  //
  // Tanpa gerbang ini, `"Rise" <no-reply@mngl.in>` dengan Reply-To
  // `support@riseworks.digital` berhenti sebagai UNASSESSABLE: display name dan
  // domain From memang tidak punya hubungan apa pun, dan seluruh sinyalnya berada di
  // header yang tidak dilihat oleh G1–G5.
  const replyOnlyTokens = replyToOnlyIdentityTokens(input);
  if (replyOnlyTokens.length > 0) {
    return { passed: true, claim: 'reply_to_asserts_identity', reason: 'claim_found' };
  }

  // G6 — klaim organisasi pada domain yang bukan freemail.
  //
  // Klaim organisasi juga merupakan klaim yang dapat diperiksa: yang diuji adalah
  // apakah domain pengirim memuat identitas yang diklaim. Tanpa gerbang ini, rule
  // `ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN` menjadi kode mati.
  //
  // Aman terhadap false positive karena rule yang dipicu berstrength menengah,
  // sehingga paling jauh menghasilkan UNCLEAR dan tidak pernah muncul di list view.
  if (
    name.looksLikeOrganization &&
    (fromParts.domainClass === 'corporate' || fromParts.domainClass === 'subdomain-delegated')
  ) {
    return { passed: true, claim: 'organization_claim_on_domain', reason: 'claim_found' };
  }

  return fail(name.looksLikeHumanName ? 'personal_name_on_personal_domain' : 'no_identity_claim');
}
