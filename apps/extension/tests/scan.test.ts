import { describe, expect, it } from 'vitest';
import { FakeDocument, fakeDocument, type ElementInit } from '../../../packages/adapters/tests/fake-dom.ts';
import { analyzePage, diagnosticSourceFor, pickPrimary } from '../src/lib/scan.ts';

/**
 * Pengujian dari halaman ke temuan.
 *
 * DOM tiruan berasal dari `packages/adapters/tests/fake-dom.ts` — helper yang sama yang
 * dipakai test adapter. Menulis helper kedua untuk hal yang sama akan membuat dua versi
 * kebenaran tentang bentuk DOM yang diuji, dan itu justru yang ingin dihindari.
 *
 * Yang tidak dapat diuji di sini tetap sama: apakah selector-nya cocok dengan Gmail hari
 * ini. Itu hanya terjawab oleh halaman sungguhan.
 */
const THREAD_ID = 'FMfcgzQhWfTQKcgkqjfRTgcjdqRfjvSM';
const U = 'https://mail.google.com/mail/u/0/';

const at = (href: string): { href: string } => ({ href });

/** Satu baris pada list view. Panel tidak pernah memindai halaman ini; ia dipakai test URL. */
function senderRow(displayName: string, address: string): ElementInit {
  return {
    tag: 'tr',
    children: [
      {
        tag: 'td',
        children: [{ tag: 'span', attrs: { email: address, name: displayName }, text: displayName }],
      },
      {
        tag: 'td',
        children: [{ tag: 'span', attrs: { class: 'y2' }, text: 'Cuplikan pesan yang tidak dibaca adapter.' }],
      },
    ],
  };
}

/**
 * Satu pesan pada percakapan yang terbuka.
 *
 * Wadah `data-message-id` bukan hiasan: panel memakai lingkup percakapan, dan probe
 * halaman thread sungguhan menunjukkan bahwa setiap pesan dibungkus penanda itu. Test yang
 * membangun pengirim tanpa wadah menguji bentuk DOM yang tidak pernah ada di Gmail, dan
 * karena itu tidak lagi menggambarkan perilaku panel.
 */
function conversationMessage(messageId: string, displayName: string, address: string): ElementInit {
  return {
    tag: 'div',
    attrs: { 'data-message-id': messageId },
    children: [senderRow(displayName, address)],
  };
}

/** Halaman Show original: header mentah di dalam satu elemen, diikuti badan pesan. */
function showOriginalPage(fromLine: string, withReplyTo: boolean): FakeDocument {
  const headers = [
    'Delivered-To: penerima@example.com',
    'Return-Path: <no-reply@mngl.in>',
    'Authentication-Results: mx.google.com; dkim=pass header.i=@mngl.in; dmarc=pass (p=NONE sp=NONE) header.from=mngl.in',
    'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=mngl.in; s=google',
    'Received: by smtp.gmail.com with ESMTPSA id 46e09a7af769',
    `From: ${fromLine}`,
    'To: penerima@example.com',
    ...(withReplyTo ? ['Reply-To: support@riseworks.digital'] : []),
    'Subject: tidak pernah dibaca',
    '',
    'Badan pesan tidak dibaca adapter.',
  ];

  return fakeDocument({ tag: 'pre', text: headers.join('\n') });
}

