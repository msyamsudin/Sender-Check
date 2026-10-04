import { describe, expect, it } from 'vitest';
import { detectGmailView, scanGmailInbox } from '../src/gmail.ts';
import { fakeDocument, type ElementInit } from './fake-dom.ts';

/**
 * Test ini menguji **logika** adapter: urutan prioritas selector, penggabungan elemen
 * bersarang, penanganan nama yang tidak ada, dan penanganan selector yang rusak.
 *
 * Ia tidak menguji apakah selectornya benar untuk Gmail hari ini — itu diverifikasi
 * skrip konsol terhadap halaman sungguhan. Pemisahan ini disengaja: logika diuji di
 * sini, selector diuji di sana.
 */
describe('deteksi halaman Gmail', () => {
  it('mengenali inbox', () => {
    expect(detectGmailView({ href: 'https://mail.google.com/mail/u/0/#inbox' })).toBe('inbox');
    expect(detectGmailView({ href: 'https://mail.google.com/mail/u/2/#inbox' })).toBe('inbox');
  });

  it('mengenali halaman Show original, bukan inbox', () => {
    // Halaman ini juga berada di bawah /mail/u/, sehingga urutan pemeriksaan penting.
    const href = 'https://mail.google.com/mail/u/0/?ik=abc&view=om&th=xyz';
    expect(detectGmailView({ href })).toBe('show-original');
  });

  it('mengembalikan unknown untuk halaman lain', () => {
    expect(detectGmailView({ href: 'https://example.com/' })).toBe('unknown');
    expect(detectGmailView({ href: 'https://mail.google.com/' })).toBe('unknown');
  });
});

