/**
 * Algoritma Public Suffix List.
 *
 * Diimplementasikan lengkap, termasuk wildcard (`*.ck`) dan exception (`!www.ck`),
 * karena keduanya benar-benar mengubah hasil. Contoh nyata: tanpa dukungan wildcard,
 * `foo.bar.ck` akan dianggap registrable domain `bar.ck`, padahal `*.ck` membuat
 * `bar.ck` sendiri adalah suffix publik.
 *
 * PENTING — PSL bukan batas keamanan. ICANN/SSAC (SAC070) dan pengelola PSL sendiri
 * menyatakan bahwa daftar suffix statis tidak boleh diperlakukan sebagai kontrol
 * keamanan. Karena itu `pslMatch: false` harus disurfacekan ke pemanggil, bukan
 * diam-diam dianggap benar.
 */
import {
  PSL_EXACT_RAW,
  PSL_EXCEPTION_RAW,
  PSL_PRIVATE_RAW,
  PSL_VERSION,
  PSL_WILDCARD_RAW,
} from '../data/psl.generated.ts';

export { PSL_VERSION };

let exactSet: Set<string> | null = null;
let wildcardSet: Set<string> | null = null;
let exceptionSet: Set<string> | null = null;
let privateSet: Set<string> | null = null;

function toSet(raw: string): Set<string> {
  const set = new Set<string>();
  for (const line of raw.split('\n')) {
    if (line.length > 0) set.add(line);
  }
  return set;
}

function sets(): {
  exact: Set<string>;
  wildcard: Set<string>;
  exception: Set<string>;
  privateRules: Set<string>;
} {
  exactSet ??= toSet(PSL_EXACT_RAW);
  wildcardSet ??= toSet(PSL_WILDCARD_RAW);
  exceptionSet ??= toSet(PSL_EXCEPTION_RAW);
  privateSet ??= toSet(PSL_PRIVATE_RAW);
  return { exact: exactSet, wildcard: wildcardSet, exception: exceptionSet, privateRules: privateSet };
}

export interface PublicSuffixResult {
  /** Public suffix menurut PSL, mis. `co.id`. String kosong bila tidak ada. */
  readonly suffix: string;
  /** Domain yang dapat didaftarkan, mis. `example.co.id`. */
  readonly registrableDomain: string;
  /** Label registrable saja, mis. `example`. */
  readonly registrableLabel: string;
  /** Bagian sebelum registrable domain. String kosong bila tidak ada. */
  readonly subdomain: string;
  /** `true` bila ada aturan PSL yang cocok. */
  readonly matched: boolean;
  /** `true` bila aturan yang menang berasal dari bagian PRIVATE DOMAINS. */
  readonly isPrivateSuffix: boolean;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** `true` bila hostname adalah alamat IP literal, bukan nama domain. */
export function isIpLiteral(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return IPV4.test(bare) || bare.includes(':');
}

/**
 * Memecah hostname menurut PSL.
 *
 * Hostname harus sudah berbentuk ASCII (punycode) dan huruf kecil. Untuk hostname
 * yang bukan nama domain, seluruh nilai dikembalikan sebagai hostname itu sendiri
 * dengan `matched: false`.
 */
export function parsePublicSuffix(hostname: string): PublicSuffixResult {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');

  const fallback: PublicSuffixResult = {
    suffix: '',
    registrableDomain: normalized,
    registrableLabel: normalized,
    subdomain: '',
    matched: false,
    isPrivateSuffix: false,
  };

  if (normalized.length === 0 || isIpLiteral(normalized)) return fallback;

  const labels = normalized.split('.').filter((label) => label.length > 0);
  if (labels.length === 0) return fallback;

  const { exact, wildcard, exception, privateRules } = sets();

  // Aturan exception menang atas segalanya.
  for (let index = 0; index < labels.length; index++) {
    const candidate = labels.slice(index).join('.');
    if (exception.has(candidate)) {
      // Suffix adalah kandidat tanpa label pertamanya.
      const suffixLabelCount = labels.length - index - 1;
      return build(labels, suffixLabelCount, {
        matched: true,
        isPrivateSuffix: privateRules.has(candidate),
      });
    }
  }

  // Aturan exact dan wildcard: yang paling banyak label menang, sehingga pencarian
  // dilakukan dari suffix terpanjang.
  for (let index = 0; index < labels.length; index++) {
    const candidate = labels.slice(index).join('.');

    if (exact.has(candidate)) {
      return build(labels, labels.length - index, {
        matched: true,
        isPrivateSuffix: privateRules.has(candidate),
      });
    }

    const wildcardTarget = labels.slice(index + 1).join('.');
    if (wildcardTarget.length > 0 && wildcard.has(wildcardTarget)) {
      return build(labels, labels.length - index, {
        matched: true,
        isPrivateSuffix: privateRules.has(wildcardTarget),
      });
    }
  }

  // Tidak ada aturan yang cocok: aturan yang berlaku adalah "*" (satu label).
  // `matched: false` memberi tahu pemanggil bahwa hasilnya tidak dapat dipercaya.
  if (labels.length < 2) return fallback;
  return build(labels, 1, { matched: false, isPrivateSuffix: false });
}

function build(
  labels: readonly string[],
  suffixLabelCount: number,
  flags: { matched: boolean; isPrivateSuffix: boolean },
): PublicSuffixResult {
  const safeSuffixCount = Math.max(0, Math.min(suffixLabelCount, labels.length));

  if (labels.length <= safeSuffixCount) {
    // Tidak ada ruang untuk label registrable.
    const whole = labels.join('.');
    return {
      suffix: whole,
      registrableDomain: whole,
      registrableLabel: labels[0] ?? whole,
      subdomain: '',
      matched: flags.matched,
      isPrivateSuffix: flags.isPrivateSuffix,
    };
  }

  const registrableStart = labels.length - safeSuffixCount - 1;

  return {
    suffix: labels.slice(registrableStart + 1).join('.'),
    registrableDomain: labels.slice(registrableStart).join('.'),
    registrableLabel: labels[registrableStart] ?? '',
    subdomain: labels.slice(0, registrableStart).join('.'),
    matched: flags.matched,
    isPrivateSuffix: flags.isPrivateSuffix,
  };
}
