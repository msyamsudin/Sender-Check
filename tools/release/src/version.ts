/**
 * Keputusan versi untuk rilis otomatis.
 *
 * Seluruh fungsi di berkas ini murni: masukannya daftar commit dan versi, keluarannya versi
 * berikutnya. Pemisahan itu disengaja, karena aturan di sini adalah **satu-satunya bagian rilis
 * yang tidak diperiksa manusia** — rilisnya berjalan tanpa siapa pun menekan tombol, sehingga
 * satu-satunya penjaganya adalah test di `tools/release/tests/`.
 *
 * Aturan yang dipakai sengaja condong ke **sisi yang salahnya murah**:
 *
 *  - Tipe commit yang tidak dikenal dihitung sebagai `patch`, bukan diabaikan. Commit yang tidak
 *    menghasilkan rilis berarti perubahan yang tidak pernah sampai ke pengguna.
 *  - `ALGORITHM_VERSION` naik `patch` bila berkas apa pun di `packages/core/src` berubah, bukan
 *    hanya bila rule atau ambangnya berubah. Menebak terlalu sering hanya membuang cache verdikt
 *    pengguna; menebak terlalu jarang membuat hasil analisis lama terus dipakai setelah engine
 *    berubah. Yang kedua jauh lebih buruk, jadi biasnya ke arah yang pertama.
 */

/**
 * Satu commit, apa adanya dari `git log`: judul dan badan (badan memuat isi pull request).
 *
 * `sha` ikut dibawa karena dipakai sebagai penunjuk ketika badan commit dipotong: judul hasil
 * squash merge dari antarmuka web memuat nomor pull request, tetapi squash merge yang dijalankan
 * dari CLI dengan `--subject` tidak — dan penunjuk yang tidak menunjuk ke mana pun tidak berguna.
 */
export interface Commit {
  readonly subject: string;
  readonly body: string;
  readonly sha?: string;
}

export type Bump = 'major' | 'minor' | 'patch';

/** Kelompok bagian catatan rilis. */
export type ChangeKind = 'added' | 'changed' | 'fixed' | 'docs' | 'internal';

/**
 * Judul commit yang ditulis otomatisasi rilis itu sendiri.
 *
 * Dikecualikan dari perhitungan, karena kalau tidak, rilis pertama akan membuat rilis kedua:
 * commit `chore(release): 0.4.0` terlihat seperti perubahan biasa, dan perubahan nol baris pun
 * cukup untuk memicu `patch` berikutnya.
 */
const RELEASE_COMMIT = /^chore\(release\):/;

const CONVENTIONAL = /^([a-z]+)(?:\([^)]*\))?(!)?:\s*/;

const TYPE_TO_KIND: Readonly<Record<string, ChangeKind>> = {
  feat: 'added',
  fix: 'fixed',
  perf: 'changed',
  refactor: 'changed',
  revert: 'changed',
  docs: 'docs',
  chore: 'internal',
  ci: 'internal',
  build: 'internal',
  test: 'internal',
  style: 'internal',
};

/** Urutan bagian di catatan rilis; yang paling ingin dibaca pengguna lebih dulu. */
const KIND_ORDER: readonly ChangeKind[] = ['added', 'changed', 'fixed', 'docs', 'internal'];

const KIND_TITLE: Readonly<Record<ChangeKind, string>> = {
  added: 'Ditambahkan',
  changed: 'Diubah',
  fixed: 'Diperbaiki',
  docs: 'Dokumentasi',
  internal: 'Internal',
};

/** `true` bila commit ini ditulis oleh otomatisasi rilis, bukan oleh manusia. */
export function isReleaseCommit(subject: string): boolean {
  return RELEASE_COMMIT.test(subject.trim());
}

/** Tipe konvensional dari judul commit, atau `null` bila judulnya tidak mengikuti bentuk itu. */
export function conventionalType(subject: string): string | null {
  return CONVENTIONAL.exec(subject.trim())?.[1] ?? null;
}

/**
 * `true` bila commit menyatakan perubahan yang merusak kompatibilitas.
 *
 * Dua bentuk dikenali, karena keduanya nyata di repositori ini: tanda `!` pada judul (bentuk
 * ringkas commit konvensional) dan trailer `BREAKING CHANGE:` pada badan (bentuk panjang).
 */
