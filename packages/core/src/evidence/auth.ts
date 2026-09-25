/**
 * Parser `Authentication-Results` (Tier B).
 *
 * Hanya membaca nilai yang sudah dihitung pihak lain; engine tidak pernah
 * memverifikasi tanda tangan DKIM secara kriptografis dan tidak boleh
 * menyiratkan bahwa ia melakukannya.
 *
 * Satu aturan yang mengikat seluruh pemakaian hasil ini:
 * **authentication PASS membuktikan DOMAIN, bukan display name.** DKIM pass pada
 * `evil-bank.xyz` hanya berarti domain itu menandatangani pesannya sendiri. Karena
 * itu PASS tidak pernah dijadikan bukti bahwa organisasi yang diklaim display name
 * adalah asli.
 */

export interface AuthenticationResults {
  readonly spf: string | null;
  readonly dkim: string | null;
  readonly dmarc: string | null;
  /** Domain yang diklaim pada `header.from`, bila disebutkan. */
  readonly headerFrom: string | null;
  readonly raw: string;
}

/** Nilai yang dianggap kegagalan eksplisit. `none` bukan kegagalan, melainkan ketiadaan. */
export function isFailure(result: string | null): boolean {
  if (result === null) return false;
  const normalized = result.toLowerCase();
  return normalized === 'fail' || normalized === 'softfail' || normalized === 'permerror';
}

export function isPass(result: string | null): boolean {
  return result !== null && result.toLowerCase() === 'pass';
}

export function parseAuthenticationResults(raw: string | undefined): AuthenticationResults | null {
  if (raw === undefined || raw.trim().length === 0) return null;

  const extract = (pattern: RegExp): string | null => {
    const match = pattern.exec(raw);
    return match?.[1] === undefined ? null : match[1].toLowerCase();
  };

  return {
    // `spf=pass` dan `spf=softfail (…)` sama-sama tertangkap.
    spf: extract(/\bspf\s*=\s*([a-z]+)/i),
    // Ambil kemunculan terakhir dkim agar sel yang paling relevan yang dipakai.
    dkim: (() => {
      const all = [...raw.matchAll(/\bdkim\s*=\s*([a-z]+)/gi)];
      const last = all[all.length - 1];
      return last?.[1] === undefined ? null : last[1].toLowerCase();
    })(),
    dmarc: extract(/\bdmarc\s*=\s*([a-z]+)/i),
    headerFrom: extract(/\bheader\.from\s*=\s*([^\s;)]+)/i),
    raw,
  };
}
