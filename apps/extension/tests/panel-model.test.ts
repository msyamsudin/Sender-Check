import { describe, expect, it } from 'vitest';
import { analyze, type State } from '@sender-check/core';
import { AUTHENTICATION_CAVEAT, DISCLAIMER_LINES, toFinding } from '@sender-check/presentation';
import { buildPanelModel } from '../src/lib/panel-model.ts';

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

    expect(labels).toEqual(['Nama', 'Alamat']);
    expect(model.fields[1]?.value).toBe('bcaindonesia@gmail.com');
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

  it('nama yang tidak ditampilkan webmail ditulis apa adanya', () => {
    const model = buildPanelModel(findingFor({ displayName: null, fromAddress: 'no-reply@shopify.com' }));

    expect(model.fields[0]?.value).toBe('(tidak ditampilkan)');
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
