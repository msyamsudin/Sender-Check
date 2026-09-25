import { describe, expect, it } from 'vitest';
import {
  DISPOSABLE_DOMAINS,
  ESP_DOMAINS,
  FREEMAIL_DOMAINS,
  MAILING_LIST_DOMAINS,
  PSL_COUNTS,
} from '../src/index.ts';
import { analyzeDomain } from '../src/domain/analyzer.ts';
import { parsePublicSuffix } from '../src/domain/psl.ts';
import {
  extractAddressPart,
  findEmbeddedAddresses,
  localPartCandidates,
  parseAddress,
} from '../src/domain/address.ts';

function parts(hostname: string) {
  const result = analyzeDomain(hostname);
  if (result === null) throw new Error(`analyzeDomain(${hostname}) mengembalikan null`);
  return result;
}

describe('PSL: aturan multi-label', () => {
  it('memisahkan suffix dua label dengan benar', () => {
    const result = parsePublicSuffix('mail.rise.co.id');
    expect(result.suffix).toBe('co.id');
    expect(result.registrableDomain).toBe('rise.co.id');
    expect(result.registrableLabel).toBe('rise');
    expect(result.subdomain).toBe('mail');
    expect(result.matched).toBe(true);
  });

  it('menangani suffix banyak label pada berbagai negara', () => {
    expect(parsePublicSuffix('a.b.example.co.uk').registrableDomain).toBe('example.co.uk');
    expect(parsePublicSuffix('example.com.au').registrableDomain).toBe('example.com.au');
    expect(parsePublicSuffix('example.ac.id').registrableDomain).toBe('example.ac.id');
    expect(parsePublicSuffix('example.sch.id').registrableDomain).toBe('example.sch.id');
    expect(parsePublicSuffix('example.go.id').registrableDomain).toBe('example.go.id');
    expect(parsePublicSuffix('example.co.jp').registrableDomain).toBe('example.co.jp');
  });

  it('menangani wildcard PSL', () => {
    // Tanpa dukungan wildcard, `bar.ck` akan disangka registrable domain, padahal
    // `*.ck` membuat `bar.ck` sendiri adalah suffix publik.
    const result = parsePublicSuffix('foo.bar.ck');
    expect(result.suffix).toBe('bar.ck');
    expect(result.registrableDomain).toBe('foo.bar.ck');
    expect(result.matched).toBe(true);
  });

  it('menangani exception PSL', () => {
    // `!www.ck` adalah exception terhadap `*.ck`.
    const result = parsePublicSuffix('www.ck');
    expect(result.suffix).toBe('ck');
    expect(result.registrableDomain).toBe('www.ck');
  });

  it('mengenali suffix privat sehingga penyewa platform tidak dianggap pemilik domain', () => {
    const result = parsePublicSuffix('user.github.io');
    expect(result.registrableDomain).toBe('user.github.io');
    expect(result.isPrivateSuffix).toBe(true);
  });

  it('menandai pslMatch false ketika tidak ada aturan yang cocok', () => {
    // PSL bukan batas keamanan; hasil yang tidak dapat dipercaya harus ditandai,
    // bukan diam-diam dianggap benar.
    const result = parsePublicSuffix('a.b.invalidtldthatdoesnotexist');
    expect(result.matched).toBe(false);
  });

  it('tabel PSL yang dibundel tidak membusuk', () => {
    expect(PSL_COUNTS.exact).toBeGreaterThan(5000);
    expect(PSL_COUNTS.wildcard).toBeGreaterThan(50);
    expect(PSL_COUNTS.privateRules).toBeGreaterThan(1000);
  });
});

