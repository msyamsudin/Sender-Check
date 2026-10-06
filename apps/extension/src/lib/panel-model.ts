/**
 * Isi panel, sebagai data — bukan sebagai DOM.
 *
 * Berkas ini memutuskan **apa yang ditampilkan**, dan `panel-view.ts` hanya menuangkannya
 * ke elemen. Pemisahan itu yang membuat isi panel dapat diuji di Node: tidak ada satu pun
 * `document` di sini, sehingga test dapat memeriksa kalimat, urutan, dan pilihan medan
 * tanpa browser dan tanpa jsdom.
 *
 * Empat keputusan tampilan ada di berkas ini, dan keempatnya punya alasan:
 *
 * **1. Semua kalimat berasal dari `@sender-check/presentation`.** Panel tidak menyusun
 * kalimatnya sendiri, karena itu akan menjadi salinan ketiga dari teks yang sama.
 *
 * **2. Bukti diurutkan menurut kepentingan, bukan menurut urutan rule.** Engine memancarkan
 * bukti dalam urutan pemeriksaan, dan urutan itu masuk akal untuk mesin tetapi tidak untuk
 * manusia: pengguna perlu melihat yang menentang lebih dulu, baru konteks dari webmail,
 * lalu yang mendukung.
 *
 * **3. Disclaimer ikut pada setiap state, termasuk `CONSISTENT`.** `docs/DESIGN.md`
 * menetapkan itu, dan alasannya ada di `DISCLAIMER_LINES`.
 *
 * **4. `diagnostic` hanya diisi bila mode diagnostik diminta.** Isinya adalah nilai mentah
 * engine yang tidak pernah ditampilkan panel biasa. Yang perlu ditegaskan di sini: mode itu
 * **tidak** mengubah satu pun keputusan di atas. Ia menambahkan bagian, bukan menggantikan;
 * panel biasa dan panel diagnostik menyatakan hal yang sama, dan yang kedua hanya menyebutkan
 * dasarnya.
 */
import { resolveProvenance, PSL_UPDATED_AT, PSL_VERSION, type State, type Verdict } from '@sender-check/core';
import {
  AUTHENTICATION_CAVEAT,
  DISCLAIMER_LINES,
  MARK,
  NO_NAME_LABEL,
  POLARITY_LABEL,
  STATE_TITLE,
  STRENGTH_LABEL,
  diagnosticFrom,
  formatArgs,
  isContextNote,
  senderLabel,
  shortPolarity,
  type DiagnosticRow,
  type DiagnosticTraceRow,
  type SenderFinding,
} from '@sender-check/presentation';
export interface PanelField {
  readonly label: string;
  readonly value: string;
}
export interface PanelReason {
  /** Polaritas singkat, untuk gaya: `inconsistency`, `consistency`, `context`, `neutral`. */
  readonly kind: string;
  /** Nama polaritas untuk pengguna, mis. `menentang`. */
  readonly label: string;
  /** Nama bobot untuk pengguna, mis. `kuat`. */
  readonly strength: string;
  readonly sentence: string;
  /** `true` bila ini keterangan dari webmail, bukan bagian dari penilaian. */
  readonly context: boolean;
}

/** Satu baris `gate` pada bagian diagnostik. */
export interface PanelGateRow {
  readonly label: string;
  readonly value: string;
}

/**
 * Bagian diagnostik, sudah dalam bentuk yang siap digambar.
 *
 * Bentuknya sengaja "satu daftar baris label/nilai", bukan sekumpulan medan bernama: mode ini
 * menampilkan apa adanya nilai internal, dan medan bernama akan membuat `panel-view.ts` ikut
 * mengetahui nama setiap nilai. Yang perlu diketahui lapisan tampilan hanyalah cara menggambar
 * daftar.
 */