export function isBreaking(commit: Commit): boolean {
  if (/^[a-z]+(?:\([^)]*\))?!:/.test(commit.subject.trim())) return true;
  return /^BREAKING[ -]CHANGE:/m.test(commit.body);
}

/** Bagian catatan rilis tempat commit ini masuk. */
export function classify(commit: Commit): ChangeKind {
  const type = conventionalType(commit.subject);
  if (type === null) return 'internal';
  return TYPE_TO_KIND[type] ?? 'internal';
}

/**
 * Jenis kenaikan versi paket.
 *
 * `major` hanya untuk perubahan yang merusak, `minor` untuk fitur baru, selebihnya `patch`.
 * Daftar commit yang kosong tidak pernah sampai ke sini: pemanggil berhenti lebih dulu.
 */
export function bumpKind(commits: readonly Commit[]): Bump {
  if (commits.some(isBreaking)) return 'major';
  if (commits.some((commit) => conventionalType(commit.subject) === 'feat')) return 'minor';
  return 'patch';
}

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Mengurai `x.y.z`. Melempar bila bentuknya tidak dikenal — versi yang tidak terbaca lebih baik gagal. */
export function parseVersion(version: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (match === null) {
    throw new Error(`versi tidak dikenali: "${version}" (harus x.y.z)`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Versi berikutnya menurut jenis kenaikannya. */
export function bump(version: string, kind: Bump): string {
  const current = parseVersion(version);
  if (kind === 'major') return formatVersion({ major: current.major + 1, minor: 0, patch: 0 });
  if (kind === 'minor') return formatVersion({ major: current.major, minor: current.minor + 1, patch: 0 });
  return formatVersion({ ...current, patch: current.patch + 1 });
}

/**
 * `true` bila versi `next` lebih baru daripada `current`.
 *
 * Dipakai sebagai penjaga terakhir sebelum menandai: tag yang menunjuk mundur membuat rilis
 * berikutnya salah hitung, dan kesalahan itu baru terlihat setelah tag tersebar.
 */
export function isNewer(next: string, current: string): boolean {
  const a = parseVersion(next);
  const b = parseVersion(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

/**
 * `true` bila perubahan berkas-berkas ini dapat mengubah keputusan analisis.
 *
 * Seluruh `packages/core/src` dihitung, **kecuali `version.ts`**: berkas itu hanya
 * mendeklarasikan versi, dan mengubahnya tidak mengubah satu pun keputusan. Tanpa pengecualian
 * itu, rilis yang justru sedang mengoreksi versi algoritma akan menaikkan versi algoritma lagi —
 * dan rilis yang hanya menyentuh berkas versi akan membuang cache verdikt pengguna tanpa sebab.
 */
export function isEngineChange(paths: readonly string[]): boolean {
  return paths.some(
    (path) => path.startsWith('packages/core/src/') && path !== 'packages/core/src/version.ts',
  );
}

/**
 * `true` bila indeks `CHANGELOG.md` sudah memuat baris hasil rilis otomatis.
 *
 * Baris itu dikenali dari kolom terakhirnya, ``pesan tag `vX.Y.Z` ``; baris 0.1.0–0.3.0 yang
 * ditulis tangan menunjuk berkas arsip, bukan tag. Dipakai sebagai penjaga: bila tidak ada tag
 * yang terbaca padahal indeks sudah memuat baris seperti itu, yang rusak adalah checkout-nya —
 * tag tidak ikut diambil — bukan repositori yang belum pernah dirilis.
 *
 * Penjaga ini ada karena kegagalannya nyata: rilis kedua menghitung ulang seluruh riwayat dan
 * keluar sebagai `0.5.0` semata karena `actions/checkout` tidak mengambil tag secara default.
 */
export function hasTaggedReleaseRow(changelog: string): boolean {
  return /^\|[^\n]*pesan tag `v\d+\.\d+\.\d+`[^\n]*\|$/m.test(changelog);
}

/** Judul commit tanpa awalan tipe dan tanpa nomor pull request, untuk ringkasan satu baris. */
export function plainSubject(subject: string): string {
  const stripped = subject
    .trim()
    .replace(CONVENTIONAL, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim();
  if (stripped.length === 0) return subject.trim();
  return stripped[0]?.toUpperCase() + stripped.slice(1);
}

/**
 * Ringkasan satu baris untuk kolom indeks di `CHANGELOG.md`.
 *
 * Hanya tiga judul pertama yang dipakai, dan panjangnya dibatasi: kolom ini dibaca sekilas, dan
 * daftar sepuluh perubahan di dalam satu sel tabel tidak lagi sekilas.
 */
export function summarize(commits: readonly Commit[], maxLength = 120): string {
  const parts = commits.slice(0, 3).map((commit) => plainSubject(commit.subject));
  let text = parts.join('; ');
  if (commits.length > parts.length) text += `; +${commits.length - parts.length} lainnya`;
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  return text;
}

/** Baris tabel indeks untuk satu versi. */
export function indexRow(input: {
  readonly version: string;
  readonly date: string;
  readonly algorithm: string;
  readonly algorithmChanged: boolean;
  readonly summary: string;
}): string {
  const algorithm = input.algorithmChanged
    ? input.algorithm
    : `${input.algorithm} (tidak berubah)`;
  return `| ${input.version} | ${input.date} | ${algorithm} | ${input.summary} | pesan tag \`v${input.version}\` |`;
}

export interface NotesInput {
  readonly version: string;
  readonly date: string;
  readonly algorithm: string;
  /** Nilai sebelum rilis ini; dipakai untuk menjelaskan kenaikannya. */
  readonly previousAlgorithm: string;
  /** Satu baris metrik corpus, sudah jadi. */
  readonly corpus: string;
  /** Tag pembanding, atau `null` bila repositori belum punya tag sama sekali. */
  readonly baseline: string | null;
  /**
   * Commit pada rentang, **terbaru lebih dulu** — sama seperti keluaran `git log`.
   *
   * Urutannya bagian dari kontrak, bukan kebetulan: tanpa tag rujukan, yang dianggap milik rilis
   * ini adalah elemen **pertama**, dan urutan yang terbalik akan membawa badan commit paling tua.
   * Itu pernah terjadi, dan test-nya ikut salah karena menuliskan urutannya terbalik.
   */
  readonly commits: readonly Commit[];
}

/** Baris yang tidak perlu ikut ke catatan rilis: trailer yang ditambahkan GitHub saat squash. */
const DROPPED_TRAILERS = /^(co-authored-by|co-committed-by|signed-off-by):/i;

/**
 * Batas badan commit yang dibawa ke catatan rilis.
 *
 * Badan pull request di repositori ini sering memuat penalaran panjang — dan itu memang tempatnya.
 * Tetapi catatan rilis dibaca untuk tahu **apa yang berubah**, bukan untuk membaca ulang seluruh
 * diskusi; yang dipotong diberi penunjuk ke pull request-nya, sehingga tidak ada yang hilang.
 */
const MAX_BODY_LINES = 24;
const MAX_BODY_CHARS = 1600;

function bodyLines(body: string): string[] {
  const lines = body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !DROPPED_TRAILERS.test(line.trim()));

  // Baris kosong di ujung dibuang; baris kosong di tengah dipertahankan supaya paragraf
  // di badan pull request tetap terbaca.
  while (lines.length > 0 && (lines[0] ?? '').trim().length === 0) lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim().length === 0) lines.pop();
  return lines;
}

/** Nomor pull request pada judul commit hasil squash merge, bila ada. */
function pullRequestNumber(subject: string): string | null {
  return /\(#(\d+)\)\s*$/.exec(subject.trim())?.[1] ?? null;
}

/**
 * Penunjuk ke tempat badan lengkapnya berada.
 *
 * Nomor pull request lebih baik karena di sanalah penjelasannya ditulis. Bila judulnya tidak
 * memuatnya — squash merge lewat CLI dengan `--subject` menghapus akhiran itu — SHA commit dipakai:
 * GitHub menautkan SHA di catatan rilis secara otomatis, sedangkan "…" tidak menunjuk apa pun.
 */
function bodyPointer(commit: Commit): string {
  const number = pullRequestNumber(commit.subject);
  if (number !== null) return `Selengkapnya: pull request #${number}`;
  if (commit.sha !== undefined && commit.sha.length > 0) return `Selengkapnya: commit ${commit.sha}`;
  return '…';
}

/** Badan commit untuk catatan rilis, dipotong pada batas yang wajar. */
function bodyFor(commit: Commit): string[] {
  const lines = bodyLines(commit.body);
  if (lines.length === 0) return [];

  const tooLong =
    lines.length > MAX_BODY_LINES || lines.join('\n').length > MAX_BODY_CHARS;
  if (!tooLong) return lines;

  const kept = lines.slice(0, MAX_BODY_LINES);
  while (kept.join('\n').length > MAX_BODY_CHARS && kept.length > 1) kept.pop();

  kept.push('', `  ${bodyPointer(commit)}`);
  return kept;
}

/**
 * Catatan rilis: isi **pesan tag**, dan sekaligus badan GitHub Release.
 *
 * Isinya dibentuk dari judul dan badan commit, bukan dari berkas yang dipelihara tangan. Badan
 * commit ikut dibawa karena di situlah kalimat yang tidak dapat dihasilkan mesin berada:
 * pencabutan klaim yang salah, angka yang dikoreksi, dan alasan sebuah keputusan diubah. Pada
 * squash merge, badan itu adalah badan pull request — jadi menulis penjelasan di pull request
 * sudah cukup, dan tidak ada catatan kedua yang harus diperbarui.
 */
export function renderNotes(input: NotesInput): string {
  const scope = input.baseline === null ? 'seluruh riwayat' : `${input.baseline}..HEAD`;
  const algorithmLine =
    input.algorithm === input.previousAlgorithm
      ? `ALGORITHM_VERSION: ${input.algorithm} (tidak berubah)`
      : input.baseline === null
        ? `ALGORITHM_VERSION: ${input.algorithm} (naik; belum ada tag rujukan, sehingga seluruh riwayat dihitung)`
        : `ALGORITHM_VERSION: ${input.algorithm} (naik dari ${input.previousAlgorithm})`;

  /**
   * Commit yang badannya boleh dibawa.
   *
   * Badan pull request bicara tentang **perubahannya sendiri**, bukan tentang rilis ini. Begitu
   * rentangnya tidak lagi sama dengan satu perubahan — dan itulah yang terjadi ketika repositori
   * belum punya tag rujukan — badan lama ikut terbawa, lalu berdiri di sebelah klaim yang sudah
   * tidak berlaku. Itu benar-benar terjadi pada `v0.4.0`: catatannya memuat badan pull request
   * lama yang berbunyi "ALGORITHM_VERSION tetap 0.2.0", tepat di bawah baris kepala yang
   * menyebut `0.2.1`.
   *
   * Tanpa tag rujukan, satu-satunya commit yang dapat dipastikan milik rilis ini adalah commit
   * yang memicunya — yaitu yang **pertama**, karena `commits` datang dari `git log` dan karena itu
   * terbaru lebih dulu. Judul sisanya tetap ditampilkan; yang dibuang hanya penjelasannya.
   */
  const bodyOwners =
    input.baseline === null ? new Set(input.commits.slice(0, 1)) : new Set(input.commits);

  const lines: string[] = [
    `Rilis ${input.version} — ${input.date}`,
    '',
    input.corpus,
    algorithmLine,
    '',
  ];

  const grouped = new Map<ChangeKind, Commit[]>();
  for (const commit of input.commits) {
    const kind = classify(commit);
    const bucket = grouped.get(kind);
    if (bucket === undefined) grouped.set(kind, [commit]);
    else bucket.push(commit);
  }

  for (const kind of KIND_ORDER) {
    const bucket = grouped.get(kind);
    if (bucket === undefined || bucket.length === 0) continue;

    lines.push(`### ${KIND_TITLE[kind]}`, '');
    for (const commit of bucket) {
      lines.push(`- ${commit.subject.trim()}`);
      for (const line of bodyOwners.has(commit) ? bodyFor(commit) : []) {
        lines.push(line.length === 0 ? '' : `  ${line}`);
      }
    }
    lines.push('');
  }

  lines.push(
    '---',
    `Disusun otomatis dari ${input.commits.length} commit pada rentang ${scope}.`,
    'Perubahan yang perlu dijelaskan — klaim yang dicabut, angka yang dikoreksi, alasan sebuah',
    'keputusan berubah — ditulis di badan pull request, dan ikut ke sini apa adanya.',
  );

  if (input.baseline === null) {
    lines.push(
      '',
      'Badan pull request hanya dibawa untuk commit yang memicu rilis ini: tanpa tag rujukan,',
      'commit yang lebih lama tidak dapat dipisahkan per versi, sehingga penjelasannya tidak',
      'diklaim sebagai bagian rilis ini. Riwayat terperincinya ada di `docs/CHANGELOG-0.x.md`.',
    );
  }

  lines.push('');
  return lines.join('\n');
}
