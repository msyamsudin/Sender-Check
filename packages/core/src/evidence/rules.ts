/**
 * Evidence / Rule Engine.
 *
 * Setiap rule menghasilkan bukti bertipe eksplisit — `polarity` dan `strength` —
 * dan TIDAK menghasilkan angka. Tidak ada `phishingScore` di mana pun, dan itu
 * bukan sekadar gaya: begitu ada satu angka, seluruh keputusan akan mulai
 * bergantung padanya dan penjelasan yang dapat diverifikasi hilang.
 *
 * Konvensi strength:
 *  - `strong`  : bukti yang berdiri sendiri. Cukup untuk menentukan state.
 *  - `medium`  : bermakna, tetapi tidak boleh sendirian menyimpulkan ketidakcocokan.
 *  - `weak`    : mudah salah. Hanya menaikkan state ke UNCLEAR.
 *
 * Rule dengan polarity `context`/`neutral` tidak pernah memengaruhi state; ia ada
 * untuk menjelaskan situasi di panel dan di mode diagnostik.
 */
import { SERVICE_ROLE_TOKENS } from '../data/tokens.ts';
import { analyzeDomain } from '../domain/analyzer.ts';
import { localPartCandidates, parseAddress } from '../domain/address.ts';
import { parsePublicSuffix } from '../domain/psl.ts';
import { isEspDelivery, type ResolvedIdentity } from '../identity.ts';
import { replyToOnlyIdentityTokens } from './gate.ts';
import { compactAddressPart, matchesRegistrableLabel, type MatchAnalysis } from './matches.ts';
import type { NameAnalysis } from '../name/analyzer.ts';
import { analyzeScripts } from '../normalize/scripts.ts';
import { isFoldEquivalent } from '../normalize/fold.ts';
import { MIN_EXACT_TOKEN_LENGTH, MIN_FOLD_LENGTH } from '../similarity/index.ts';
import type { Evidence, Polarity, RuleCode, Strength } from '../types.ts';
import { isFailure, isPass } from './auth.ts';

function make(
  code: RuleCode,
  polarity: Polarity,
  strength: Strength,
  tier: 'A' | 'B',
  args: Record<string, string | number>,
  trace: string,
): Evidence {
  return { code, polarity, strength, tier, args, trace };
}

/**
 * Heuristik local-part acak. Sengaja konservatif dan hanya berpolarity `context`:
 * local-part acak sangat sering dimiliki pengirim sah (sistem tiket, CRM, antrian),
 * sehingga tidak boleh menggerakkan state.
 */
export function looksRandomLocalPart(localPart: string): boolean {
  const compact = compactAddressPart(localPart).toLowerCase();
  if (compact.length < 10) return false;

  const digits = (compact.match(/\d/g) ?? []).length;
  if (digits / compact.length >= 0.25) return true;

  if (/[bcdfghjklmnpqrstvwxyz]{5,}/.test(compact)) return true;

  const vowels = (compact.match(/[aeiou]/g) ?? []).length;
  if (vowels === 0) return true;

  const distinct = new Set(compact).size;
  return distinct / compact.length <= 0.4;
}

/** Membandingkan domain registrable dari dua hostname dalam bentuk ASCII. */
function sameRegistrable(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const left = parsePublicSuffix(a.toLowerCase()).registrableDomain;
  const right = parsePublicSuffix(b.toLowerCase()).registrableDomain;
  return left.length > 0 && left === right;
}

