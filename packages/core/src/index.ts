/**
 * @sender-check/core — engine analisis murni.
 *
 * Tanpa DOM, tanpa `chrome.*`, tanpa network, tanpa AI/ML, tanpa database brand
 * runtime. Dapat dijalankan di browser maupun di Node, dan itulah sebabnya corpus
 * test dapat berjalan tanpa browser sama sekali.
 */
export type * from './types.ts';
export { ALL_RULE_CODES } from './types.ts';

export { ALGORITHM_VERSION, DATA_UPDATED_AT } from './version.ts';

export { analyze } from './analyze.ts';
export { isEspDelivery, resolveIdentity } from './identity.ts';
export type { ResolvedIdentity } from './identity.ts';

// Domain
export { analyzeDomain, isDisposable, isEsp, isFreemail, isMailingList } from './domain/analyzer.ts';
export {
  extractAddressPart,
  findEmbeddedAddresses,
  localPartCandidates,
  parseAddress,
} from './domain/address.ts';
export type { ParsedAddress } from './domain/address.ts';
export { isIpLiteral, parsePublicSuffix, PSL_VERSION } from './domain/psl.ts';
export type { PublicSuffixResult } from './domain/psl.ts';

// Nama
export { analyzeName, describeTokens } from './name/analyzer.ts';
export type { DomainClaim, NameAnalysis } from './name/analyzer.ts';

// Normalisasi
export { toSkeleton, isConfusableOnlyDifference, mapConfusables } from './normalize/confusables.ts';
export { digitFoldVariants, foldVariants, isFoldEquivalent, letterFold } from './normalize/fold.ts';
export {
  displayTokens,
  isPlainAscii,
  normalizeForComparison,
  normalizeText,
  stripDiacritics,
  tokenize,
} from './normalize/index.ts';
export type { DisplayToken } from './normalize/index.ts';
export { decodePunycodeLabel, hasPunycodeLabel, punycodeToUnicode } from './normalize/punycode.ts';
export { analyzeScripts, CONFUSABLE_WITH_LATIN } from './normalize/scripts.ts';
export type { ScriptAnalysis } from './normalize/scripts.ts';

// Similarity
export {
  bestSimilarity,
  damerauLevenshtein,
  editSimilarity,
  isMeaningfullySimilar,
  isPrefixOrSuffixMatch,
  jaroWinkler,
  longestCommonSubstringLength,
  MIN_CONFUSABLE_LENGTH,
  MIN_EXACT_TOKEN_LENGTH,
  MIN_FOLD_LENGTH,
  MIN_FUZZY_LENGTH,
  MIN_TYPO_LENGTH,
} from './similarity/index.ts';
export type { SimilarityHit, SimilarityMethod } from './similarity/index.ts';

// Evidence & klasifikasi
export { classify, DECISION_TABLE, summarize } from './classification/decision-table.ts';
export type { Classification, DecisionRow, EvidenceSummary } from './classification/decision-table.ts';
export {
  isFailure as isAuthFailure,
  isPass as isAuthPass,
  parseAuthenticationResults,
} from './evidence/auth.ts';
export type { AuthenticationResults } from './evidence/auth.ts';
export { evaluateGate } from './evidence/gate.ts';
export type { GateInput } from './evidence/gate.ts';
export { analyzeMatches, buildTargets, compactAddressPart } from './evidence/matches.ts';
export type { ConfusableMatch, FoldMatch, MatchAnalysis, MatchTarget, TargetKind, TokenMatch } from './evidence/matches.ts';
export { buildEvidence, looksRandomLocalPart } from './evidence/rules.ts';

// Data (dipakai test dan UI untuk menampilkan konteks)
export { FREEMAIL_DOMAINS } from './data/freemail.ts';
export { DISPOSABLE_DOMAINS } from './data/disposable.ts';
export { ESP_DOMAINS } from './data/esp.ts';
export { MAILING_LIST_DOMAINS } from './data/mailing-list.ts';
export { GENERIC_TOKENS, ORGANIZATION_CLAIM_TOKENS, ORGANIZATION_MARKERS, PERSON_TITLES, SERVICE_ROLE_TOKENS } from './data/tokens.ts';
export { PSL_COUNTS } from './data/psl.generated.ts';
export { CONFUSABLES_COUNT, CONFUSABLES_VERSION } from './data/confusables.generated.ts';