export interface PanelDiagnostic {
  /** Nama setiap bagian, dengan alasan singkatnya — dibaca sebagai judul. */
  readonly summary: readonly DiagnosticRow[];
  readonly gate: readonly PanelGateRow[];
  /**
   * Seluruh baris decision table, ditambah baris mana yang menang.
   *
   * Pemenangnya dinyatakan sebagai nomor baris, bukan sebagai `boolean` per baris, karena
   * kalimatnya lebih pendek: "baris 3 menang" menjelaskan seluruh daftar sekaligus.
   */
  readonly rows: readonly string[];
  readonly winner: string | null;
  /** Daftar kode bukti — termasuk yang tidak ditampilkan panel. */
  readonly codes: string;
  /**
   * Catatan adapter, apa adanya: kenapa sebuah selector dipakai, kenapa nama jatuh ke teks,
   * kenapa halaman tidak menghasilkan apa pun.
   *
   * Kosong bila adapter tidak mencatat apa pun — dan barisnya tetap digambar oleh lapisan
   * tampilan, karena "tidak ada catatan" dan "catatan tidak ditampilkan" adalah dua hal
   * yang berbeda, dan membedakan keduanya adalah fungsi mode diagnostik ini.
   */
  readonly notes: readonly string[];
  /** Satu baris per kode bukti: polaritas, kekuatan, kalimat, `args`, dan trace mentahnya. */
  readonly reasons: readonly PanelDiagnosticReason[];
}

/** Satu bukti di bagian diagnostik, lengkap dengan yang tidak pernah sampai ke panel biasa. */
export interface PanelDiagnosticReason {
  /** `CODE · polarity/strength · tier` — satu baris agar daftarnya tetap terbaca. */
  readonly heading: string;
  /** Kalimat yang dipakai panel biasa, atau `null` untuk bukti netral. */
  readonly sentence: string | null;
  /** Argumen template, apa adanya. */
  readonly args: string;
  readonly trace: string;
}

/**
 * Bahan yang hanya diketahui pemanggil, dan hanya dibutuhkan mode diagnostik.
 *
 * `verdict` tidak dapat disusun ulang dari `SenderFinding`: `toFinding` sengaja merangkumnya
 * menjadi kalimat. Karena itu pemanggil yang memegang verdikt meneruskannya di sini — dan
 * hanya ketika mode diagnostik diminta.
 */
export interface PanelSource {
  readonly verdict: Verdict;
  readonly selectorUsed?: string | null;
  readonly notes?: readonly string[];
}

export interface PanelOptions {
  /** `true` menambahkan bagian diagnostik. Default `false`: panel biasa tidak berubah. */
  readonly diagnostic?: boolean;
  readonly source?: PanelSource;
}

export interface PanelModel {
  /** State mentah, dipakai untuk memberi gaya pada kartu. */
  readonly state: State;
  readonly mark: string;
  readonly title: string;
  /** `Nama <alamat>`, bentuk yang sama dengan yang dipakai skrip konsol. */
  readonly subject: string;
  readonly fields: readonly PanelField[];
  readonly reasons: readonly PanelReason[];
  /**
   * Kalimat hasil autentikasi, plus satu kalimat tetap tentang artinya.
   *
   * Kosong bila tidak ada informasi autentikasi sama sekali — dan itu memang keadaan Tier A
   * di DOM inbox, karena `Authentication-Results` hanya ada di halaman Show original.
   */
  readonly authentication: readonly string[];
  /**
   * Kalimat yang menyatakan batas halaman ini, atau `null`.
   *
   * Ada hanya pada state `UNASSESSABLE` di halaman thread: di situ panel memang tidak
   * menemukan klaim yang dapat diuji, dan pengguna berhak tahu **mengapa** — bukan hanya
   * bahwa tidak ada dasar.
   */
  readonly basis: string | null;
  /**
   * Langkah aman yang dapat dikerjakan pengguna, atau `null`.
   *
   * Ini bagian yang preventif: `UNASSESSABLE` berarti "belum dapat dipastikan", dan kalimat
   * yang hanya menyatakan itu terbaca seperti "tidak ada yang perlu dikhawatirkan". Yang
   * benar adalah sebaliknya — belum ada yang diperiksa — dan pengguna perlu tahu apa yang
   * harus dilakukan sebelum mempercayai email itu.
   */
  readonly guidance: string | null;
  readonly disclaimer: readonly string[];
  /**
   * Baris versi di footer — `pslVersion` dan `pslUpdatedAt` keduanya, seperti yang diminta
   * `docs/DESIGN.md` bagian 6.6.
   *
   * Nilainya diambil dari daftar yang **dibundel**, bukan dari `Verdict.pslVersion`:
   * footer menyatakan alat mana yang dipakai halaman ini, sedangkan verdikt bisa saja
   * menulis `unknown` karena sebuah hostname tidak dapat diurai — dan "PSL unknown" pada
   * footer akan terbaca sebagai kerusakan padahal itu keadaan yang benar.
   */
  readonly footer: readonly string[];
  /**
   * Isi mode diagnostik, atau `null` bila mode itu tidak diminta.
   *
   * Semua yang ada di sini sudah dihitung engine dan sebelumnya tidak punya jalur ke DOM:
   * `confidence` keseluruhan, `gate` beserta klaimnya, seluruh baris decision table, versi
   * algoritma dan PSL, provenance, dan setiap bukti apa adanya — termasuk yang dibuang panel
   * (`neutral`).
   */
  readonly diagnostic: PanelDiagnostic | null;
  /**
   * Seluruh isi panel sebagai satu teks, siap disalin pengguna lewat tombol "Salin laporan".
   *
   * Berkas ini memutuskan apa yang ditampilkan — dan laporan itu **adalah** panel, dalam
   * bentuk yang dapat ditempel di tempat lain. Karena itu ia dibentuk dari model yang sama,
   * bukan dari temuan secara terpisah: dua jalur akan menghasilkan dua versi kebenaran untuk
   * satu email, dan versi yang salah justru yang disalin keluar dari panel.
   *
   * Ia tidak memuat subjek maupun isi pesan, persis seperti panelnya — batas privasi di
   * `docs/DESIGN.md` bagian 9 berlaku untuk apa pun yang keluar dari panel.
   */
  readonly report: string;
}