describe('pemindaian inbox: strategi selector', () => {
  it('membaca display name dan alamat dari atribut email dan name', () => {
    const doc = fakeDocument({
      tag: 'table',
      children: [
        {
          tag: 'tr',
          children: [
            { tag: 'span', attrs: { email: 'no-reply@mngl.in', name: 'Rise' }, text: 'Rise' },
          ],
        },
      ],
    });

    const report = scanGmailInbox(doc);
    expect(report.matched).toBe(true);
    expect(report.senders).toHaveLength(1);
    expect(report.senders[0]?.displayName).toBe('Rise');
    expect(report.senders[0]?.fromAddress).toBe('no-reply@mngl.in');
    expect(report.selectorUsed).toBe('span[email][name]');
  });

  it('menggabungkan elemen bersarang dan mempertahankan yang punya display name', () => {
    // Gmail sering membungkus span pengirim dengan elemen yang juga membawa `email`
    // tetapi tanpa `name`. Tanpa penggabungan, pengirim yang sama akan muncul dua kali
    // dan salah satunya tanpa nama.
    const doc = fakeDocument({
      tag: 'tr',
      children: [
        {
          tag: 'div',
          attrs: { email: 'budi@gmail.com' },
          children: [{ tag: 'span', attrs: { email: 'budi@gmail.com', name: 'Budi Santoso' } }],
        },
      ],
    });

    const report = scanGmailInbox(doc);
    expect(report.senders).toHaveLength(1);
    expect(report.senders[0]?.displayName).toBe('Budi Santoso');
  });

  it('membaca nama dari teks bila atribut name tidak ada, dan mencatatnya', () => {
    const doc = fakeDocument({
      tag: 'span',
      attrs: { email: 'andi@example.com' },
      text: 'Andi Pratama',
    });

    const report = scanGmailInbox(doc);
    expect(report.senders[0]?.displayName).toBe('Andi Pratama');
    expect(report.notes.some((note) => note.includes('dibaca dari teks'))).toBe(true);
  });

  it('memperlakukan teks yang sama dengan alamat sebagai tanpa nama', () => {
    // Ini perbedaan yang penting: Gmail menampilkan alamat karena tidak ada nama,
    // bukan karena namanya adalah alamat itu.
    const doc = fakeDocument({
      tag: 'span',
      attrs: { email: 'no-name@example.com' },
      text: 'no-name@example.com',
    });

    const report = scanGmailInbox(doc);
    expect(report.senders[0]?.displayName).toBeNull();
  });

  it('jatuh ke data-hovercard-id dan mencatat bahwa nama dibaca dari teks', () => {
    const doc = fakeDocument({
      tag: 'span',
      attrs: { 'data-hovercard-id': 'cs@bca.co.id' },
      text: 'BCA',
    });

    const report = scanGmailInbox(doc);
    expect(report.senders).toHaveLength(1);
    expect(report.senders[0]?.fromAddress).toBe('cs@bca.co.id');
    expect(report.senders[0]?.displayName).toBe('BCA');
    expect(report.selectorUsed).toBe('[data-hovercard-id]');
    expect(report.notes.some((note) => note.includes('dibaca dari teks'))).toBe(true);
  });

  it('memilih selector berprioritas tertinggi yang ikut menyumbang pengirim', () => {
    const onlyEmail = fakeDocument({
      tag: 'span',
      attrs: { email: 'a@b.com' },
      text: 'a@b.com',
    });
    const withName = fakeDocument({
      tag: 'span',
      attrs: { email: 'a@b.com', name: 'A' },
      text: 'A',
    });

    // Keduanya cocok pada beberapa kandidat, tetapi yang dilaporkan adalah kandidat
    // berprioritas tertinggi yang benar-benar menghasilkan pengirim.
    expect(scanGmailInbox(onlyEmail).selectorUsed).toBe('span[email]');
    expect(scanGmailInbox(withName).selectorUsed).toBe('span[email][name]');
  });

  it('melewati atribut email yang bukan alamat yang sah', () => {
    const doc = fakeDocument(
      { tag: 'span', attrs: { email: 'bukan-alamat' }, text: 'Rusak' },
      { tag: 'span', attrs: { email: 'sah@example.com', name: 'Sah' }, text: 'Sah' },
    );

    const report = scanGmailInbox(doc);
    expect(report.senders).toHaveLength(1);
    expect(report.senders[0]?.fromAddress).toBe('sah@example.com');
  });

  it('melaporkan no-op ketika tidak ada selector yang cocok', () => {
    // Ini yang mencegah extension gagal diam-diam ketika Gmail mengubah DOM-nya.
    const doc = fakeDocument({ tag: 'div', text: 'halaman tanpa pengirim' });

    const report = scanGmailInbox(doc);
    expect(report.matched).toBe(false);
    expect(report.selectorUsed).toBeNull();
    expect(report.senders).toEqual([]);
    expect(report.notes.some((note) => note.includes('tidak ada pengirim yang terbaca'))).toBe(true);
  });

  it('melaporkan hasil probe untuk setiap kandidat selector', () => {
    const doc = fakeDocument({
      tag: 'span',
      attrs: { email: 'a@b.com', name: 'A' },
      text: 'A',
    });

    const report = scanGmailInbox(doc);
    const selectors = report.probes.map((probe) => probe.selector);

    // Daftar probe adalah inti mode diagnostik: ia menunjukkan mana yang bekerja dan
    // mana yang tidak, alih-alih menebak.
    expect(selectors).toContain('span[email][name]');
    expect(selectors).toContain('[data-hovercard-id]');
    expect(selectors).toContain('[role="alert"]');
  });

  it('tidak melempar ketika sebuah selector tidak valid', () => {
    const doc = fakeDocument({
      tag: 'span',
      attrs: { email: 'a@b.com', name: 'A' },
      text: 'A',
    });

    // Selector yang rusak di satu kandidat tidak boleh menghentikan seluruh pemindaian.
    expect(() => scanGmailInbox(doc)).not.toThrow();
  });

  it('membaca indikator via dari penanda di dalam baris, bila kelasnya memang benar', () => {
    // PERINGATAN: test ini menguji mekanisme, bukan kenyataan Gmail. DOM di bawah dibangun
    // dari asumsi bahwa penandanya berkelas `zx`, sementara `span.zx` belum pernah cocok
    // pada satu pun halaman Gmail sungguhan (selalu 0). Jadi yang dibuktikan di sini adalah
    // bahwa pembacaan ke dalam baris bekerja SEANDAINYA kelas itu benar.
    // Lihat catatan pada VIA_ELEMENT_CLASSES di src/gmail.ts.
    //
    // Yang diuji: penanda "via" bersaudara dengan elemen pengirim di dalam baris yang sama,
    // dan baris itu juga memuat cuplikan pesan yang panjangnya melewati batas 400 karakter
    // versi sebelumnya — itulah yang membuat pembacaan lama selalu gagal.
    const doc = fakeDocument({
      tag: 'tr',
      children: [
        {
          tag: 'td',
          children: [
            { tag: 'span', attrs: { email: 'no-reply@shopify.com', name: 'Shopify' }, text: 'Shopify' },
          ],
        },
        {
          tag: 'td',
          children: [
            { tag: 'span', attrs: { class: 'zx' }, text: 'via sendgrid.net' },
            { tag: 'span', attrs: { class: 'y2' }, text: `Pesanan Anda ${'x'.repeat(500)}` },
          ],
        },
      ],
    });

    const report = scanGmailInbox(doc);
    expect(report.senders[0]?.viaHint).toBe('sendgrid.net');
  });

  it('mempertahankan indikator via ketika elemen pembungkus muncul lebih dulu', () => {
    // Elemen pembungkus dan elemen dalam sama-sama membawa atribut `email`. Penanda
    // "via" hanya dapat ditemukan dari elemen dalam, sehingga pembacaan tidak boleh
    // berhenti pada elemen pertama yang menghasilkan pengirim.
    //
    // Seperti test sebelumnya: kelas `zx` di sini adalah asumsi yang belum terverifikasi.
    const doc = fakeDocument({
      tag: 'tr',
      children: [
        {
          tag: 'div',
          attrs: { email: 'no-reply@shopify.com' },
          children: [
            {
              tag: 'span',
              attrs: { email: 'no-reply@shopify.com', name: 'Shopify' },
              text: 'Shopify',
            },
          ],
        },
        { tag: 'span', attrs: { class: 'zx' }, text: 'via sendgrid.net' },
      ],
    });

    const report = scanGmailInbox(doc);
    expect(report.senders).toHaveLength(1);
    expect(report.senders[0]?.fromAddress).toBe('no-reply@shopify.com');
    expect(report.senders[0]?.viaHint).toBe('sendgrid.net');
  });

  it('membaca indikator via dari aria-label walau tanpa elemen penanda', () => {
    // Cadangan ini pun belum terverifikasi: `[aria-label*="via"]` juga selalu 0 pada
    // probe nyata. Yang diuji hanya bahwa jalur cadangannya tidak rusak.
    const doc = fakeDocument({
      tag: 'tr',
      children: [
        { tag: 'span', attrs: { email: 'a@example.com', name: 'A' }, text: 'A' },
        { tag: 'div', attrs: { 'aria-label': 'via mailgun.org,' } },
      ],
    });

    const report = scanGmailInbox(doc);
    expect(report.senders[0]?.viaHint).toBe('mailgun.org');
  });

  it('tidak melaporkan indikator via ketika memang tidak ada', () => {
    const doc = fakeDocument({
      tag: 'tr',
      children: [
        { tag: 'span', attrs: { email: 'a@b.com', name: 'A' }, text: 'A' },
        { tag: 'span', text: 'Pesan rahasia' },
      ],
    });

    const report = scanGmailInbox(doc);
    expect(report.senders[0]?.viaHint).toBeUndefined();
  });

  it('menandai banner peringatan Gmail sebagai flag tingkat halaman', () => {
    const doc = fakeDocument(
      { tag: 'div', attrs: { role: 'alert' }, text: 'Be careful with this message' },
      { tag: 'span', attrs: { email: 'a@b.com', name: 'A' }, text: 'A' },
    );

    const report = scanGmailInbox(doc);
    expect(report.gmailOwnWarning).toBe(true);
    expect(report.notes.some((note) => note.includes('peringatan milik Gmail'))).toBe(true);
  });

  it('tidak menyalakan peringatan hanya karena ada elemen berperan alert', () => {
    // `[role="alert"]` dipakai Gmail untuk banyak hal di luar peringatan keamanan.
    // Menyalakan flag ini tanpa memeriksa isinya berarti memberi tahu pengguna
    // sesuatu yang tidak benar, dan memicu rule GMAIL_OWN_WARNING_PRESENT.
    const doc = fakeDocument(
      { tag: 'div', attrs: { role: 'alert' }, text: 'Pesan Anda telah diarsipkan' },
      { tag: 'span', attrs: { email: 'a@b.com', name: 'A' }, text: 'A' },
    );

    const report = scanGmailInbox(doc);
    expect(report.gmailOwnWarning).toBe(false);
    expect(report.notes.some((note) => note.includes('tidak satu pun berisi teks peringatan'))).toBe(
      true,
    );
  });

  it('deterministik: pemindaian yang sama menghasilkan hasil yang sama', () => {
    const build = () =>
      fakeDocument({
        tag: 'tr',
        children: [
          { tag: 'span', attrs: { email: 'a@b.com', name: 'A' }, text: 'A' },
          { tag: 'span', attrs: { email: 'c@d.com', name: 'C' }, text: 'C' },
        ],
      });

    expect(scanGmailInbox(build())).toEqual(scanGmailInbox(build()));
  });
});

