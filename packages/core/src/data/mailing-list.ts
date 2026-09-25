/**
 * Milis dan grup diskusi.
 *
 * Pada arsitektur milis, hubungan antara display name dan alamat pengirim memang
 * terputus secara desain: nama yang tampil adalah nama *penulis*, sedangkan alamat
 * adalah alamat *grup*. Karena itu pengirim milis tidak boleh dinilai, melainkan
 * dikembalikan sebagai UNASSESSABLE.
 */
export const MAILING_LIST_DOMAINS: ReadonlySet<string> = new Set([
  'googlegroups.com',
  'groups.google.com',
  'groups.io',
  'freelists.org',
  'yahoogroups.com',
  'yahoogroups.co.uk',
  'topica.com',
  'simplelists.com',
  'lists.sourceforge.net',
  'sourceforge.net',
  'nongnu.org',
  'gnu.org',
  'mail-archive.com',
  'narkive.com',
  'mailman.narkive.com',
  'listserv.ac.id',
  'indonet.or.id',
  'dgroups.org',
  'lists.ubuntu.com',
  'lists.debian.org',
  'lists.apache.org',
  'lists.w3.org',
  'lists.whatwg.org',
  'listbox.com',
  'sympa.org',
  'mailmanlists.org',
  'ml.kaskus.co.id',
]);

/**
 * Awalan subdomain yang menandakan host adalah antarmuka milis, bukan pengirim
 * perorangan. `mail.` dan `email.` sengaja TIDAK dimasukkan karena keduanya adalah
 * subdomain pengirim sah yang sangat umum pada domain perusahaan.
 */
export const MAILING_LIST_SUBDOMAIN_PREFIXES: readonly string[] = [
  'lists.',
  'listserv.',
  'list.',
  'mailman.',
  'majordomo.',
  'groups.',
  'forum.',
  'forums.',
  'ml.',
  'sympa.',
];

export function isMailingListDomain(registrableDomain: string): boolean {
  return MAILING_LIST_DOMAINS.has(registrableDomain);
}

export function hasMailingListSubdomain(subdomain: string): boolean {
  if (subdomain.length === 0) return false;
  const lower = `${subdomain.toLowerCase()}.`;
  return MAILING_LIST_SUBDOMAIN_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
