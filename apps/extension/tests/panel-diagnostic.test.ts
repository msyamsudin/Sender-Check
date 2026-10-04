import { describe, expect, it } from 'vitest';
import { analyze } from '@sender-check/core';
import { toFinding } from '@sender-check/presentation';
import { buildPanelModel, type PanelSource } from '../src/lib/panel-model.ts';

/**
 * Mode diagnostik: nilai yang sudah dihitung engine, dan sebelumnya tidak punya jalur ke DOM.
 *
 * Yang diuji di sini bukan tata letaknya — itu urusan `panel-view.ts` dan hanya terlihat di
 * browser — melainkan satu hal yang dapat dibuktikan di Node: bahwa nilai-nilai itu benar-benar
 * sampai ke model. Sebelum bagian ini ada, `confidence` keseluruhan, `gate`, seluruh baris
 * decision table, versi algoritma, dan `args`/`trace` setiap bukti hanya dapat dilihat dengan
 * debugger, walaupun semuanya sudah ada di dalam `Verdict`.
 */

/** Sumber diagnostik dari satu identitas, persis seperti yang dilakukan `scan.ts`. */
function sourceFor(
  identity: Parameters<typeof analyze>[0],
  extra: { selectorUsed?: string | null; notes?: readonly string[] } = {},
): { finding: ReturnType<typeof toFinding>; source: PanelSource } {
  const verdict = analyze(identity);
  return {
    finding: toFinding(identity, verdict),
    source: { verdict, selectorUsed: extra.selectorUsed ?? null, notes: extra.notes ?? [] },
  };
}

/** Kasus Tier B: identitas hanya diakui domain tujuan balasan — kasus yang dilaporkan. */
const TIER_B = {
  displayName: 'Rise',
  fromAddress: 'no-reply@mngl.in',
  replyTo: 'support@riseworks.digital',
  authenticationResults:
    'mx.google.com; dkim=pass header.i=@mngl.in; dmarc=pass (p=NONE sp=NONE) header.from=mngl.in',
} as const;

function summaryValue(rows: readonly { label: string; value: string }[], label: string): string {
  return rows.find((row) => row.label === label)?.value ?? '';
}