/**
 * Kenapa panel tidak menilai, per alasan gate.
 *
 * Sebelumnya satu kalimat tetap untuk kelima alasan, dengan alasan bahwa kelimanya berarti
 * hal yang sama bagi pembaca. Itu benar untuk dua di antaranya dan **salah** untuk tiga
 * sisanya, dan bedanya adalah hal yang paling sering ditanyakan pengguna:
 *
 *  - `no_display_name` — webmail tidak merender nama sama sekali. Tidak ada yang salah dengan
 *    pengirimnya; tidak ada yang bisa dibandingkan.
 *  - `mailing_list_domain` — pengirimnya milis, dan engine memang menolak menilai milis.
 *    Kalimat "nama tidak memuat klaim" **tidak benar** di sini: nama pengirim milis justru
 *    sering memuat nama orang.
 *  - `no_identity_claim` vs `personal_name_on_personal_domain` — dua keadaan yang berbeda, dan
 *    `evaluateGate` sengaja membedakannya (lihat komentarnya di
 *    `packages/core/src/evidence/gate.ts`). Yang pertama berarti tidak ada token identitas
 *    sama sekali; yang kedua berarti ada nama orang, dan nama orang di domain perorangan
 *    bukan anomali.
 *
 * Nama token internalnya disebut di ujung kalimat, dalam tanda kurung. Itu satu-satunya
 * kosakata yang dipakai bersama `docs/DESIGN.md`, `docs/USAGE.md`, dan `gate.ts`, sehingga
 * pengguna yang membaca dokumen dapat mencocokkannya dengan yang dilihatnya.
 */
const GATE_REASON_BASIS: Record<string, string> = {
  no_display_name:
    'Pesan ini tidak merender nama pengirim sama sekali, sehingga tidak ada yang dapat dibandingkan dengan alamatnya. Ini batas tampilan webmail, bukan penilaian tentang pengirimnya. (no_display_name)',
  mailing_list_domain:
    'Alamat pengirim ini berada di domain milis, dan pengirim milis memang tidak dinilai: nama yang tampil di situ adalah nama pengirim pesan ke milis, bukan identitas pemilik domain. (mailing_list_domain)',
  no_identity_claim:
    'Nama yang ditampilkan tidak memuat klaim identitas apa pun yang dapat diuji terhadap alamatnya, sehingga pengirim ini belum dapat dipastikan dari tampilan pesan. (no_identity_claim)',
  personal_name_on_personal_domain:
    'Nama yang ditampilkan adalah nama orang, dan alamatnya bukan alamat organisasi. Nama orang di alamat perorangan bukan anomali, jadi tidak ada yang dapat diuji di sini. (personal_name_on_personal_domain)',
};

/**
 * Kalimat yang dipakai bila alasan gate tidak dikenali.
 *
 * Bukan kehati-hatian berlebihan: `GateReason` dapat bertambah di engine sebelum lapisan ini
 * ikut berubah, dan panel yang menampilkan bagian kosong pada keadaan itu lebih buruk daripada
 * panel yang menyatakan batasnya secara umum.
 */
export const UNASSESSABLE_BASIS =
  'Nama yang ditampilkan tidak memuat klaim yang dapat diuji terhadap alamatnya, sehingga pengirim ini belum dapat dipastikan dari tampilan pesan.';