/**
 * Lingkup percakapan.
 *
 * Bentuk DOM di bawah ini disusun dari probe halaman thread Gmail sungguhan: wadah pesan
 * membawa `data-message-id`, di dalamnya berurutan avatar pengirim (hanya
 * `data-hovercard-id`), baris pengirim (`email` + `name`), dan chip penerima
 * (`email` + `name`, dengan nama "saya"). Di luar wadah itu ada avatar akun, yang juga
 * membawa alamat tetapi bukan pengirim pesan mana pun.
 *
 * Yang dibuktikan test ini adalah **logikanya**: dengan lingkup percakapan, yang terbaca
 * hanya pengirim pesan, bukan chip penerima dan bukan avatar akun. Yang tidak dibuktikan
 * test ini tetap sama seperti sebelumnya: apakah bentuk DOM itu masih berlaku di Gmail
 * hari ini.
 */
describe('lingkup percakapan: satu pengirim per pesan', () => {
  const ACCOUNT_AVATAR: ElementInit = {
    tag: 'img',
    attrs: { class: 'ajn bofPge', 'data-hovercard-id': 'akun@example.com' },
  };

  /** Satu pesan pada percakapan, lengkap dengan chip penerima seperti di Gmail. */
  function message(
    messageId: string,
    from: { readonly name: string | null; readonly address: string },
    recipient: string,
  ): ElementInit {
    const senderAttrs: Record<string, string> = {
      class: 'gD',
      email: from.address,
      'data-hovercard-id': from.address,
      ...(from.name !== null ? { name: from.name } : {}),
    };

    return {
      tag: 'div',
      attrs: { 'data-message-id': messageId },
      children: [
        { tag: 'img', attrs: { class: 'ajn ajo', 'data-hovercard-id': from.address } },
        { tag: 'span', attrs: senderAttrs, text: from.name ?? from.address },
        {
          tag: 'span',
          attrs: { class: 'g2', email: recipient, name: 'saya', 'data-hovercard-id': recipient },
          text: 'saya',
        },
      ],
    };
  }

  it('mengabaikan chip penerima yang muncul setelah baris pengirim', () => {
    const doc = fakeDocument(message('#msg-f:1', { name: 'Buletin Contoh', address: 'kirim@contoh-mail.com' }, 'saya@example.com'));

    // Lingkup halaman membaca keduanya — inilah yang membuat panel pernah menjelaskan
    // alamat pengguna sendiri alih-alih pengirim pesan yang sedang dibuka.
    const page = scanGmailInbox(doc);
    expect(page.senders.map((sender) => sender.fromAddress)).toEqual([
      'kirim@contoh-mail.com',
      'saya@example.com',
    ]);

    const conversation = scanGmailInbox(doc, { scope: 'conversation' });
    expect(conversation.senders).toHaveLength(1);
    expect(conversation.senders[0]?.fromAddress).toBe('kirim@contoh-mail.com');
    expect(conversation.senders[0]?.displayName).toBe('Buletin Contoh');
    expect(conversation.selectorUsed).toBe('[email]');
  });

  it('tetap memilih baris pengirim ketika pengirim tidak menampilkan nama', () => {
    // Chip penerima punya atribut `name`, pengirim tidak. Aturan yang mendahulukan
    // `[email][name]` akan memilih penerima justru pada kasus ini.
    const doc = fakeDocument(message('#msg-f:2', { name: null, address: 'tanpa-nama@contoh-mail.com' }, 'saya@example.com'));

    const report = scanGmailInbox(doc, { scope: 'conversation' });
    expect(report.senders).toHaveLength(1);
    expect(report.senders[0]?.fromAddress).toBe('tanpa-nama@contoh-mail.com');
    expect(report.senders[0]?.displayName).toBeNull();
  });

  it('mengabaikan elemen beralamat di luar wadah pesan', () => {
    const doc = fakeDocument(
      ACCOUNT_AVATAR,
      message('#msg-f:3', { name: 'Buletin Contoh', address: 'kirim@contoh-mail.com' }, 'saya@example.com'),
    );

    const report = scanGmailInbox(doc, { scope: 'conversation' });
    expect(report.senders.map((sender) => sender.fromAddress)).toEqual(['kirim@contoh-mail.com']);
  });

  it('membaca satu pengirim per pesan pada percakapan berbalas', () => {
    const doc = fakeDocument(
      message('#msg-f:4', { name: 'Buletin Contoh', address: 'kirim@contoh-mail.com' }, 'saya@example.com'),
      message('#msg-f:5', { name: 'Saya', address: 'saya@example.com' }, 'kirim@contoh-mail.com'),
    );

    const report = scanGmailInbox(doc, { scope: 'conversation' });
    expect(report.senders.map((sender) => sender.fromAddress)).toEqual([
      'kirim@contoh-mail.com',
      'saya@example.com',
    ]);
  });

  it('tidak menampilkan pengirim bila penanda pesan tidak ada, dan mencatatnya', () => {
    // Jatuh kembali ke seluruh halaman pernah dianggap benar di sini. Probe halaman
    // sungguhan membuktikan sebaliknya: pada halaman ber-URL thread, DOM dapat berisi
    // daftar inbox, dan membaca seluruh halaman saat itu berarti menjelaskan pengirim
    // mana pun yang temuannya paling berat. Panel kosong lebih baik daripada panel salah.
    const doc = fakeDocument({ tag: 'span', attrs: { email: 'a@b.com', name: 'A' }, text: 'A' });

    const report = scanGmailInbox(doc, { scope: 'conversation' });
    expect(report.matched).toBe(false);
    expect(report.senders).toHaveLength(0);
    expect(report.notes.some((note) => note.includes('tidak ada pengirim yang ditampilkan'))).toBe(
      true,
    );
  });

  it('mengabaikan wadah pesan yang tidak menyediakan pengirim', () => {
    const doc = fakeDocument(
      { tag: 'div', attrs: { 'data-message-id': '#msg-f:6' }, children: [{ tag: 'div', text: 'belum dimuat' }] },
      message('#msg-f:7', { name: 'Buletin Contoh', address: 'kirim@contoh-mail.com' }, 'saya@example.com'),
    );

    const report = scanGmailInbox(doc, { scope: 'conversation' });
    expect(report.senders.map((sender) => sender.fromAddress)).toEqual(['kirim@contoh-mail.com']);
  });
});