describe('analisis domain: taksonomi enam kelas', () => {
  it('mengenali freemail, termasuk subdomainnya', () => {
    expect(parts('gmail.com').domainClass).toBe('freemail');
    expect(parts('mail.yahoo.co.id').domainClass).toBe('freemail');
    expect(parts('gmail.com').registrableDomain).toBe('gmail.com');
  });

  it('mengenali layanan sekali pakai', () => {
    expect(parts('mailinator.com').domainClass).toBe('disposable');
    expect(parts('sub.tempmail.com').domainClass).toBe('disposable');
  });

  it('mengenali infrastruktur pengiriman dan tidak salah memasukkan domain brand', () => {
    expect(parts('bounce.sendgrid.net').domainClass).toBe('esp');
    expect(parts('mailgun.org').domainClass).toBe('esp');

    // Kesalahan yang harus dicegah: brand sebagai ESP akan menekan mismatch pada
    // pengirim yang justru harus dinilai.
    for (const brand of ['github.com', 'google.com', 'paypal.com', 'netflix.com', 'bca.co.id']) {
      expect(parts(brand).domainClass, brand).toBe('corporate');
      expect(ESP_DOMAINS.has(brand), brand).toBe(false);
    }
  });

  it('mengenali milis, termasuk lewat awalan subdomain', () => {
    expect(parts('googlegroups.com').domainClass).toBe('mailing-list');
    expect(parts('lists.example.com').domainClass).toBe('mailing-list');
    expect(parts('mailman.example.org').domainClass).toBe('mailing-list');

    // `mail.` sengaja TIDAK dianggap milis: itu subdomain pengirim sah yang sangat
    // umum pada domain perusahaan.
    expect(parts('mail.rise.co.id').domainClass).toBe('corporate');
  });

  it('menandai host yang didelegasikan lewat suffix privat', () => {
    expect(parts('brand.github.io').domainClass).toBe('subdomain-delegated');
  });

  it('domain biasa dan IP literal tidak salah kelas', () => {
    expect(parts('rise.co.id').domainClass).toBe('corporate');
    expect(parts('192.168.1.1').isIpAddress).toBe(true);
    expect(parts('192.168.1.1').domainClass).toBe('unknown');
  });

  it('tabel data tidak saling tumpang tindih', () => {
    for (const domain of DISPOSABLE_DOMAINS) {
      expect(FREEMAIL_DOMAINS.has(domain), `${domain} ada di freemail dan disposable`).toBe(false);
    }
    for (const domain of ESP_DOMAINS) {
      expect(FREEMAIL_DOMAINS.has(domain), `${domain} ada di freemail dan esp`).toBe(false);
      expect(DISPOSABLE_DOMAINS.has(domain), `${domain} ada di disposable dan esp`).toBe(false);
    }
    for (const domain of MAILING_LIST_DOMAINS) {
      expect(FREEMAIL_DOMAINS.has(domain), `${domain} ada di freemail dan mailing-list`).toBe(false);
    }
  });
});

describe('analisis domain: punycode dan aksara campuran', () => {
  it('mengembalikan label dalam bentuk Unicode untuk perbandingan', () => {
    const result = parts('xn--pypal-4ve.com');
    expect(result.isPunycode).toBe(true);
    expect(result.registrableLabel).toBe('pаypal');
    expect(result.asciiHostname).toBe('xn--pypal-4ve.com');
  });

  it('menandai campuran aksara di dalam satu label', () => {
    expect(parts('gооgle.com').mixedScriptLabels).toContain('gооgle');
  });

  it('IDN yang sah tidak ditandai sebagai campuran', () => {
    for (const hostname of ['xn--p1ai', 'xn--fiqs8s', 'xn--h2brj9c', 'xn--3e0b707e', 'xn--warung-gva.id']) {
      expect(parts(hostname).mixedScriptLabels, hostname).toEqual([]);
    }
  });
});

describe('penguraian alamat', () => {
  it('mengambil alamat dari nilai header', () => {
    expect(extractAddressPart('Budi Santoso <budi@example.com>')).toBe('budi@example.com');
    expect(extractAddressPart('"Budi" <budi@example.com>')).toBe('budi@example.com');
    expect(extractAddressPart('budi@example.com (Budi)')).toBe('budi@example.com');
  });

  it('menggunakan @ terakhir sehingga local-part berkutip tidak salah urai', () => {
    const result = parseAddress('"a@b"@example.com');
    expect(result.hostname).toBe('example.com');
  });

  it('menandai alamat tanpa domain sebagai tidak valid, bukan menebak', () => {
    const result = parseAddress('bukan-alamat');
    expect(result.valid).toBe(false);
    expect(result.hostname).toBe('');
  });

  it('tidak pernah melempar untuk input aneh', () => {
    for (const value of ['', '@', '@@', '<>', 'a@', '@b', '   ', '<a@b@c>']) {
      expect(() => parseAddress(value), value).not.toThrow();
    }
  });

  it('menemukan alamat yang tertanam di dalam display name', () => {
    expect(findEmbeddedAddresses('support@yourbank.com')).toEqual(['support@yourbank.com']);
    expect(findEmbeddedAddresses('Bank BCA')).toEqual([]);
  });

  it('membuat kandidat local-part dari nama', () => {
    const candidates = localPartCandidates(['john', 'smith']);
    for (const expected of [
      'johnsmith',
      'john.smith',
      'john_smith',
      'jsmith',
      'smithj',
      'smithjohn',
      'smith.john',
      'js',
    ]) {
      expect(candidates, expected).toContain(expected);
    }
  });

  it('urutan nama yang diberikan tidak diasumsikan, kedua arah dihasilkan', () => {
    // Engine tidak tahu mana nama depan dan mana nama belakang, terutama untuk nama
    // Indonesia. Karena itu kedua urutan harus dihasilkan.
    const given = localPartCandidates(['smith', 'john']);
    expect(given).toContain('smithjohn');
    expect(given).toContain('johnsmith');
    expect(given).toContain('sjohn');
    expect(given).toContain('johns');
  });

  it('menangani nama tunggal', () => {
    expect(localPartCandidates(['andi'])).toEqual(['andi']);
    expect(localPartCandidates([])).toEqual([]);
  });

  it('tidak pernah menghasilkan kandidat berisi spasi', () => {
    const candidates = localPartCandidates(['john', 'smith', 'jr']);
    for (const candidate of candidates) {
      expect(candidate.length).toBeGreaterThanOrEqual(2);
      expect(candidate).not.toMatch(/\s/);
    }
  });
});