/**
 * Alasan tidak menilai untuk satu temuan.
 *
 * `gate` pada `SenderFinding` sudah berbentuk alasan bila gate menolak, dan berbentuk klaim
 * bila gate lolos — jadi nilainya hanya dipakai ketika state-nya memang `UNASSESSABLE`.
 */
export function unassessableBasis(finding: SenderFinding): string {
  return GATE_REASON_BASIS[finding.gate] ?? UNASSESSABLE_BASIS;
}

/**
 * Langkah aman untuk state `UNASSESSABLE`.
 *
 * Menyebut halaman "Show original" dengan namanya sendiri adalah satu-satunya cara pengguna
 * dapat memperoleh dasar penilaian, dan itu **tidak** memerlukan apa pun dari ekstensi:
 * halaman itu dirender Gmail, dan panel menilai ulang di sana. Ekstensi ini tidak mengambil
 * halaman itu sendiri — lihat catatan keputusan di `docs/DESIGN.md` D1.
 */
export const UNASSESSABLE_GUIDANCE =
  'Sebelum menekan tautan atau mengisi data di email ini, periksa header aslinya: menu ⋮ → "Tampilkan aslinya". Di halaman itu panel menilai ulang memakai "balas ke" dan hasil autentikasi.';

/**
 * Langkah aman ketika panel sudah berada di halaman header.
 *
 * Di sini "periksa header aslinya" tidak masuk akal: pengguna sedang melihatnya. Yang tersisa
 * adalah keadaan yang sebenarnya — panel sudah memakai semua yang ada di halaman itu, dan
 * yang tidak ada di sana tidak dapat diperiksa dari mana pun.
 */
export const UNASSESSABLE_GUIDANCE_ON_HEADER =
  'Panel ini sudah membaca seluruh header yang tersedia di halaman ini, termasuk "balas ke" dan hasil autentikasi. Bila tidak ada klaim identitas di dalamnya, tidak ada lagi yang dapat diperiksa dari pesan ini.';

/** Urutan bobot untuk pengurutan. `strong` lebih dulu. */
const STRENGTH_ORDER: Record<string, number> = { strong: 0, medium: 1, weak: 2 };

/** Urutan polaritas untuk pengurutan: yang menentang lebih dulu. */
const POLARITY_ORDER: Record<string, number> = {
  inconsistency: 0,
  context: 1,
  consistency: 2,
  neutral: 3,
};

/**
 * Menyusun urutan bukti untuk manusia.
 *
 * Bukan sekadar kosmetik: pada kasus Reply-To, bukti `mendukung` (autentikasi lulus) muncul
 * dari rule yang dievaluasi lebih dulu, sehingga tanpa pengurutan panel akan membuka dengan
 * kalimat yang tampak menganulir temuannya sendiri.
 */
function orderReasons(finding: SenderFinding): PanelReason[] {
  const reasons: PanelReason[] = [];

  for (const item of finding.evidence) {
    const kind = shortPolarity(item.polarity);
    if (kind === 'neutral') continue;

    reasons.push({
      kind,
      label: POLARITY_LABEL[kind] ?? kind,
      strength: STRENGTH_LABEL[item.strength] ?? item.strength,
      sentence: item.sentence,
      context: isContextNote(item),
    });
  }

  return reasons.sort((a, b) => {
    const polarity = (POLARITY_ORDER[a.kind] ?? 9) - (POLARITY_ORDER[b.kind] ?? 9);
    if (polarity !== 0) return polarity;
    return (STRENGTH_ORDER[a.strength] ?? 9) - (STRENGTH_ORDER[b.strength] ?? 9);
  });
}

/**
 * Daftar medan identitas.
 *
 * Hanya medan yang benar-benar ada yang ditampilkan. Medan kosong yang ditampilkan sebagai
 * tanda hubung akan membuat pengguna mengira datanya hilang — padahal pada Tier A, Reply-To
 * memang tidak pernah ada di DOM, dan itu bukan kekurangan data melainkan batas sumbernya.
 *
 * Teks untuk nama yang tidak ada berasal dari `@sender-check/presentation`, sama dengan yang
 * dipakai baris subjek di atas daftar ini. Dulu keduanya menulis bunyi yang berbeda untuk
 * keadaan yang sama, dan `NO_NAME_LABEL` ada supaya itu tidak dapat terjadi lagi.
 */
