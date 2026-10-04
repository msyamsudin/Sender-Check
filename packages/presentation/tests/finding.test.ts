import { describe, expect, it } from 'vitest';
import { analyze, type State } from '@sender-check/core';
import {
  DISCLAIMER_LINES,
  MARK,
  NO_NAME_LABEL,
  STATE_TITLE,
  contextNotes,
  senderLabel,
  shortPolarity,
  toFinding,
} from '../src/finding.ts';

/** Kasus phishing yang dilaporkan pengguna, dan yang menjadi alasan rule Tier B ada. */
const PHISHING = {
  displayName: 'Rise',
  fromAddress: 'no-reply@mngl.in',
  replyTo: 'support@riseworks.digital',
} as const;

const ALL_STATES: readonly State[] = [
  'CONSISTENT',
  'UNCLEAR',
  'INCONSISTENT',
  'UNASSESSABLE',
];

describe('model penyajian verdikt', () => {
  it('menerjemahkan kode bukti memakai args dari verdikt yang sebenarnya', () => {
    const verdict = analyze(PHISHING);
    const finding = toFinding(PHISHING, verdict);

    const shown = finding.evidence.find(
      (item) => item.code === 'REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT',
    );

    // Kalimat ini juga dikutip README dan `docs/USAGE.md`, jadi ia diuji dua kali dengan
    // cara yang berbeda: di sini `args`-nya datang dari engine sungguhan, bukan ditulis
    // tangan seperti di `sentences.test.ts`.
    expect(shown?.sentence).toBe(
      '"rise" muncul di domain tujuan balasan "riseworks.digital", tetapi tidak di domain pengirim "mngl.in"',
    );
  });

  it('kalimat diambil dari lapisan template, bukan dari trace engine', () => {
    // Sebagian `trace` engine kebetulan sudah berbentuk kalimat — `trace` untuk rule
    // Reply-To bahkan identik dengan template kanoniknya. Karena itu pembuktian bahwa
    // lapisan ini benar-benar dipakai harus memakai kode yang keduanya berbeda.
    const identity = {
      displayName: 'Shopify',
      fromAddress: 'no-reply@shopify.com',
      gmailOwnWarning: true,
    };
    const verdict = analyze(identity);

    const raw = verdict.evidence.find((item) => item.code === 'GMAIL_OWN_WARNING_PRESENT');
    const shown = toFinding(identity, verdict).evidence.find(
      (item) => item.code === 'GMAIL_OWN_WARNING_PRESENT',
    );

    expect(raw?.trace).toBe('webmail menampilkan peringatan pengirim pada pesan ini');
    expect(shown?.sentence).toBe('webmail sendiri menampilkan peringatan pada pesan ini');
    expect(shown?.sentence).not.toBe(raw?.trace);
  });

  it('meneruskan state dan confidence apa adanya', () => {
    const verdict = analyze(PHISHING);
    const finding = toFinding(PHISHING, verdict);

    expect(finding.state).toBe(verdict.state);
    expect(finding.confidence).toBe(verdict.confidence);
  });

  it('gate yang lolos tampil sebagai klaim, yang menolak tampil sebagai alasan', () => {
    const passed = toFinding(PHISHING, analyze(PHISHING));
    const refused = toFinding(
      { displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' },
      analyze({ displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' }),
    );

    expect(passed.gate).toBe('reply_to_asserts_identity');
    expect(refused.gate).toBe('personal_name_on_personal_domain');
  });

  it('keterangan "via" tetap tampil walau tidak ada yang bisa dinilai', () => {
    // Inilah alasan daftar `CONTEXT_NOTE_CODES` ada: keterangan dari webmail berguna justru
    // ketika engine memutuskan tidak menilai, dan sebelumnya keterangan itu dibuang.
    const identity = {
      displayName: 'Budi Santoso',
      fromAddress: 'budi@randomisp.co.id',
      gmailViaHint: 'sendgrid.net',
    };
    const finding = toFinding(identity, analyze(identity));
    const notes = contextNotes(finding.evidence);

    expect(finding.state).not.toBe('INCONSISTENT');
    expect(notes.join(' ')).toContain('sendgrid.net');
    expect(notes.join(' ')).toContain('GMAIL_VIA_ESP_HINT');
  });

  it('keterangan konteks tidak dipakai untuk bukti penilaian biasa', () => {
    const finding = toFinding(PHISHING, analyze(PHISHING));

    // `HUMAN_NAME_PATTERN` berpolarity konteks, tetapi bukan keterangan dari webmail,
    // sehingga ia tidak boleh muncul sebagai keterangan yang "tidak dapat dinilai".
    expect(finding.evidence.some((item) => item.code === 'HUMAN_NAME_PATTERN')).toBe(true);
    expect(contextNotes(finding.evidence).join(' ')).not.toContain('HUMAN_NAME_PATTERN');
  });

  it('setiap state punya lambang dan judul', () => {
    for (const state of ALL_STATES) {
      expect(MARK[state].length, state).toBeGreaterThan(0);
      expect(STATE_TITLE[state].length, state).toBeGreaterThan(0);
    }
  });

  it('disclaimer menyebut kedua hal yang mudah disalahpahami', () => {
    const text = DISCLAIMER_LINES.join(' ');

    expect(DISCLAIMER_LINES.length).toBeGreaterThanOrEqual(2);
    // Tanpa yang pertama, pengguna mengira keselarasan berarti keaslian. Tanpa yang kedua,
    // pengguna mengira temuan berarti emailnya berbahaya.
    expect(text).toContain('bukan bukti keaslian');
    expect(text).toContain('bukan bukti bahwa emailnya berbahaya');
  });

  it('shortPolarity membuang awalan supports_', () => {
    expect(shortPolarity('supports_inconsistency')).toBe('inconsistency');
    expect(shortPolarity('supports_consistency')).toBe('consistency');
    expect(shortPolarity('context')).toBe('context');
  });

  it('senderLabel menyebut nama dan alamat, dan menandai nama yang tidak ada', () => {
    const named = toFinding(PHISHING, analyze(PHISHING));
    const unnamed = toFinding(
      { displayName: null, fromAddress: 'no-reply@shopify.com' },
      analyze({ displayName: null, fromAddress: 'no-reply@shopify.com' }),
    );

    expect(senderLabel(named)).toBe('Rise <no-reply@mngl.in>');
    // Sebutannya diambil dari konstanta, bukan ditulis ulang di test: test yang menyalin
    // teksnya sendiri akan tetap hijau walaupun panel memakai bunyi yang berbeda.
    expect(senderLabel(unnamed)).toBe(`${NO_NAME_LABEL} <no-reply@shopify.com>`);
  });
});