export function buildEvidence(
  identity: ResolvedIdentity,
  name: NameAnalysis,
  matches: MatchAnalysis,
): Evidence[] {
  const out: Evidence[] = [];
  const fromParts = identity.fromParts;

  if (!name.hasDisplayName) {
    out.push(
      make('NO_DISPLAY_NAME', 'context', 'weak', 'A', {}, 'pengirim tidak menampilkan nama apa pun'),
    );
    return out;
  }

  if (name.isGenericOnly) {
    out.push(
      make(
        'GENERIC_TOKEN_ONLY_DISPLAYNAME',
        'context',
        'weak',
        'A',
        { tokens: name.tokens.map((token) => token.value).join(', ') },
        'display name hanya berisi peran layanan tanpa identitas',
      ),
    );
  }

  if (name.looksLikeHumanName) {
    out.push(
      make(
        'HUMAN_NAME_PATTERN',
        'context',
        'weak',
        'A',
        { tokens: name.identityTokens.map((token) => token.value).join(', ') },
        'display name mengikuti pola nama orang',
      ),
    );
  }

  if (fromParts === null) return out;

  if (fromParts.domainClass === 'mailing-list') {
    out.push(
      make(
        'MAILING_LIST_DOMAIN',
        'context',
        'weak',
        'A',
        { domain: fromParts.registrableDomain },
        'alamat milis: nama penulis dan alamat grup memang berbeda secara desain',
      ),
    );
    return out;
  }

  if (fromParts.domainClass === 'disposable') {
    out.push(
      make(
        'DISPOSABLE_DOMAIN',
        'context',
        'weak',
        'A',
        { domain: fromParts.registrableDomain },
        'domain surel sekali pakai',
      ),
    );
  }

  if (fromParts.isPunycode) {
    out.push(
      make(
        'PUNYCODE_DOMAIN',
        'context',
        'weak',
        'A',
        { ascii: fromParts.asciiHostname, unicode: fromParts.unicodeHostname },
        `domain berpunycode, bentuk Unicode: ${fromParts.unicodeHostname}`,
      ),
    );
  }

  for (const label of fromParts.mixedScriptLabels) {
    const scripts = analyzeScripts(label);
    const strength: Strength = scripts.suspiciousMix ? 'strong' : 'medium';
    out.push(
      make(
        'MIXED_SCRIPT_WITHIN_LABEL',
        'supports_inconsistency',
        strength,
        'A',
        { label, scripts: scripts.scripts.join(', ') },
        `label "${label}" mencampur aksara: ${scripts.scripts.join(', ')}`,
      ),
    );
  }

  // --- Klaim di dalam display name -----------------------------------------

  for (const embedded of name.embeddedAddresses) {
    const parsed = parseAddress(embedded);
    if (!parsed.valid) continue;
    const embeddedParts = analyzeDomain(parsed.hostname);

    if (
      embedded.toLowerCase() === identity.fromAddress.toLowerCase() ||
      (embeddedParts !== null && sameRegistrable(embeddedParts.asciiHostname, fromParts.asciiHostname))
    ) {
      out.push(
        make(
          'DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS',
          'supports_consistency',
          'strong',
          'A',
          { address: embedded },
          `display name memuat alamat yang sama dengan pengirim: "${embedded}"`,
        ),
      );
    } else {
      out.push(
        make(
          'DISPLAY_NAME_EMBEDS_OTHER_ADDRESS',
          'supports_inconsistency',
          'strong',
          'A',
          { displayed: embedded, actual: identity.fromAddress },
          `display name menampilkan "${embedded}", tetapi pengirim sebenarnya ${identity.fromAddress}`,
        ),
      );
    }
  }

  for (const claim of name.domainClaims) {
    if (claim.registrableDomain.toLowerCase() === fromParts.asciiHostname.toLowerCase()) continue;
    const fromRegistrable = parsePublicSuffix(fromParts.asciiHostname.toLowerCase()).registrableDomain;
    if (claim.registrableDomain.toLowerCase() === fromRegistrable) continue;
    out.push(
      make(
        'DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN',
        'supports_inconsistency',
        'strong',
        'A',
        { claimed: claim.registrableDomain, actual: fromParts.registrableDomain },
        `display name mengklaim domain "${claim.registrableDomain}", pengirim berasal dari "${fromParts.registrableDomain}"`,
      ),
    );
  }

  // --- Kecocokan token terhadap alamat -------------------------------------

  const registrableMatches = matchesRegistrableLabel(matches.exactMatches);

  const identityTokenValues = name.identityTokens.map((token) => token.value);
  const fullNameCompact = compactAddressPart(identityTokenValues.join('')).toLowerCase();
  const reversedCompact = compactAddressPart([...identityTokenValues].reverse().join('')).toLowerCase();
  const localPartCompact = compactAddressPart(identity.localPart).toLowerCase();

  const candidateSet = new Set(
    localPartCandidates(identityTokenValues).map((candidate) =>
      compactAddressPart(candidate).toLowerCase(),
    ),
  );

  // --- Token sebagai komponen utuh label registrable -------------------------
  //
  // `bca-klik.com` memecah label menjadi komponen ["bca", "klik"], dan "bca" adalah
  // komponen utuh: pola "brand + kata tambahan" yang merupakan bentuk lookalike
  // paling umum. Bandingkan dengan `risehq.com`, yang labelnya hanya punya satu
  // komponen "risehq" sehingga "rise" cuma awalan — penamaan brand yang wajar.
  //
  // Syarat tambahan "ada komponen yang tidak dijelaskan" berasal dari probe
  // adversarial, dan syarat itulah yang memisahkan dua pola yang tampak identik:
  //   `rise-security-hq.com` + "Rise Security" -> semua kata sudah dijelaskan
  //                                               ("hq" hanya 2 huruf) -> bukan lookalike
  //   `bca-klik.com`         + "BCA"           -> "klik" tidak dijelaskan siapa pun
  //                                               -> lookalike
  const wholeRegistrableLabel = fromParts.registrableLabel.toLowerCase();
  const componentExactTokens = new Set<string>();

  const displayWords = new Set(name.tokens.map((token) => token.value));

  /**
   * Komponen yang dianggap tidak membawa makna: terlalu pendek, atau murni angka.
   *
   * Kata generik seperti "verify" dan "security" SENGAJA tidak masuk daftar ini,
   * walaupun keduanya ada di GENERIC_TOKENS. Pembedanya adalah display name:
   * "Rise Security" menjelaskan kata "security" di `rise-security-hq.com`, sedangkan
   * "Apple" tidak menjelaskan kata "verify" di `apple-verify.com`. Memperlakukan
   * keduanya sama akan membuang justru pola "brand + kata pemicu" yang paling sering
   * dipakai untuk menipu.
   */
  const isPlaceholderComponent = (component: string): boolean =>
    component.length <= 2 || /^\d+$/.test(component);

  const unexplainedComponents = matches.registrableComponents.filter(
    (component) => !displayWords.has(component) && !isPlaceholderComponent(component),
  );

  if (matches.registrableComponents.length > 1 && unexplainedComponents.length > 0) {
    const componentSet = new Set(matches.registrableComponents);
    for (const token of identityTokenValues) {
      if (token.length < MIN_EXACT_TOKEN_LENGTH) continue;
      if (token === wholeRegistrableLabel) continue;
      if (componentSet.has(token)) componentExactTokens.add(token);
    }
  }

  for (const token of componentExactTokens) {
    out.push(
      make(
        'DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT',
        'supports_inconsistency',
        'strong',
        'A',
        {
          token,
          label: fromParts.registrableLabel,
          domain: fromParts.registrableDomain,
          unexplained: unexplainedComponents.join(', '),
        },
        `"${token}" dipakai sebagai kata tersendiri di dalam "${fromParts.registrableLabel}" bersama "${unexplainedComponents.join('", "')}" yang tidak dijelaskan display name`,
      ),
    );
  }

  for (const match of registrableMatches) {
    // Token yang sudah dilaporkan sebagai komponen label tidak diulang di sini,
    // karena kecocokannya hanya akibat awalan/akhiran pada label majemuk.
    if (componentExactTokens.has(match.token)) continue;

    if (match.hit.method === 'EXACT') {
      // Cocok persis dengan SELURUH label registrable adalah bukti kuat. Cocok persis
      // dengan salah satu komponennya saja tidak: `apple-verify.com` memang memuat
      // kata "apple", tetapi domainnya bukan domain Apple.
      const onWholeLabel =
        match.targetKind === 'registrable-label' || match.targetKind === 'registrable-compact';
      out.push(
        make(
          'DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL',
          'supports_consistency',
          onWholeLabel ? 'strong' : 'medium',
          'A',
          { token: match.token, label: fromParts.registrableLabel },
          match.hit.evidence,
        ),
      );
      continue;
    }

    // Label IDN dilewati dari kanal lookalike.
    //
    // Bentuk Latin sebuah label IDN adalah transliterasi, sehingga perbandingan
    // jumlah huruf terhadap nama Latin memang tidak dapat diandalkan:
    // `warungé.id` dengan display name "Warung Digital" hanya berbeda satu huruf,
    // persis seperti typosquat, padahal keduanya brand yang sama. Kanal yang benar
    // untuk label non-ASCII adalah homoglyph (skeleton), bukan near-miss.
    const targetIsNonAscii = /[^\x20-\x7e]/.test(match.target);

    if (targetIsNonAscii) continue;

    if (match.hit.method === 'PREFIX_OR_SUFFIX') {
      // Domain yang merupakan identitas yang diklaim ditambah satu-dua karakter
      // adalah typosquat, bukan konsistensi: `bcaa`, `tokopediaa`.
      // Ambang rasio 0,75 memisahkannya dari penamaan brand yang wajar seperti
      // `risehq` (4/6 = 0,67).
      if (match.hit.score >= 0.75) {
        out.push(
          make(
            'LOOKALIKE_NEAR_MISS',
            'supports_inconsistency',
            'strong',
            'A',
            { token: match.token, label: match.target },
            `domain "${match.target}" menambahkan karakter pada "${match.token}"`,
          ),
        );
      } else {
        out.push(
          make(
            'DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL',
            'supports_consistency',
            'medium',
            'A',
            { token: match.token, label: fromParts.registrableLabel },
            match.hit.evidence,
          ),
        );
      }
      continue;
    }

    // Kemiripan fuzzy pada label registrable bukan bukti konsistensi, melainkan
    // kebalikannya. Domain yang "hampir sama tetapi tidak persis" dengan identitas
    // yang diklaim adalah pola typosquat: `tokopedi`, `micros0ft`, `gojeg`.
    //
    // Strength dibedakan menurut apakah panjangnya berubah, dan pembedaan ini juga
    // berasal dari probe adversarial:
    //   panjang berubah  (bcaa, shope, tokopedi) -> kuat
    //   panjang sama     (rizki/rizky, gojeg/gojek) -> menengah
    // Alasannya konkret: penyerang cenderung MENAMBAH atau MENGHAPUS huruf pada brand,
    // sedangkan varian ejaan nama orang Indonesia justru menukar huruf
    // (Rizky/Rizki, Yusuf/Yusup, Andi/Andy). Menyamakan keduanya akan menghukum
    // pemilik domain pribadi yang sah.
    if (
      match.hit.method === 'JARO_WINKLER' ||
      match.hit.method === 'DAMERAU_LEVENSHTEIN'
    ) {
      // Substitusi digit pada panjang yang sama tetap bukti kuat.
      //
      // Kanal near-miss berjalan lebih dulu daripada kanal fold, sehingga tanpa
      // pemeriksaan ini `br1` terhadap "BRI" akan dinilai sama lemahnya dengan
      // `bnl` terhadap "BNI". Padahal mengganti huruf dengan digit pada domain yang
      // didaftarkan adalah tindakan yang disengaja, bukan varian ejaan.
      const foldEquivalent = isFoldEquivalent(match.token, match.target);
      const lengthChanged = match.token.length !== match.target.length;
      const strength: Strength = foldEquivalent || lengthChanged ? 'strong' : 'medium';

      out.push(
        make(
          'LOOKALIKE_NEAR_MISS',
          'supports_inconsistency',
          strength,
          'A',
          { token: match.token, label: match.target },
          foldEquivalent
            ? `domain "${match.target}" meniru "${match.token}" dengan mengganti karakter`
            : `domain "${match.target}" hampir sama dengan "${match.token}" tetapi tidak persis`,
        ),
      );
    }
  }

  const localPartReflectsName =
    localPartCompact.length >= 3 &&
    (localPartCompact === fullNameCompact ||
      localPartCompact === reversedCompact ||
      candidateSet.has(localPartCompact));

  const localPartTokenMatch = matches.exactMatches.some(
    (match) =>
      (match.targetKind === 'localpart' || match.targetKind === 'localpart-compact') &&
      match.hit.method === 'EXACT',
  );

  if (localPartReflectsName || localPartTokenMatch) {
    // Untuk organisasi, identitas harus hidup di domain, bukan di local-part yang
    // bebas dibentuk pengirim. Karena itu kecocokan hanya pada local-part tidak
    // pernah berstrength kuat ketika display name mengklaim sebuah organisasi.
    const strength: Strength = name.looksLikeOrganization ? 'medium' : 'strong';
    out.push(
      make(
        'DISPLAY_NAME_MATCHES_LOCALPART_EXACT',
        'supports_consistency',
        strength,
        'A',
        { name: identityTokenValues.join(' '), localpart: identity.localPart },
        `nama "${identityTokenValues.join(' ')}" tercermin pada local-part "${identity.localPart}"`,
      ),
    );
  }

  // Token yang hanya muncul di subdomain, tidak di label registrable.
  //
  // Strength dibedakan menurut metode kecocokannya, dan pembedaan itu menutup satu
  // false positive yang nyata:
  //   `paypal.com.secure-login.xyz`      -> label subdomain "paypal" PERSIS sama  -> kuat
  //   `tokonusantara.com.host.co.id`     -> label "tokonusantara", token "toko"
  //                                         hanya awalan                    -> menengah
  // Pola pertama adalah domain palsu yang ditanam di subdomain. Pola kedua adalah
  // pengirim yang dihosting di bawah domain penyedia, dan sangat lazim.
  const subdomainOnlyTokens = new Map<string, Strength>();
  for (const match of matches.exactMatches) {
    if (match.targetKind !== 'subdomain-label') continue;
    const token = match.token;
    const alsoInRegistrable = registrableMatches.some((other) => other.token === token);
    if (alsoInRegistrable) continue;

    const strength: Strength = match.hit.method === 'EXACT' ? 'strong' : 'medium';
    const existing = subdomainOnlyTokens.get(token);
    if (existing === undefined || (existing === 'medium' && strength === 'strong')) {
      subdomainOnlyTokens.set(token, strength);
    }
  }
  for (const [token, strength] of subdomainOnlyTokens) {
    out.push(
      make(
        'DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY',
        'supports_inconsistency',
        strength,
        'A',
        { token, subdomain: fromParts.subdomain, domain: fromParts.registrableDomain },
        `"${token}" hanya muncul di subdomain "${fromParts.subdomain}", bukan di domain "${fromParts.registrableDomain}"`,
      ),
    );
  }

  for (const match of matches.confusableMatches) {
    out.push(
      make(
        'CONFUSABLE_MATCH_TO_TOKEN',
        'supports_inconsistency',
        'strong',
        'A',
        { token: match.token, target: match.target },
        match.evidence,
      ),
    );
  }

  for (const match of matches.foldMatches) {
    const onRegistrable =
      match.targetKind === 'registrable-label' ||
      match.targetKind === 'registrable-compact' ||
      match.targetKind === 'registrable-component';
    // Substitusi digit/huruf pada label registrable adalah bukti yang jauh lebih
    // kuat daripada pada local-part: label registrable harus didaftarkan secara sadar.
    const strength: Strength =
      onRegistrable && Math.min(match.token.length, match.target.length) >= MIN_FOLD_LENGTH
        ? 'strong'
        : 'weak';
    out.push(
      make(
        'DIGIT_SUBSTITUTION_MATCH',
        'supports_inconsistency',
        strength,
        'A',
        { token: match.token, target: match.target },
        match.evidence,
      ),
    );
  }

  // Token yang hanya tertanam sebagai substring di dalam label registrable,
  // mis. "signals" di "37signals".
  //
  // Target yang diperiksa HANYA label registrable. Sebelumnya seluruh target ikut
  // diperiksa, termasuk `address-compact` yang merupakan gabungan local-part dan
  // domain; akibatnya token yang berada di local-part — hal yang sepenuhnya normal —
  // dilaporkan sebagai "tertanam di domain" dan menekan hasil yang sah menjadi
  // UNCLEAR.
  const embeddedMatches = matches.exactMatches.filter(
    (match) =>
      match.hit.method === 'CONTAINS' &&
      (match.targetKind === 'registrable-compact' || match.targetKind === 'registrable-label'),
  );
  for (const match of embeddedMatches) {
    out.push(
      make(
        'TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL',
        'supports_inconsistency',
        'weak',
        'A',
        { token: match.token, target: match.target },
        match.hit.evidence,
      ),
    );
  }

  // --- Klaim organisasi ----------------------------------------------------

  const isFreeMailClass =
    fromParts.domainClass === 'freemail' || fromParts.domainClass === 'disposable';

  if (isFreeMailClass && name.looksLikeOrganization) {
    out.push(
      make(
        'FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME',
        'supports_inconsistency',
        'strong',
        'A',
        { name: identityTokenValues.join(' '), domain: fromParts.registrableDomain },
        `display name mengklaim organisasi "${identityTokenValues.join(' ')}", tetapi alamatnya di ${fromParts.registrableDomain}`,
      ),
    );
  } else if (
    name.looksLikeOrganization &&
    !isFreeMailClass &&
    registrableMatches.length === 0 &&
    subdomainOnlyTokens.size === 0
  ) {
    out.push(
      make(
        'ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN',
        'supports_inconsistency',
        'medium',
        'A',
        { name: identityTokenValues.join(' '), domain: fromParts.registrableDomain },
        `display name mengklaim organisasi, tetapi "${fromParts.registrableDomain}" tidak memuat identitas tersebut`,
      ),
    );
  }

  if (identity.gmailViaHint !== undefined) {
    out.push(
      make(
        'GMAIL_VIA_ESP_HINT',
        'context',
        'weak',
        'A',
        { esp: identity.gmailViaHint },
        `webmail menandai pengiriman melalui "${identity.gmailViaHint}"`,
      ),
    );
  }

  if (identity.gmailOwnWarning) {
    out.push(
      make(
        'GMAIL_OWN_WARNING_PRESENT',
        'context',
        'weak',
        'A',
        {},
        'webmail menampilkan peringatan pengirim pada pesan ini',
      ),
    );
  }

  if (looksRandomLocalPart(identity.localPart)) {
    out.push(
      make(
        'RANDOM_LOCAL_PART',
        'context',
        'weak',
        'A',
        { localpart: identity.localPart },
        `local-part "${identity.localPart}" tampak acak`,
      ),
    );
  }

  // --- Tier B ---------------------------------------------------------------
  // Hanya dinilai bila headernya benar-benar tersedia. Ketidakhadiran data Tier B
  // tidak pernah diperlakukan sebagai ketidakcocokan.

  if (identity.provenance === 'dom-original') {
    const esp = isEspDelivery(identity);

    // Identitas yang hanya diakui oleh domain Reply-To.
    //
    // Ini kanal terkuat di Tier B, dan berasal dari kasus nyata: sebuah email dengan
    // display name "Rise" dikirim dari `no-reply@mngl.in` — domain yang tidak memuat
    // "rise" sama sekali — dengan Reply-To `support@riseworks.digital` yang memuatnya.
    // SPF, DKIM, dan DMARC semuanya lulus untuk `mngl.in`, sehingga autentikasi tidak
    // memberi sinyal apa pun dan webmail pun tidak menampilkan peringatan.
    //
    // Sengaja TIDAK ditekan oleh indikator "via": penekanan itu masuk akal untuk
    // Return-Path, tetapi tidak masuk akal di sini. Keberadaan "via" tidak menjelaskan
    // mengapa identitas yang diklaim justru muncul di domain tujuan balasan dan bukan
    // di domain pengirim. Satu-satunya pengecualian adalah bila domain From memang
    // infrastruktur pengiriman yang dikenal, dan itu sudah ditangani di helper.
    for (const token of replyToOnlyIdentityTokens({ identity, name, matches })) {
      out.push(
        make(
          'REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT',
          'supports_inconsistency',
          'strong',
          'B',
          {
            token,
            from: fromParts.registrableDomain,
            replyTo: identity.replyToParts?.registrableDomain ?? '',
          },
          `"${token}" muncul di domain tujuan balasan "${identity.replyToParts?.registrableDomain ?? ''}", tetapi tidak di domain pengirim "${fromParts.registrableDomain}"`,
        ),
      );
    }

    if (!esp && identity.replyToParts !== null) {
      const replyParts = identity.replyToParts;
      const replyIsFree =
        replyParts.domainClass === 'freemail' || replyParts.domainClass === 'disposable';
      const fromIsCorporate =
        fromParts.domainClass === 'corporate' || fromParts.domainClass === 'subdomain-delegated';

      if (replyIsFree && fromIsCorporate) {
        out.push(
          make(
            'REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE',
            'supports_inconsistency',
            'strong',
            'B',
            { replyTo: replyParts.registrableDomain, from: fromParts.registrableDomain },
            `balasan diarahkan ke ${replyParts.registrableDomain}, bukan ke domain pengirim ${fromParts.registrableDomain}`,
          ),
        );
      } else if (replyParts.registrableDomain !== fromParts.registrableDomain) {
        out.push(
          make(
            'REPLY_TO_DOMAIN_MISMATCH',
            'supports_inconsistency',
            'medium',
            'B',
            { replyTo: replyParts.registrableDomain, from: fromParts.registrableDomain },
            `Reply-To menunjuk ke ${replyParts.registrableDomain}, berbeda dari ${fromParts.registrableDomain}`,
          ),
        );
      }
    }

    if (!esp) {
      const returnParts = identity.returnPathParts;
      const differs =
        returnParts === null ||
        returnParts.registrableDomain !== fromParts.registrableDomain;
      if (differs) {
        out.push(
          make(
            'RETURN_PATH_NULL_OR_MISMATCH',
            'context',
            'weak',
            'B',
            {
              returnPath: returnParts?.registrableDomain ?? '',
              from: fromParts.registrableDomain,
            },
            returnParts === null
              ? 'Return-Path tidak ada pada header'
              : `Return-Path ${returnParts.registrableDomain} berbeda dari ${fromParts.registrableDomain}`,
          ),
        );
      }
    }

    const auth = identity.auth;
    if (auth !== null) {
      // DMARC fail bersifat medium, bukan strong: ia mengautentikasi domain, bukan
      // display name. Sendirian ia hanya menghasilkan UNCLEAR.
      if (isFailure(auth.dmarc)) {
        out.push(
          make(
            'AUTH_DMARC_FAIL',
            'supports_inconsistency',
            'medium',
            'B',
            { result: auth.dmarc ?? 'fail' },
            `DMARC ${auth.dmarc} untuk domain pengirim`,
          ),
        );
      }
      if (isFailure(auth.spf)) {
        out.push(
          make('AUTH_SPF_FAIL', 'context', 'weak', 'B', { result: auth.spf ?? '' }, `SPF ${auth.spf}`),
        );
      }
      if (isFailure(auth.dkim)) {
        out.push(
          make('AUTH_DKIM_FAIL', 'context', 'weak', 'B', { result: auth.dkim ?? '' }, `DKIM ${auth.dkim}`),
        );
      }
      if (isPass(auth.dmarc) && sameRegistrable(auth.headerFrom, fromParts.asciiHostname)) {
        out.push(
          make(
            'AUTH_ALIGNED_PASS',
            'supports_consistency',
            'medium',
            'B',
            { domain: auth.headerFrom ?? '' },
            `DMARC pass dan selaras dengan ${auth.headerFrom}`,
          ),
        );
      }
    }
  }

  return out;
}

/** Dipakai test untuk memastikan tidak ada token generik yang bocor menjadi identitas. */
export function isIdentityBearingToken(token: string): boolean {
  return token.length > 0 && !SERVICE_ROLE_TOKENS.has(token);
}