function buildFields(finding: SenderFinding): PanelField[] {
  const { identity } = finding;
  const fields: PanelField[] = [
    { label: 'Nama', value: identity.displayName ?? NO_NAME_LABEL },
    { label: 'Alamat', value: identity.fromAddress },
  ];

  if (identity.replyTo !== undefined && identity.replyTo.length > 0) {
    fields.push({ label: 'Balas ke', value: identity.replyTo });
  }
  if (identity.returnPath !== undefined && identity.returnPath.length > 0) {
    fields.push({ label: 'Dikirim oleh', value: identity.returnPath });
  }

  // `Sumber` menjawab pertanyaan yang paling mudah salah dibaca pada panel ini: "kenapa
  // 'Balas ke' tidak muncul?". Pada halaman thread, jawabannya bukan bahwa header itu tidak
  // ada, melainkan bahwa halaman itu memang tidak memuatnya — dan beda antara "tidak ada"
  // dan "tidak terbaca" adalah beda antara temuan dan batas alat.
  //
  // Nilainya diturunkan `resolveProvenance`, fungsi engine yang sama yang dipakai
  // `resolveIdentity`, bukan dibaca langsung dari `identity.provenance`: field itu biasanya
  // kosong, dan engine yang mengisinya saat resolusi.
  fields.push({
    label: 'Sumber',
    value:
      resolveProvenance(identity) === 'dom-original'
        ? 'halaman header (Tier A + B)'
        : 'tampilan thread (Tier A)',
  });

  return fields;
}

function buildAuthentication(finding: SenderFinding): string[] {
  const authEvidence = finding.evidence.filter((item) => item.code.startsWith('AUTH_'));
  const hasRawHeader = (finding.identity.authenticationResults ?? '').length > 0;

  if (authEvidence.length === 0 && !hasRawHeader) return [];

  // Kalimat tetapnya selalu ikut ketika ada informasi autentikasi, termasuk ketika semua
  // hasilnya lulus. Justru pada keadaan itulah kalimat ini paling dibutuhkan: pengguna
  // sudah melihat "aman" di webmailnya, dan temuan ini tampak bertentangan dengannya.
  return [...authEvidence.map((item) => item.sentence), AUTHENTICATION_CAVEAT];
}

/**
 * Ringkasan baris-baris decision table.
 *
 * Semua baris yang tercatat dicetak, termasuk yang tidak dievaluasi: `classify` berhenti pada
 * baris pertama yang cocok, sehingga baris sesudahnya tidak pernah diuji. Yang menjawab
 * "kenapa hasilnya begini" adalah baris pemenangnya, dan ia ditandai — tanpa penanda itu,
 * daftar ini terbaca seolah sembilan baris semuanya diperiksa.
 */
function buildTrace(rows: readonly DiagnosticTraceRow[]): string[] {
  return rows.map((row) => {
    const marker = row.winner ? '← menang' : row.matched ? '(cocok)' : '(tidak diuji)';
    return `baris ${row.row}  ${marker}  ${row.condition}`;
  });
}

/**
 * Isi mode diagnostik.
 *
 * Satu-satunya tempat di ekstensi yang menyentuh nilai mentah engine. Yang dibuangnya hanya
 * satu hal: bukti `neutral` tidak diberi kalimat, karena panel biasa memang tidak
 * menampilkannya — tetapi barisnya tetap ada di sini, lengkap dengan trace-nya, dan justru
 * itulah bedanya "tidak ditampilkan" dan "tidak ada".
 */
function buildDiagnostic(finding: SenderFinding, source: PanelSource): PanelDiagnostic {
  const diagnostic = diagnosticFrom(finding.identity, source.verdict, {
    selectorUsed: source.selectorUsed ?? null,
    notes: source.notes ?? [],
  });

  const winnerRow = diagnostic.trace[diagnostic.traceWinner ?? -1] ?? null;

  return {
    summary: diagnostic.summary,
    gate: diagnostic.gate,
    rows: buildTrace(diagnostic.trace),
    winner: winnerRow === null ? null : `baris ${winnerRow.row} menentukan hasilnya`,
    codes: diagnostic.evidence.map((row) => row.code).join('  ') || '(tidak ada bukti)',
    notes: diagnostic.notes,
    reasons: diagnostic.evidence.map((row) => ({
      heading: `${row.code} · ${row.polarity}/${row.strength} · tier ${row.tier}`,
      sentence: row.sentence,
      args: formatArgs(row.args),
      trace: row.trace,
    })),
  };
}