describe('analisis thread terbuka', () => {
  it('menghasilkan temuan untuk pengirim yang terbaca', () => {
    const doc = fakeDocument(conversationMessage('#msg-f:1', 'Bank BCA', 'bcaindonesia@gmail.com'));
    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));

    expect(analysis.kind).toBe('thread');
    expect(analysis.matched).toBe(true);
    expect(analysis.selectorUsed).toBe('[email]');
    expect(analysis.findings).toHaveLength(1);
    expect(analysis.primary?.state).toBe('INCONSISTENT');
  });

  it('meneruskan indikator "via" dan peringatan webmail sebagai konteks', () => {
    const doc = fakeDocument(
      { tag: 'div', attrs: { role: 'alert' }, text: 'Be careful with this message' },
      {
        tag: 'div',
        attrs: { 'data-message-id': '#msg-f:2' },
        children: [
          {
            tag: 'tr',
            children: [
              {
                tag: 'td',
                children: [
                  { tag: 'span', attrs: { email: 'no-reply@shopify.com', name: 'Shopify' }, text: 'Shopify' },
                ],
              },
              { tag: 'td', children: [{ tag: 'span', attrs: { class: 'zx' }, text: 'via sendgrid.net' }] },
            ],
          },
        ],
      },
    );

    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));
    const codes = analysis.primary?.evidence.map((item) => item.code) ?? [];

    expect(codes).toContain('GMAIL_VIA_ESP_HINT');
    expect(codes).toContain('GMAIL_OWN_WARNING_PRESENT');
  });

  it('memilih temuan yang paling perlu diperiksa, bukan yang pertama', () => {
    const doc = fakeDocument(
      conversationMessage('#msg-f:3', 'Budi Santoso', 'x7k2@randomisp.co.id'),
      conversationMessage('#msg-f:4', 'Bank BCA', 'bcaindonesia@gmail.com'),
    );

    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));

    expect(analysis.findings).toHaveLength(2);
    // Yang pertama justru UNASSESSABLE, dan menampilkannya berarti menyembunyikan
    // satu-satunya temuan yang punya isi.
    expect(analysis.findings[0]?.state).toBe('UNASSESSABLE');
    expect(analysis.primary?.identity.displayName).toBe('Bank BCA');
  });

  it('tidak menampilkan apa pun ketika wadah percakapan tidak ada', () => {
    // Halaman ber-URL thread dapat berisi daftar inbox saja — mis. saat berpindah atau
    // sebelum percakapan selesai digambar. Probe nyata menemukan 103 elemen pengirim di
    // keadaan itu, termasuk alamat penerima. Membaca seluruh halaman di sana berarti
    // menjelaskan pengirim yang salah dengan yakin, jadi yang benar adalah diam.
    const doc = fakeDocument(senderRow('Bank BCA', 'bcaindonesia@gmail.com'));

    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));

    expect(analysis.kind).toBe('thread');
    expect(analysis.matched).toBe(false);
    expect(analysis.findings).toHaveLength(0);
    expect(analysis.primary).toBeNull();
  });

  it('membaca pengirim dari wadah pesan, bukan dari daftar di halaman yang sama', () => {
    const doc = fakeDocument(
      senderRow('The5ers', 'help@the5ers.com'),
      conversationMessage('#msg-f:1876976281163979898', 'Rise', 'no-reply@mngl.in'),
    );

    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));

    expect(analysis.findings).toHaveLength(1);
    expect(analysis.primary?.identity.fromAddress).toBe('no-reply@mngl.in');
  });

  it('menilai pengirim pesan, bukan chip penerima di dalam pesan yang sama', () => {
    // Bentuk ini berasal dari probe halaman thread sungguhan: di dalam satu pesan ada dua
    // elemen beralamat — baris pengirim dan chip penerima ("to saya"). Chip itu bukan
    // pengirim, dan karena `pickPrimary` memilih temuan terberat, membacanya berarti panel
    // menjelaskan alamat pengguna sendiri untuk setiap email yang dibuka.
    const doc = fakeDocument({
      tag: 'div',
      attrs: { 'data-message-id': '#msg-f:1877944133024641448' },
      children: [
        { tag: 'img', attrs: { class: 'ajn ajo', 'data-hovercard-id': 'kirim@contoh-mail.com' } },
        {
          tag: 'span',
          attrs: { class: 'gD', email: 'kirim@contoh-mail.com', name: 'Buletin Contoh' },
          text: 'Buletin Contoh',
        },
        {
          tag: 'span',
          attrs: { class: 'g2', email: 'saya@example.com', name: 'saya' },
          text: 'saya',
        },
      ],
    });

    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));

    expect(analysis.findings).toHaveLength(1);
    expect(analysis.primary?.identity.fromAddress).toBe('kirim@contoh-mail.com');
    expect(analysis.findings.some((finding) => finding.identity.fromAddress === 'saya@example.com')).toBe(
      false,
    );
  });
});

describe('analisis halaman Show original', () => {
  it('membaca Tier B dan menilai kasus Reply-To', () => {
    const analysis = analyzePage(showOriginalPage('Rise <no-reply@mngl.in>', true), at(`${U}?view=om&th=x`));

    expect(analysis.kind).toBe('show-original');
    expect(analysis.matched).toBe(true);
    expect(analysis.primary?.state).toBe('INCONSISTENT');
    expect(analysis.primary?.identity.replyTo).toBe('support@riseworks.digital');

    const sentences = analysis.primary?.evidence.map((item) => item.sentence).join(' ') ?? '';
    expect(sentences).toContain('riseworks.digital');
  });

  it('tidak mengarang penilaian ketika header tidak terbaca', () => {
    // Tanpa blok header, tidak ada dasar untuk menilai. Yang benar adalah tidak menampilkan
    // apa pun, bukan menampilkan panel dengan identitas kosong.
    const analysis = analyzePage(fakeDocument({ tag: 'pre', text: 'tidak ada header di sini' }), at(`${U}?view=om&th=x`));

    expect(analysis.matched).toBe(false);
    expect(analysis.primary).toBeNull();
    expect(analysis.notes.join(' ')).toContain('header From tidak terbaca');
  });

  it('Tier A yang sama tetap UNASSESSABLE tanpa header', () => {
    // Kasus yang sama, dua tingkat bukti, dua kesimpulan berbeda. Perbedaan inilah yang
    // membuat halaman Show original bukan pelengkap, melainkan satu-satunya sumber sinyal
    // untuk kelas serangan Reply-To.
    const tierA = analyzePage(
      fakeDocument(conversationMessage('#msg-f:5', 'Rise', 'no-reply@mngl.in')),
      at(`${U}#inbox/${THREAD_ID}`),
    );

    expect(tierA.primary?.state).toBe('UNASSESSABLE');
  });
});

