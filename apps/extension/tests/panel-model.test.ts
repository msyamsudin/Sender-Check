import { describe, expect, it } from 'vitest';
import { analyze, type State } from '@sender-check/core';
import {
  AUTHENTICATION_CAVEAT,
  DISCLAIMER_LINES,
  NO_NAME_LABEL,
  toFinding,
} from '@sender-check/presentation';
import {
  buildPanelModel,
  unassessableBasis,
  UNASSESSABLE_BASIS,
  UNASSESSABLE_GUIDANCE,
  UNASSESSABLE_GUIDANCE_ON_HEADER,
} from '../src/lib/panel-model.ts';

const findingFor = (identity: Parameters<typeof analyze>[0]) => toFinding(identity, analyze(identity));

/** Kasus Tier A: klaim organisasi di atas surel gratis. */
const TIER_A = findingFor({ displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' });

/** Kasus Tier B: identitas hanya diakui domain tujuan balasan — kasus yang dilaporkan. */
const TIER_B = findingFor({
  displayName: 'Rise',
  fromAddress: 'no-reply@mngl.in',
  replyTo: 'support@riseworks.digital',
  authenticationResults:
    'mx.google.com; dkim=pass header.i=@mngl.in; dmarc=pass (p=NONE sp=NONE) header.from=mngl.in',
});

const ALL_STATES: readonly State[] = ['CONSISTENT', 'UNCLEAR', 'INCONSISTENT', 'UNASSESSABLE'];

describe('isi panel', () => {
  it('judul dan lambang mengikuti state, bukan istilah internalnya', () => {
    const model = buildPanelModel(TIER_A);

    expect(model.state).toBe('INCONSISTENT');
    expect(model.mark).toBe('⚠');
    expect(model.title).toBe('Nama pengirim tidak sejalan dengan alamatnya');
    expect(model.subject).toBe('Bank BCA <bcaindonesia@gmail.com>');
  });

  it('menampilkan nama dan alamat sebagai medan', () => {
    const model = buildPanelModel(TIER_A);
    const labels = model.fields.map((field) => field.label);

    expect(labels).toEqual(['Nama', 'Alamat', 'Sumber']);
    expect(model.fields[1]?.value).toBe('bcaindonesia@gmail.com');
  });

  it('menyebut dari halaman mana identitasnya dibaca', () => {
    // Beda antara "tidak ada" dan "tidak terbaca" adalah beda antara temuan dan batas alat,
    // dan pertanyaan pertama yang muncul pada panel Tier A adalah "kenapa Balas ke tidak ada?".
    // Medan ini yang menjawabnya tanpa membuka mode diagnostik.
    const tierA = buildPanelModel(TIER_A);
    const tierB = buildPanelModel(TIER_B);

    expect(tierA.fields.find((field) => field.label === 'Sumber')?.value).toBe(
      'tampilan thread (Tier A)',
    );
    expect(tierB.fields.find((field) => field.label === 'Sumber')?.value).toBe(
      'halaman header (Tier A + B)',
    );
  });

  it('menampilkan Reply-To hanya ketika ada', () => {
    // Pada Tier A, Reply-To memang tidak pernah ada di DOM. Menampilkannya sebagai tanda
    // hubung akan membuat pengguna mengira datanya hilang, padahal itu batas sumbernya.
    const tierA = buildPanelModel(TIER_A);
    const tierB = buildPanelModel(TIER_B);

    expect(tierA.fields.map((field) => field.label)).not.toContain('Balas ke');
    expect(tierB.fields.find((field) => field.label === 'Balas ke')?.value).toBe(
      'support@riseworks.digital',
    );
  });

  it('nama yang tidak ditampilkan webmail ditulis apa adanya, dengan satu sebutan saja', () => {
    // Dua tempat menuliskan keadaan yang sama: baris subjek di atas panel dan medan `Nama` di
    // dalamnya. Keduanya pernah memakai bunyi yang berbeda — `(tanpa nama)` dan
    // `(tidak ditampilkan)` — sehingga satu email yang sama memuat dua sebutan untuk hal yang
    // sama. Test ini membandingkan keduanya satu sama lain, bukan dengan teks yang disalin ke
    // sini, supaya perbedaan itu tidak dapat kembali tanpa ada yang gagal.
    const model = buildPanelModel(
      findingFor({ displayName: null, fromAddress: 'no-reply@shopify.com' }),
    );

    expect(model.fields[0]?.value).toBe(NO_NAME_LABEL);
    expect(model.subject).toBe(`${NO_NAME_LABEL} <no-reply@shopify.com>`);
  });

  it('mengurutkan bukti menurut kepentingan bagi pembaca', () => {
    // Engine memancarkan bukti dalam urutan pemeriksaan. Pada kasus ini pekerjaan itu
    // menghasilkan `mendukung` dan `konteks` lebih dulu, sehingga tanpa pengurutan panel
    // membuka dengan kalimat yang tampak menganulir temuannya sendiri.
    const model = buildPanelModel(TIER_B);
    const kinds = model.reasons.map((reason) => reason.kind);

    expect(kinds[0]).toBe('inconsistency');
    expect(kinds.indexOf('inconsistency')).toBeLessThan(kinds.indexOf('context'));
    expect(kinds.indexOf('context')).toBeLessThan(kinds.indexOf('consistency'));
  });

  it('menandai keterangan webmail sebagai konteks, bukan penilaian', () => {
    const withVia = findingFor({
      displayName: 'Shopify',
      fromAddress: 'no-reply@shopify.com',
      gmailViaHint: 'sendgrid.net',
    });
    const context = buildPanelModel(withVia).reasons.filter((reason) => reason.context);

    expect(context.length).toBeGreaterThan(0);
    expect(context.every((reason) => reason.label === 'konteks')).toBe(true);
    expect(context.map((reason) => reason.sentence).join(' ')).toContain('sendgrid.net');
  });

  it('menerjemahkan bobot bukti ke bahasa pengguna', () => {
    const model = buildPanelModel(TIER_B);
    const inconsistent = model.reasons.find((reason) => reason.kind === 'inconsistency');

    expect(inconsistent?.label).toBe('menentang');
    expect(inconsistent?.strength).toBe('kuat');
  });

  it('menyebut arti autentikasi pada kasus yang punya informasi itu', () => {
    // Ini syarat dari `docs/DESIGN.md` bagian 9, dan alasannya bukan kelengkapan: pengguna
    // sudah melihat webmailnya meluluskan pengirim ini, sehingga temuan tanpa penjelasan
    // akan tampak bertentangan dengan indikator keamanan yang sudah dipercayainya.
    const model = buildPanelModel(TIER_B);

    expect(model.authentication).toContain(AUTHENTICATION_CAVEAT);
    expect(model.authentication.join(' ')).toContain('mngl.in');
  });

  it('tidak menampilkan bagian autentikasi bila tidak ada informasinya', () => {
    expect(buildPanelModel(TIER_A).authentication).toEqual([]);
  });

  it('disclaimer ikut pada semua state, termasuk yang selaras', () => {
    // Risiko over-trust terbesar justru pada `CONSISTENT`: tidak ada apa pun di sana yang
    // terlihat perlu dipertanyakan.
    for (const state of ALL_STATES) {
      const identity =
        state === 'CONSISTENT'
          ? { displayName: 'Shopify', fromAddress: 'no-reply@shopify.com' }
          : { displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' };

      const model = buildPanelModel(findingFor(identity));
      expect(model.disclaimer.length, state).toBeGreaterThan(0);
    }

    expect(buildPanelModel(TIER_A).disclaimer).toEqual([...DISCLAIMER_LINES]);
  });

  it('setiap state punya judul yang dapat dibaca pengguna', () => {
    for (const state of ALL_STATES) {
      const identity =
        state === 'CONSISTENT'
          ? { displayName: 'Shopify', fromAddress: 'no-reply@shopify.com' }
          : state === 'UNASSESSABLE'
            ? { displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' }
            : { displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' };

      const model = buildPanelModel(findingFor(identity));
      expect(model.title.length, state).toBeGreaterThan(10);
      // Istilah internal tidak boleh bocor ke panel.
      expect(model.title, state).not.toContain(model.state);
    }
  });
});

/**
 * Bagian "apa yang belum diperiksa, dan apa yang sebaiknya dilakukan".
 *
 * State `UNASSESSABLE` berarti "belum dapat dipastikan", dan panel yang hanya menyatakan itu
 * terbaca seperti "tidak ada yang perlu dikhawatirkan". Dua kalimat di bawah ini yang
 * membedakannya: satu menjelaskan mengapa tidak ada penilaian, satu menyebut langkah aman
 * yang dapat dikerjakan pengguna — tanpa ekstensi itu sendiri mengambil apa pun dari jaringan.
 */
describe('bagian yang preventif pada state belum dapat dinilai', () => {
  const UNASSESSABLE = findingFor({ displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' });

  it('menyebut alasan dan langkah aman hanya pada state yang belum dapat dinilai', () => {
    const model = buildPanelModel(UNASSESSABLE);

    expect(model.basis).toBe(unassessableBasis(UNASSESSABLE));
    expect(model.guidance).toBe(UNASSESSABLE_GUIDANCE);

    expect(buildPanelModel(TIER_A).basis).toBeNull();
    expect(buildPanelModel(TIER_A).guidance).toBeNull();
    expect(buildPanelModel(TIER_B).guidance).toBeNull();
  });

  it('menyebut alasan gate yang sebenarnya, bukan satu kalimat untuk semuanya', () => {
    // Kelima alasan gate sebelumnya tampil identik, dengan alasan bahwa kelimanya berarti hal
    // yang sama bagi pembaca. Itu tidak berlaku untuk dua di antaranya: pada nama yang tidak
    // dirender dan pada domain milis, kalimat "nama tidak memuat klaim" justru menyatakan hal
    // yang tidak benar tentang emailnya.
    const personal = buildPanelModel(UNASSESSABLE).basis ?? '';

    expect(personal).toContain('nama orang');
    expect(personal).toContain('personal_name_on_personal_domain');

    const noName = buildPanelModel(findingFor({ displayName: null, fromAddress: 'a@b.com' })).basis ?? '';
    expect(noName).toContain('tidak merender nama');
    expect(noName).toContain('no_display_name');

    const mailingList = buildPanelModel(
      findingFor({ displayName: 'Budi Santoso', fromAddress: 'budi@lists.example.org' }),
    );
    expect(mailingList.basis ?? '').toContain('milis');
    expect(mailingList.basis ?? '').toContain('mailing_list_domain');

    // Kalimat umumnya tetap ada sebagai jaring pengaman bila engine menambah alasan baru.
    expect(UNASSESSABLE_BASIS).toContain('belum dapat dipastikan');
  });

  it('mengarahkan ke halaman header, dan tidak menjanjikan apa pun yang tidak dapat dilakukan', () => {
    // Halaman itu dirender Gmail, dan panel menilai ulang di sana. Ekstensi ini tidak
    // mengambilnya sendiri — keputusan itu dicatat di `docs/DESIGN.md` D1.
    expect(UNASSESSABLE_GUIDANCE).toContain('Tampilkan aslinya');
    expect(UNASSESSABLE_GUIDANCE).toContain('panel menilai ulang');
    // Tanpa kata-kata yang menyiratkan "aman": yang benar adalah belum diperiksa.
    expect(UNASSESSABLE_BASIS).toContain('belum dapat dipastikan');
  });

  it('tidak menyuruh membuka halaman header ketika panel sudah di halaman itu', () => {
    // "Periksa header aslinya" tidak masuk akal bagi pengguna yang sedang melihat halaman itu,
    // dan menyarankannya membuat panel terbaca tidak tahu di mana ia berada.
    const onHeader = findingFor({
      displayName: 'Budi Santoso',
      fromAddress: 'x7k2@randomisp.co.id',
      replyTo: 'budi@randomisp.co.id',
    });

    expect(onHeader.identity.provenance ?? 'dom-original').toBe('dom-original');
    expect(buildPanelModel(onHeader).guidance).toBe(UNASSESSABLE_GUIDANCE_ON_HEADER);
    expect(UNASSESSABLE_GUIDANCE_ON_HEADER).not.toContain('Tampilkan aslinya');
  });
});