/**
 * Baris versi di footer panel.
 *
 * Satu baris, bukan dua: keduanya menerangkan **satu** hal yang sama — daftar suffix mana
 * yang berlaku dan seberapa baru daftar itu — dan dipisah menjadi dua baris akan membuat
 * footer tumbuh tanpa menambah informasi. Formatnya sama dengan yang dipakai laporan corpus
 * (`tools/corpus/src/harness.ts`), supaya angka yang dilihat pengguna dan angka yang dilihat
 * pengembang dapat dicocokkan.
 */
function buildFooter(): string[] {
  return [`PSL ${PSL_VERSION} · diperbarui ${PSL_UPDATED_AT}`];
}

/**
 * Laporan teks dari isi panel.
 *
 * Satu fungsi, dipanggil sekali di akhir `buildPanelModel`, sehingga tombol "Salin laporan"
 * tidak pernah dapat menyalin sesuatu yang berbeda dari yang sedang dilihat pengguna.
 * Urutannya sama dengan urutan panel: kepala, medan, alasan, autentikasi, bagian preventif,
 * disclaimer, lalu baris versi.
 */
function buildReport(model: Omit<PanelModel, 'report'>): string {
  const lines: string[] = [
    'Laporan Sender-Check',
    '',
    `${model.mark} ${model.title}`,
    model.subject,
    '',
  ];

  // Label diratakan dengan spasi, bukan ditulis dengan lebar tetap: `Dikirim oleh` lebih
  // panjang dari yang lain, dan lebar tetap akan membuat kolomnya miring.
  const width = model.fields.reduce((max, field) => Math.max(max, field.label.length), 0);
  for (const field of model.fields) {
    lines.push(`${field.label.padEnd(width)} : ${field.value}`);
  }

  lines.push('', 'Mengapa:');
  if (model.reasons.length === 0) {
    lines.push('(tidak ada bukti yang dapat ditampilkan)');
  } else {
    for (const reason of model.reasons) {
      const tag = reason.context ? reason.label : `${reason.label} · ${reason.strength}`;
      lines.push(`- [${tag}] ${reason.sentence}`);
    }
  }

  if (model.authentication.length > 0) {
    lines.push('', 'Autentikasi:');
    for (const sentence of model.authentication) lines.push(`- ${sentence}`);
  }

  if (model.basis !== null || model.guidance !== null) {
    lines.push('');
    if (model.basis !== null) lines.push(model.basis);
    if (model.guidance !== null) lines.push(model.guidance);
  }

  lines.push('', ...model.disclaimer, '', ...model.footer);
  return lines.join('\n');
}

/**
 * Isi panel dari satu temuan.
 *
 * `basis` dan `guidance` diisi hanya untuk state `UNASSESSABLE`: itulah satu-satunya state
 * yang berarti "belum ada yang diperiksa", dan karena itu satu-satunya yang perlu menjelaskan
 * mengapa, lalu menyebut langkah aman yang dapat dikerjakan pengguna.
 *
 * `options.diagnostic` menambahkan bagian diagnostik, dan `options.source` yang menyediakan
 * isinya. Keduanya opsional supaya pemanggil yang hanya ingin panel biasa — dan test yang
 * memeriksanya — tidak perlu memegang verdikt mentah.
 */
export function buildPanelModel(finding: SenderFinding, options: PanelOptions = {}): PanelModel {
  const unassessable = finding.state === 'UNASSESSABLE';
  const onHeader = resolveProvenance(finding.identity) === 'dom-original';
  const { source } = options;

  let guidance: string | null = null;
  if (unassessable) {
    guidance = onHeader ? UNASSESSABLE_GUIDANCE_ON_HEADER : UNASSESSABLE_GUIDANCE;
  }

  const base: Omit<PanelModel, 'report'> = {
    state: finding.state,
    mark: MARK[finding.state],
    title: STATE_TITLE[finding.state],
    subject: senderLabel(finding),
    fields: buildFields(finding),
    reasons: orderReasons(finding),
    authentication: buildAuthentication(finding),
    basis: unassessable ? unassessableBasis(finding) : null,
    guidance,
    disclaimer: DISCLAIMER_LINES,
    footer: buildFooter(),
    diagnostic:
      options.diagnostic === true && source !== undefined
        ? buildDiagnostic(finding, source)
        : null,
  };

  return { ...base, report: buildReport(base) };
}