describe('mode diagnostik', () => {
  it('tidak mengubah panel biasa bila tidak diminta', () => {
    const { finding, source } = sourceFor(TIER_B);

    // Kurang dari dua argumen berarti panel biasa, dan itulah yang harus tetap terjadi pada
    // pemakaian sehari-hari: mode ini tidak boleh menambah biaya atau isi tanpa diminta.
    expect(buildPanelModel(finding).diagnostic).toBeNull();
    expect(buildPanelModel(finding, { source }).diagnostic).toBeNull();
    expect(buildPanelModel(finding, { diagnostic: true }).diagnostic).toBeNull();
  });

  it('menyebut confidence keseluruhan, yang tidak pernah muncul di panel biasa', () => {
    const { finding, source } = sourceFor(TIER_B);
    const model = buildPanelModel(finding, { diagnostic: true, source });

    expect(model.diagnostic).not.toBeNull();
    // Pengguna melihat "menentang · kuat" per bukti, tetapi tidak pernah tahu apakah
    // putusannya HIGH atau MEDIUM. Inilah yang menjawabnya.
    expect(summaryValue(model.diagnostic?.summary ?? [], 'confidence')).toBe(
      finding.confidence,
    );
    expect(summaryValue(model.diagnostic?.summary ?? [], 'state')).toBe('INCONSISTENT');
  });

  it('menampilkan versi algoritma dan PSL, yang diminta §9 dan sebelumnya tidak dibaca siapa pun', () => {
    const { finding, source } = sourceFor(TIER_B);
    const summary = buildPanelModel(finding, { diagnostic: true, source }).diagnostic?.summary ?? [];

    expect(summaryValue(summary, 'algorithmVersion')).toBe(source.verdict.algorithmVersion);
    expect(summaryValue(summary, 'pslVersion')).toBe(source.verdict.pslVersion);
    expect(summaryValue(summary, 'pslVersion')).not.toBe('');
  });

  it('membedakan kelima alasan gate, yang di panel biasa tampil identik', () => {
    const reasons = new Map<string, string>();

    for (const identity of [
      { displayName: null, fromAddress: 'no-reply@shopify.com' },
      { displayName: 'Budi Santoso', fromAddress: 'x7k2@randomisp.co.id' },
      { displayName: 'Admin', fromAddress: 'admin@randomisp.co.id' },
      { displayName: 'Budi Santoso', fromAddress: 'budi@lists.example.org' },
    ]) {
      const { finding, source } = sourceFor(identity);
      const rows = buildPanelModel(finding, { diagnostic: true, source }).diagnostic?.gate ?? [];
      reasons.set(identity.fromAddress, summaryValue(rows, 'reason'));
    }

    // `gate.ts` menyebut pembedaan `no_identity_claim` dan `personal_name_on_personal_domain`
    // dibuat "agar mode diagnostik dapat menjelaskan mengapa". Sebelum bagian ini ada,
    // pembedaan itu tidak pernah terpakai di mana pun.
    expect(reasons.get('x7k2@randomisp.co.id')).toContain('personal_name_on_personal_domain');
    expect(reasons.get('no-reply@shopify.com')).toContain('no_display_name');
    expect(reasons.get('budi@lists.example.org')).toContain('mailing_list_domain');
    expect(reasons.get('admin@randomisp.co.id')).toContain('no_identity_claim');
  });

  it('menyebut klaim mana yang lolos gate', () => {
    const { finding, source } = sourceFor(TIER_B);
    const rows = buildPanelModel(finding, { diagnostic: true, source }).diagnostic?.gate ?? [];

    expect(summaryValue(rows, 'passed')).toBe('true');
    // Nomor gerbangnya berasal dari `docs/DESIGN.md` bagian 5, sehingga hasil panel dapat
    // dicocokkan dengan dokumen desainnya.
    expect(summaryValue(rows, 'claim')).toContain('reply_to_asserts_identity');
    expect(summaryValue(rows, 'claim')).toContain('G7');
  });

  it('menampilkan seluruh baris decision table dan menandai pemenangnya', () => {
    const { finding, source } = sourceFor(TIER_B);
    const diagnostic = buildPanelModel(finding, { diagnostic: true, source }).diagnostic;

    expect(diagnostic?.rows).toHaveLength(source.verdict.trace.length);
    // Hanya satu baris yang menang: `classify` berhenti pada baris pertama yang cocok.
    expect(diagnostic?.rows.filter((row) => row.includes('← menang'))).toHaveLength(1);
    expect(diagnostic?.winner).toBe('baris 3 menentukan hasilnya');
  });

  it('membawa bukti apa adanya, termasuk args dan trace mentahnya', () => {
    const { finding, source } = sourceFor(TIER_B);
    const diagnostic = buildPanelModel(finding, { diagnostic: true, source }).diagnostic;

    // `trace` adalah bukti mentah yang ditulis untuk pengembang, dan `args` adalah yang
    // membuat kalimatnya dapat diperiksa. Keduanya dibuang `toFinding` sebelum ini.
    const replyTo = diagnostic?.reasons.find((row) => row.heading.startsWith('REPLY_TO_'));
    expect(replyTo?.trace.length ?? 0).toBeGreaterThan(0);
    expect(replyTo?.args).toContain('token=');
    expect(replyTo?.sentence).not.toBeNull();
  });

  it('tetap menampilkan bukti netral, yang panel biasa buang seluruhnya', () => {
    // `neutral` ada di kontrak `Polarity`, dan panel biasa membuang barisnya tanpa syarat.
    // Verdict tiruan dipakai di sini karena tidak ada rule yang memancarkan `neutral` hari
    // ini: `rules.ts` hanya menghasilkan `supports_*` dan `context`. Yang diuji bukan
    // perilaku engine, melainkan bahwa lapisan ini tidak membuang nilai yang dapat muncul —
    // dan bahwa barisnya muncul **tanpa kalimat**, karena kalimat akan membuatnya terbaca
    // seolah ikut dinilai.
    const { finding: withNeutral, source: baseSource } = sourceFor(TIER_B);
    const verdict: PanelSource['verdict'] = {
      ...baseSource.verdict,
      evidence: [
        ...baseSource.verdict.evidence,
        {
          code: 'HUMAN_NAME_PATTERN' as const,
          polarity: 'neutral' as const,
          strength: 'weak' as const,
          tier: 'A' as const,
          args: {},
          trace: 'display name mengikuti pola nama orang',
        },
      ],
    };

    const model = buildPanelModel(withNeutral, {
      diagnostic: true,
      source: { ...baseSource, verdict },
    });

    expect(model.reasons.some((reason) => reason.kind === 'neutral')).toBe(false);

    const neutral = model.diagnostic?.reasons.filter((row) => row.heading.includes('neutral')) ?? [];
    expect(neutral).toHaveLength(1);
    expect(neutral[0]?.sentence).toBeNull();
    expect(neutral[0]?.trace).toBe('display name mengikuti pola nama orang');
    expect(neutral[0]?.args).toBe('(tanpa argumen)');
  });

  it('menyebut selector adapter, supaya pertanyaan "selector mana yang bekerja" terjawab di tempat', () => {
    const { finding, source } = sourceFor(TIER_B, {
      selectorUsed: '[email]',
      notes: ['display name dibaca dari teks karena atribut name tidak ada'],
    });
    const summary = buildPanelModel(finding, { diagnostic: true, source }).diagnostic?.summary ?? [];

    expect(summaryValue(summary, 'selectorUsed')).toBe('[email]');

    const without = sourceFor(TIER_B);
    const empty = buildPanelModel(without.finding, { diagnostic: true, source: without.source })
      .diagnostic?.summary ?? [];
    expect(summaryValue(empty, 'selectorUsed')).toBe('(tidak ada)');
  });

  it('menyebut provenance, karena "Balas ke" yang tidak ada bukan berarti header itu tidak ada', () => {
    const tierA = sourceFor({ displayName: 'Bank BCA', fromAddress: 'bcaindonesia@gmail.com' });
    const tierB = sourceFor(TIER_B);

    const summaryA = buildPanelModel(tierA.finding, { diagnostic: true, source: tierA.source })
      .diagnostic?.summary ?? [];
    const summaryB = buildPanelModel(tierB.finding, { diagnostic: true, source: tierB.source })
      .diagnostic?.summary ?? [];

    expect(summaryValue(summaryA, 'provenance')).toContain('dom-inbox');
    expect(summaryValue(summaryB, 'provenance')).toContain('dom-original');
  });

  it('memakai kalimat yang sama persis dengan panel biasa', () => {
    // Dua tempat yang merender kalimat yang sama adalah dua versi kebenaran. Kalimatnya
    // dibentuk `describeRule` di kedua jalur, dan test ini yang menahannya begitu.
    const { finding, source } = sourceFor(TIER_B);
    const diagnostic = buildPanelModel(finding, { diagnostic: true, source }).diagnostic;

    for (const reason of finding.evidence) {
      if (reason.polarity === 'neutral') continue;
      const row = diagnostic?.reasons.find((item) => item.heading.startsWith(reason.code));
      expect(row?.sentence, reason.code).toBe(reason.sentence);
    }
  });
});
