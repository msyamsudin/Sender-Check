import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze.ts';
import { resolveIdentity } from '../src/identity.ts';
import type { EmailIdentity, RuleCode, Verdict } from '../src/types.ts';

function codes(verdict: Verdict): RuleCode[] {
  return verdict.evidence.map((item) => item.code);
}

function strongInconsistencyCodes(verdict: Verdict): RuleCode[] {
  return verdict.evidence
    .filter((item) => item.polarity === 'supports_inconsistency' && item.strength === 'strong')
    .map((item) => item.code);
}

describe('alur end-to-end: kecocokan', () => {
  it('nama yang sama dengan domain adalah CONSISTENT', () => {
    const verdict = analyze({ displayName: 'Rise', fromAddress: 'support@rise.com' });
    expect(verdict.state).toBe('CONSISTENT');
    expect(codes(verdict)).toContain('DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL');
  });

  it('nama yang tercermin pada local-part adalah CONSISTENT', () => {
    const verdict = analyze({ displayName: 'John Smith', fromAddress: 'john.smith@example.com' });
    expect(verdict.state).toBe('CONSISTENT');
    expect(codes(verdict)).toContain('DISPLAY_NAME_MATCHES_LOCALPART_EXACT');
  });

  it('nama tunggal pada domain corporate yang sepadan adalah CONSISTENT', () => {
    const verdict = analyze({ displayName: 'Kompas', fromAddress: 'redaksi@kompas.com' });
    expect(verdict.state).toBe('CONSISTENT');
  });
});

