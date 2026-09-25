/**
 * Domain Analyzer.
 *
 * Menghasilkan `DomainParts` dengan pencocokan PSL pada bentuk ASCII, tetapi seluruh
 * field yang dibandingkan dengan display name (`labels`, `registrableDomain`,
 * `registrableLabel`, `subdomain`, `suffix`) dikembalikan dalam bentuk **Unicode**.
 * Alasannya: label punycode seperti `xn--mnchen-3ya` tidak akan pernah cocok dengan
 * token nama, dan pemeriksaan aksara/homoglyph memang harus dilakukan pada bentuk
 * Unicode.
 */
import { DISPOSABLE_DOMAINS } from '../data/disposable.ts';
import { ESP_DOMAINS } from '../data/esp.ts';
import { FREEMAIL_DOMAINS } from '../data/freemail.ts';
import { hasMailingListSubdomain, MAILING_LIST_DOMAINS } from '../data/mailing-list.ts';
import { hasPunycodeLabel, punycodeToUnicode } from '../normalize/punycode.ts';
import { analyzeScripts } from '../normalize/scripts.ts';
import type { DomainClass, DomainParts } from '../types.ts';
import { isIpLiteral, parsePublicSuffix, PSL_VERSION } from './psl.ts';

const ASCII_ONLY = /^[\x00-\x7f]*$/;

/**
 * Mengubah hostname menjadi bentuk ASCII (punycode) memakai pemroses IDNA bawaan
 * platform. Bila hostname tidak dapat diproses, hostname apa adanya dikembalikan;
 * `pslMatch` kemudian akan bernilai `false` sehingga pemanggil tahu hasilnya lemah.
 */
function toAsciiHostname(hostname: string): string {
  if (ASCII_ONLY.test(hostname)) return hostname;
  try {
    return new URL(`http://${hostname}`).hostname;
  } catch {
    return hostname;
  }
}

function classifyDomain(
  registrableAscii: string,
  subdomain: string,
  pslMatch: boolean,
  isPrivateSuffix: boolean,
  isIpAddress: boolean,
): DomainClass {
  if (isIpAddress || !pslMatch) return 'unknown';
  if (FREEMAIL_DOMAINS.has(registrableAscii)) return 'freemail';
  if (DISPOSABLE_DOMAINS.has(registrableAscii)) return 'disposable';
  if (ESP_DOMAINS.has(registrableAscii)) return 'esp';
  if (MAILING_LIST_DOMAINS.has(registrableAscii) || hasMailingListSubdomain(subdomain)) {
    return 'mailing-list';
  }
  // Suffix privat (mis. `foo.github.io`) berarti pemilik label registrable adalah
  // penyewa platform, bukan pemilik domain. Token brand yang muncul di sana bisa sah.
  if (isPrivateSuffix) return 'subdomain-delegated';
  return 'corporate';
}

/**
 * Menganalisis hostname. Mengembalikan `null` bila hostname kosong, karena tidak ada
 * yang dapat dianalisis dan pemanggil harus membedakan "tidak ada domain" dari
 * "domain yang tidak dikenal".
 */
export function analyzeDomain(hostnameInput: string): DomainParts | null {
  const hostname = hostnameInput.trim().toLowerCase().replace(/\.+$/, '');
  if (hostname.length === 0) return null;

  const isIpAddress = isIpLiteral(hostname);
  const asciiHostname = isIpAddress ? hostname : toAsciiHostname(hostname);
  const psl = parsePublicSuffix(asciiHostname);
  const unicodeHostname = punycodeToUnicode(asciiHostname);

  const unicodeLabels = unicodeHostname.split('.').filter((label) => label.length > 0);

  const suffixCount = psl.suffix.length === 0 ? 0 : psl.suffix.split('.').length;
  const registrableCount = suffixCount + 1;

  // Peta dari kanan, karena jumlah label Unicode dan ASCII selalu sama untuk
  // pemrosesan IDNA yang sah; memetakan dari kanan membuat pemetaan tetap benar
  // walaupun ada label kosong di kiri.
  const useUnicode = unicodeLabels.length >= registrableCount && registrableCount > 0;

  const registrableDomain = useUnicode
    ? unicodeLabels.slice(unicodeLabels.length - registrableCount).join('.')
    : psl.registrableDomain;
  const suffix = useUnicode
    ? unicodeLabels.slice(unicodeLabels.length - suffixCount).join('.')
    : psl.suffix;
  const registrableLabel = useUnicode
    ? (unicodeLabels[unicodeLabels.length - registrableCount] ?? psl.registrableLabel)
    : psl.registrableLabel;
  const subdomain = useUnicode
    ? unicodeLabels.slice(0, unicodeLabels.length - registrableCount).join('.')
    : psl.subdomain;

  // Kelas domain ditentukan dari bentuk ASCII, karena seluruh tabel data disimpan
  // sebagai domain ASCII.
  const registrableAscii = psl.registrableDomain.toLowerCase();
  const subdomainAscii = psl.subdomain.toLowerCase();

  const mixedScriptLabels: string[] = [];
  for (const label of unicodeLabels) {
    const analysis = analyzeScripts(label);
    if (analysis.suspiciousMix || analysis.benignMix) mixedScriptLabels.push(label);
  }

  return {
    hostname,
    asciiHostname,
    unicodeHostname,
    registrableDomain,
    suffix,
    subdomain,
    registrableLabel,
    labels: unicodeLabels,
    isPunycode: hasPunycodeLabel(asciiHostname),
    pslMatch: psl.matched,
    isPrivateSuffix: psl.isPrivateSuffix,
    pslVersion: PSL_VERSION,
    domainClass: classifyDomain(
      registrableAscii,
      subdomainAscii,
      psl.matched,
      psl.isPrivateSuffix,
      isIpAddress,
    ),
    mixedScriptLabels,
    isIpAddress,
  };
}

/** `true` bila domain termasuk penyedia surel gratis. */
export function isFreemail(parts: DomainParts): boolean {
  return parts.domainClass === 'freemail';
}

/** `true` bila domain termasuk layanan sekali pakai. */
export function isDisposable(parts: DomainParts): boolean {
  return parts.domainClass === 'disposable';
}

/** `true` bila domain termasuk infrastruktur pengiriman. */
export function isEsp(parts: DomainParts): boolean {
  return parts.domainClass === 'esp';
}

/** `true` bila domain adalah milis atau grup diskusi. */
export function isMailingList(parts: DomainParts): boolean {
  return parts.domainClass === 'mailing-list';
}