describe('halaman yang sengaja tidak ditangani', () => {
  it('list view tidak menghasilkan temuan', () => {
    const doc = fakeDocument(senderRow('Bank BCA', 'bcaindonesia@gmail.com'));
    const analysis = analyzePage(doc, at(`${U}#inbox`));

    expect(analysis.kind).toBe('list');
    expect(analysis.matched).toBe(false);
    expect(analysis.primary).toBeNull();
    // DOM tetap dipindai hanya bila halamannya thread; pada list view tidak ada pemindaian
    // sama sekali, sehingga selectorUsed pun kosong.
    expect(analysis.selectorUsed).toBeNull();
  });

  it('halaman bukan Gmail tidak menghasilkan temuan', () => {
    const doc = fakeDocument(senderRow('Bank BCA', 'bcaindonesia@gmail.com'));
    const analysis = analyzePage(doc, at('https://example.com/'));

    expect(analysis.kind).toBe('other');
    expect(analysis.primary).toBeNull();
  });

  it('thread tanpa pengirim yang terbaca tidak menampilkan apa pun', () => {
    // Bentuk DOM yang tidak dikenali: hasil yang benar adalah diam.
    const analysis = analyzePage(fakeDocument({ tag: 'div', text: 'DOM yang berubah' }), at(`${U}#inbox/${THREAD_ID}`));

    expect(analysis.kind).toBe('thread');
    expect(analysis.matched).toBe(false);
    expect(analysis.primary).toBeNull();
  });
});

/**
 * Verdikt mentah untuk mode diagnostik.
 *
 * `SenderFinding` sengaja hanya memuat yang ditampilkan panel biasa, sehingga `gate`, seluruh
 * baris `trace`, `algorithmVersion`, dan `pslVersion` tidak dapat disusun ulang dari sana.
 * Peta inilah jalurnya, dan test ini memastikan jalur itu benar-benar terisi — bukan hanya
 * bahwa tipenya ada.
 */
describe('sumber diagnostik', () => {
  it('membawa verdikt mentah dan selector per temuan', () => {
    const doc = fakeDocument(conversationMessage('#msg-f:9', 'Bank BCA', 'bcaindonesia@gmail.com'));
    const analysis = analyzePage(doc, at(`${U}#inbox/${THREAD_ID}`));
    const source = diagnosticSourceFor(analysis, analysis.primary);

    expect(source).not.toBeNull();
    expect(source?.verdict.state).toBe(analysis.primary?.state);
    expect(source?.verdict.trace.length).toBeGreaterThan(0);
    expect(source?.verdict.algorithmVersion.length).toBeGreaterThan(0);
    expect(source?.verdict.pslVersion.length).toBeGreaterThan(0);
    // Selector per temuan, bukan hanya selector halaman: pada halaman dengan beberapa
    // pengirim, dua hal itu dapat berbeda.
    expect(source?.selectorUsed).toBe('[email]');
  });

  it('membawa verdikt halaman header, yang tidak punya selector', () => {
    const analysis = analyzePage(showOriginalPage('Rise <no-reply@mngl.in>', true), at(`${U}?view=om&th=x`));
    const source = diagnosticSourceFor(analysis, analysis.primary);

    expect(source?.verdict.gate.passed).toBe(true);
    // Halaman itu membaca satu blok teks, bukan satu elemen per pengirim, jadi tidak ada
    // selector yang dapat disebut — dan itu jawabannya, bukan medan yang hilang.
    expect(source?.selectorUsed).toBeNull();
  });

  it('tidak punya sumber apa pun ketika tidak ada yang dinilai', () => {
    const analysis = analyzePage(fakeDocument(senderRow('Bank BCA', 'bcaindonesia@gmail.com')), at(`${U}#inbox`));

    expect(analysis.primary).toBeNull();
    expect(diagnosticSourceFor(analysis, analysis.primary)).toBeNull();
  });
});

describe('pemilihan temuan utama', () => {  const finding = (state: 'CONSISTENT' | 'UNCLEAR' | 'INCONSISTENT' | 'UNASSESSABLE') =>
    ({ state }) as unknown as Parameters<typeof pickPrimary>[0][number];

  it('urutan kepentingannya INCONSISTENT > UNCLEAR > UNASSESSABLE > CONSISTENT', () => {
    const ordered = [
      finding('CONSISTENT'),
      finding('UNASSESSABLE'),
      finding('UNCLEAR'),
      finding('INCONSISTENT'),
    ];

    expect(pickPrimary(ordered)?.state).toBe('INCONSISTENT');
    expect(pickPrimary([finding('CONSISTENT'), finding('UNCLEAR')])?.state).toBe('UNCLEAR');
    expect(pickPrimary([finding('CONSISTENT'), finding('UNASSESSABLE')])?.state).toBe('UNASSESSABLE');
  });

  it('mempertahankan urutan asli ketika kepentingannya sama', () => {
    const first = finding('CONSISTENT');
    expect(pickPrimary([first, finding('CONSISTENT')])).toBe(first);
  });

  it('daftar kosong menghasilkan null', () => {
    expect(pickPrimary([])).toBeNull();
  });
});