describe('alur end-to-end: inkonsistensi', () => {
  it('domain homoglyph Cyrillic terdeteksi sebagai inkonsistensi kuat', () => {
    // "gооgle" dengan о Cyrillic.
    const verdict = analyze({ displayName: 'Google', fromAddress: 'support@gооgle.com' });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('CONFUSABLE_MATCH_TO_TOKEN');
  });

  it('token brand yang hanya muncul di subdomain terdeteksi', () => {
    const verdict = analyze({
      displayName: 'PayPal',
      fromAddress: 'support@paypal.com.secure-login.xyz',
    });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY');
  });

  it('klaim organisasi di atas freemail terdeteksi', () => {
    const verdict = analyze({ displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME');
  });

  it('display name yang memuat alamat lain terdeteksi', () => {
    const verdict = analyze({
      displayName: 'support@yourbank.com',
      fromAddress: 'support@evil-lookalike.xyz',
    });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('DISPLAY_NAME_EMBEDS_OTHER_ADDRESS');
  });

  it('typosquat dengan huruf ganda pada label registrable terdeteksi', () => {
    const verdict = analyze({ displayName: 'BCA', fromAddress: 'cs@bcaa.co.id' });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('LOOKALIKE_NEAR_MISS');
  });

  it('substitusi digit pada label registrable terdeteksi', () => {
    const verdict = analyze({ displayName: 'BRI', fromAddress: 'cs@br1.co.id' });
    expect(verdict.state).toBe('INCONSISTENT');
  });

  it('brand sebagai kata tersendiri di domain lain terdeteksi', () => {
    const verdict = analyze({ displayName: 'BCA', fromAddress: 'cs@bca-klik.com' });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT');
  });
});

describe('alur end-to-end: UNASSESSABLE dipakai ketika dasar tidak cukup', () => {
  it('tanpa display name', () => {
    const verdict = analyze({ displayName: null, fromAddress: 'john.smith@example.com' });
    expect(verdict.state).toBe('UNASSESSABLE');
    expect(codes(verdict)).toContain('NO_DISPLAY_NAME');
  });

  it('display name berupa string kosong diperlakukan sama seperti null', () => {
    const verdict = analyze({ displayName: '', fromAddress: 'john.smith@example.com' });
    expect(verdict.state).toBe('UNASSESSABLE');
    expect(codes(verdict)).toContain('NO_DISPLAY_NAME');
  });

  it('display name hanya berisi peran layanan', () => {
    const verdict = analyze({ displayName: 'Admin', fromAddress: 'admin@example.com' });
    expect(verdict.state).toBe('UNASSESSABLE');
    expect(codes(verdict)).toContain('GENERIC_TOKEN_ONLY_DISPLAYNAME');
  });

  it('nama manusia pada alamat acak TIDAK dianggap mismatch', () => {
    // Ini kasus paling penting di seluruh engine. Memperlakukannya sebagai mismatch
    // akan membuat hampir seluruh inbox bersinyal, dan extension akan dimatikan
    // pengguna dalam hitungan hari.
    const verdict = analyze({ displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' });
    expect(verdict.state).toBe('UNASSESSABLE');
    expect(verdict.gate.passed).toBe(false);
    expect(verdict.gate.reason).toBe('personal_name_on_personal_domain');
  });

  it('pengirim milis tidak dinilai', () => {
    const verdict = analyze({ displayName: 'Budi Santoso', fromAddress: 'budi@googlegroups.com' });
    expect(verdict.state).toBe('UNASSESSABLE');
    expect(codes(verdict)).toContain('MAILING_LIST_DOMAIN');
  });

  it('display name yang hanya mengulang local-part bukan klaim yang diperiksa', () => {
    // Identitas yang sama dengan alamatnya tidak memberi tahu apa pun tentang
    // pengirimnya.
    const verdict = analyze({ displayName: 'Kementerian Keuangan', fromAddress: 'info@example.com' });
    expect(['UNASSESSABLE', 'UNCLEAR']).toContain(verdict.state);
  });
});

describe('gate: bukti tidak pernah bocor dari penilaian yang tidak dilakukan', () => {
  it('ketika gate gagal, tidak ada bukti pendukung atau penentang yang disimpan', () => {
    const verdict = analyze({ displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' });
    for (const item of verdict.evidence) {
      expect(['context', 'neutral'], item.code).toContain(item.polarity);
    }
  });
});

describe('provenance', () => {
  it('diturunkan menjadi dom-original bila ada field Tier B', () => {
    expect(resolveIdentity({ displayName: 'A', fromAddress: 'a@b.com', replyTo: 'c@d.com' }).provenance).toBe(
      'dom-original',
    );
    expect(
      resolveIdentity({ displayName: 'A', fromAddress: 'a@b.com', returnPath: 'bounce@sendgrid.net' })
        .provenance,
    ).toBe('dom-original');
  });

  it('default dom-inbox bila tidak ada field Tier B', () => {
    expect(resolveIdentity({ displayName: 'A', fromAddress: 'a@b.com' }).provenance).toBe('dom-inbox');
  });

  it('provenance eksplisit selalu menang', () => {
    expect(
      resolveIdentity({ displayName: 'A', fromAddress: 'a@b.com', provenance: 'dom-inbox' }).provenance,
    ).toBe('dom-inbox');
  });

  it('sinyal Tier B tidak pernah dipakai ketika provenance adalah dom-inbox', () => {
    const base: EmailIdentity = { displayName: 'Rise', fromAddress: 'support@rise.com' };
    const inbox = analyze({ ...base, provenance: 'dom-inbox', replyTo: 'attacker@evil.xyz' });
    expect(codes(inbox)).not.toContain('REPLY_TO_DOMAIN_MISMATCH');

    const original = analyze({ ...base, provenance: 'dom-original', replyTo: 'attacker@evil.xyz' });
    expect(codes(original)).toContain('REPLY_TO_DOMAIN_MISMATCH');
  });
});

describe('Tier B: penyampaian lewat ESP tidak dihukum', () => {
  it('Return-Path ESP tidak memicu mismatch', () => {
    const verdict = analyze({
      displayName: 'Shopify',
      fromAddress: 'no-reply@shopify.com',
      returnPath: 'bounce@sendgrid.net',
      authenticationResults:
        'mx.google.com; dkim=pass header.i=@shopify.com; spf=pass smtp.mailfrom=bounce@sendgrid.net; dmarc=pass header.from=shopify.com',
    });
    expect(verdict.state).not.toBe('INCONSISTENT');
    expect(codes(verdict)).not.toContain('RETURN_PATH_NULL_OR_MISMATCH');
  });

  it('indikator "via" Gmail juga menekan mismatch Return-Path', () => {
    const verdict = analyze({
      displayName: 'Shopify',
      fromAddress: 'no-reply@shopify.com',
      gmailViaHint: 'sendgrid.net',
      returnPath: 'bounce@sendgrid.net',
    });
    expect(codes(verdict)).toContain('GMAIL_VIA_ESP_HINT');
    expect(codes(verdict)).not.toContain('RETURN_PATH_NULL_OR_MISMATCH');
  });

  it('DMARC gagal sendirian tidak pernah menjadi INCONSISTENT', () => {
    // Authentication mengautentikasi domain, bukan display name.
    const verdict = analyze({
      displayName: 'Rise',
      fromAddress: 'support@rise.com',
      authenticationResults: 'mx.google.com; dmarc=fail (p=NONE) header.from=rise.com',
    });
    expect(verdict.state).not.toBe('INCONSISTENT');
    expect(codes(verdict)).toContain('AUTH_DMARC_FAIL');
  });

  it('authentication PASS tidak pernah menjadi bukti kuat', () => {
    // DMARC pass hanya membuktikan bahwa domain itu menandatangani pesannya sendiri.
    const verdict = analyze({
      displayName: 'Evil Bank',
      fromAddress: 'cs@evil-bank.xyz',
      authenticationResults:
        'mx.google.com; dkim=pass header.i=@evil-bank.xyz; dmarc=pass header.from=evil-bank.xyz',
    });
    const aligned = verdict.evidence.find((item) => item.code === 'AUTH_ALIGNED_PASS');
    expect(aligned?.strength).toBe('medium');
    expect(aligned?.polarity).toBe('supports_consistency');
  });

  it('authentication PASS tidak menyelamatkan display name yang tidak berkaitan dengan domain', () => {
    const verdict = analyze({
      displayName: 'Bank BCA',
      fromAddress: 'cs@totally-unrelated.xyz',
      authenticationResults: 'mx.google.com; dmarc=pass header.from=totally-unrelated.xyz',
    });
    // Domain itu memang menandatangani pesannya sendiri; itu tidak membuat klaim
    // "Bank BCA" menjadi benar.
    expect(verdict.state).not.toBe('CONSISTENT');
    expect(codes(verdict)).toContain('ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN');
  });
});

describe('Tier B: identitas yang hanya diakui domain Reply-To', () => {
  /**
   * Kasus nyata yang dilaporkan pengguna: email dengan display name "Rise" dikirim
   * dari `no-reply@mngl.in` — domain yang tidak memuat "rise" sama sekali — dengan
   * Reply-To `support@riseworks.digital` yang memuatnya. SPF, DKIM, dan DMARC
   * semuanya lulus untuk `mngl.in`, sehingga autentikasi tidak memberi sinyal apa pun
   * dan webmail tidak menampilkan peringatan.
   */
  const reported: EmailIdentity = {
    displayName: 'Rise',
    fromAddress: 'no-reply@mngl.in',
    replyTo: 'support@riseworks.digital',
    returnPath: 'no-reply@mngl.in',
  };

  it('mendeteksi identitas yang muncul di Reply-To tetapi tidak di From', () => {
    const verdict = analyze(reported);
    expect(verdict.state).toBe('INCONSISTENT');
    expect(verdict.confidence).toBe('HIGH');
    expect(strongInconsistencyCodes(verdict)).toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
    expect(verdict.gate.claim).toBe('reply_to_asserts_identity');
  });

  it('mengenali token sebagai komponen berpenyekat di domain Reply-To', () => {
    const verdict = analyze({ ...reported, replyTo: 'support@rise-kyc.digital' });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('tidak mendeteksi apa pun tanpa header Show original, dan itu memang benar', () => {
    // Batas Tier A/Tier B harus jujur: tanpa Reply-To, display name dan alamat memang
    // tidak punya hubungan yang dapat diperiksa. Engine tidak boleh mengarang dasar.
    const verdict = analyze({ displayName: 'Rise', fromAddress: 'no-reply@mngl.in' });
    expect(verdict.state).toBe('UNASSESSABLE');
    expect(codes(verdict)).not.toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('tidak menyala ketika domain From dan Reply-To sama-sama mengakui identitas', () => {
    const verdict = analyze({
      displayName: 'Rise',
      fromAddress: 'no-reply@riseworks.digital',
      replyTo: 'support@riseworks.digital',
      returnPath: 'bounce@sendgrid.net',
    });
    expect(verdict.state).not.toBe('INCONSISTENT');
    expect(codes(verdict)).not.toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('tidak menyala ketika Reply-To berada di domain registrable yang sama', () => {
    const verdict = analyze({
      displayName: 'Rise',
      fromAddress: 'no-reply@mail.riseworks.digital',
      replyTo: 'support@riseworks.digital',
    });
    expect(codes(verdict)).not.toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('tidak menyala ketika domain Reply-To tidak mengklaim identitas tersebut', () => {
    // Dukungan pelanggan yang dialihdayakan ke penyedia pihak ketiga adalah pola sah.
    const verdict = analyze({
      displayName: 'Acme',
      fromAddress: 'no-reply@acme.com',
      replyTo: 'ticket-9931@helpdesk-provider.com',
      returnPath: 'bounce@mailgun.org',
    });
    expect(codes(verdict)).not.toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
    expect(verdict.state).not.toBe('INCONSISTENT');
  });

  it('dikecualikan ketika domain From adalah infrastruktur pengiriman yang dikenal', () => {
    // Sebagian ESP mengirim dengan domainnya sendiri sebagai From atas nama klien.
    // Itu konfigurasi yang lazim dan sah, sehingga tidak boleh dihukum.
    const verdict = analyze({
      displayName: 'Acme',
      fromAddress: 'no-reply@sendgrid.net',
      replyTo: 'support@acme.com',
      returnPath: 'bounce@sendgrid.net',
    });
    expect(codes(verdict)).not.toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('indikator "via" TIDAK menekan rule ini', () => {
    // Keputusan yang disengaja. "Via" menjelaskan mengapa Return-Path berbeda dari
    // From, tetapi tidak menjelaskan mengapa identitas yang diklaim justru muncul di
    // domain tujuan balasan dan bukan di domain pengirim. Menekan rule ini karena
    // "via" akan membuka kembali justru kasus yang paling perlu ditangkap.
    const verdict = analyze({
      ...reported,
      gmailViaHint: 'mngl.in',
    });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('tidak pernah menyala pada provenance dom-inbox', () => {
    const verdict = analyze({ ...reported, provenance: 'dom-inbox' });
    expect(codes(verdict)).not.toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('pola yang sama terdeteksi pada konteks merek Indonesia', () => {
    const verdict = analyze({
      displayName: 'Bank Mandiri',
      fromAddress: 'no-reply@klikmail.co',
      replyTo: 'verifikasi@mandiri-klik.id',
      returnPath: 'bounce@klikmail.co',
    });
    expect(verdict.state).toBe('INCONSISTENT');
    expect(strongInconsistencyCodes(verdict)).toContain('REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT');
  });

  it('tidak cukup bila Reply-To hanya berbeda domain tanpa mengklaim identitas', () => {
    // Reply-To yang berbeda domain, sendirian, hanya bukti menengah. Ini yang menjaga
    // agar pemindahan balasan yang sah tidak langsung dianggap penipuan.
    const verdict = analyze({
      displayName: 'Rise',
      fromAddress: 'no-reply@riseworks.digital',
      replyTo: 'billing@payment-processor.com',
    });
    expect(strongInconsistencyCodes(verdict)).not.toContain(
      'REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT',
    );
    expect(verdict.state).not.toBe('INCONSISTENT');
  });
});

describe('determinisme dan kemurnian hasil', () => {
  const inputs: readonly EmailIdentity[] = [
    { displayName: 'Rise', fromAddress: 'support@rise.com' },
    { displayName: 'Google', fromAddress: 'support@gооgle.com' },
    { displayName: null, fromAddress: 'a@b.com' },
    {
      displayName: 'Bank BCA',
      fromAddress: 'cs@bca.co.id',
      replyTo: 'x@evil.xyz',
      returnPath: 'bounce@sendgrid.net',
      authenticationResults: 'mx.google.com; dmarc=fail header.from=bca.co.id',
    },
  ];

  it('input yang sama menghasilkan verdikt yang sama persis', () => {
    for (const input of inputs) {
      expect(analyze(input)).toEqual(analyze(input));
    }
  });

  it('hasil tidak memuat medan skor apa pun', () => {
    // Bukan gaya penulisan: begitu ada satu angka, seluruh keputusan akan mulai
    // bergantung padanya dan penjelasan yang dapat diverifikasi hilang.
    const verdict = analyze(inputs[0] as EmailIdentity);
    const keys = Object.keys(verdict);
    for (const forbidden of ['score', 'phishingScore', 'risk', 'riskScore', 'probability']) {
      expect(keys).not.toContain(forbidden);
    }
    for (const item of verdict.evidence) {
      expect(Object.keys(item)).not.toContain('score');
    }
  });

  it('menyertakan versi algoritma dan versi PSL untuk cache dan audit', () => {
    const verdict = analyze(inputs[0] as EmailIdentity);
    expect(verdict.algorithmVersion.length).toBeGreaterThan(0);
    expect(verdict.pslVersion.length).toBeGreaterThan(0);
  });

  it('seluruh bukti memuat trace yang dapat dibaca manusia', () => {
    for (const input of inputs) {
      const verdict = analyze(input);
      for (const item of verdict.evidence) {
        expect(item.trace.length, `${item.code} tanpa trace`).toBeGreaterThan(0);
      }
    }
  });

  it('tidak pernah menghasilkan teks kalimat jadi di dalam engine', () => {
    // Semua teks dibentuk di lapisan UI dari code + args, supaya mengubah copy tidak
    // berarti mengubah engine.
    const verdict = analyze({ displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' });
    for (const item of verdict.evidence) {
      expect(item.args).toBeTypeOf('object');
      expect(item).not.toHaveProperty('message');
      expect(item).not.toHaveProperty('text');
    }
  });
});

describe('input yang tidak dapat dipercaya tidak pernah menghentikan analisis', () => {
  const hostile: readonly EmailIdentity[] = [
    { displayName: 'x'.repeat(5000), fromAddress: 'a@b.com' },
    { displayName: '\u0000\u0001\u0002', fromAddress: 'a@b.com' },
    { displayName: 'a@b@c@d', fromAddress: 'a@b@c@d' },
    { displayName: 'Rise', fromAddress: 'tidak-ada-domain' },
    { displayName: 'Rise', fromAddress: '@' },
    { displayName: 'Rise', fromAddress: '' },
    { displayName: '<>', fromAddress: 'a@b.com' },
    { displayName: 'test', fromAddress: 'a@xn--!!!.com' },
    { displayName: 'test', fromAddress: 'a@[192.168.1.1]' },
  ];

  it('tidak melempar untuk input apa pun', () => {
    for (const input of hostile) {
      expect(() => analyze(input), JSON.stringify(input).slice(0, 60)).not.toThrow();
    }
  });

  it('selalu mengembalikan state yang terdefinisi', () => {
    const allowed = new Set(['CONSISTENT', 'UNCLEAR', 'INCONSISTENT', 'UNASSESSABLE']);
    for (const input of hostile) {
      expect(allowed.has(analyze(input).state)).toBe(true);
    }
  });
});
