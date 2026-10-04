/**
 * Menyiapkan satu rilis: versi paket, versi algoritma, catatan rilis, dan baris indeks.
 *
 * Dijalankan otomatis oleh CI setiap kali `main` menerima push, **setelah** seluruh pemeriksaan
 * lulus (job `release` bergantung pada job `verify`). Tidak ada langkah manual di sini, dan itu
 * memang tujuannya: yang tidak dikerjakan manusia tidak dapat terlupa.
 *
 * Yang diputuskan berkas ini:
 *
 *  1. **Versi paket** — dari tipe commit sejak tag terakhir: `feat` → minor, perubahan yang
 *     merusak → major, selebihnya patch.
 *  2. **`ALGORITHM_VERSION`** — naik patch bila ada berkas di `packages/core/src` yang berubah.
 *     Itu tebakan yang lebih luas daripada definisi "rule, ambang, atau decision table", dan
 *     sengaja begitu: menaikkannya terlalu sering hanya membuang cache verdikt pengguna,
 *     sedangkan melewatkannya membuat hasil analisis lama terus dipakai setelah engine berubah.
 *  3. **Catatan rilis** — dari judul dan badan commit, ditulis ke berkas yang dipakai `git tag -F`.
 *  4. **Baris indeks `CHANGELOG.md`** — satu baris per versi, disisipkan ke tabel.
 *
 * `--dry-run` menghitung semuanya dan mencetak hasilnya tanpa menyentuh berkas apa pun. Itu
 * jalur yang dipakai untuk memeriksa perubahan pada aturan rilis tanpa membuat tag.
 *
 * Berkas ini sengaja tidak mengimpor `@sender-check/core` secara langsung untuk metrik: angkanya
 * diambil dari `summaryLines()` di harness corpus, yaitu fungsi yang sama yang dikutip
 * `docs/USAGE.md` dan dijaga test dokumentasi. Salinan kedua dari angka itu akan menyimpang.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gatesPass,
  loadCases,
  runCases,
  computeMetrics,
  summaryLines,
  type Metrics,
} from '../../corpus/src/harness.ts';
import { changedFiles, commitsSince, lastTag, tagExists } from './git.ts';
import {
  bump,
  bumpKind,
  hasTaggedReleaseRow,
  indexRow,
  isEngineChange,
  isNewer,
  isReleaseCommit,
  parseVersion,
  renderNotes,
  summarize,
  type Commit,
} from './version.ts';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(HERE, '..', '..', 'corpus', 'fixtures');

const DRY_RUN = process.argv.includes('--dry-run');

const PACKAGE_JSON = join(REPO, 'package.json');
const VERSION_TS = join(REPO, 'packages', 'core', 'src', 'version.ts');
const CHANGELOG = join(REPO, 'CHANGELOG.md');

/**
 * Commit pada rentang, tanpa commit rilis otomatisasi.
 *
 * Penyaringan ada di sini, bukan di `git.ts`: berkas itu hanya membaca git, sedangkan "commit
 * mana yang dihitung sebagai perubahan" adalah keputusan rilis.
 */
function releaseCommits(range: string): Commit[] {
  return commitsSince(REPO, range).filter((commit) => !isReleaseCommit(commit.subject));
}

function readAlgorithmVersion(): string {
  const match = /^export const ALGORITHM_VERSION = '([^']+)';/m.exec(readFileSync(VERSION_TS, 'utf8'));
  if (match?.[1] === undefined) throw new Error(`ALGORITHM_VERSION tidak terbaca dari ${VERSION_TS}`);
  return match[1];
}

function replaceConstant(source: string, name: string, value: string): string {
  const pattern = new RegExp(`^(export const ${name} = ')[^']*(';)$`, 'm');
  if (!pattern.test(source)) throw new Error(`${name} tidak ditemukan di version.ts`);
  return source.replace(pattern, `$1${value}$2`);
}

/**
 * Satu baris metrik corpus untuk catatan rilis.
 *
 * Angkanya diambil dari `summaryLines()`, bukan dihitung ulang di sini: format persen yang
 * berbeda dari yang dikutip dokumentasi akan terlihat seperti angka yang berbeda.
 */
function corpusLine(metrics: Metrics): string {
  const lines = summaryLines(metrics);

  const pick = (pattern: RegExp, label: string): string => {
    for (const line of lines) {
      const match = pattern.exec(line);
      if (match?.[1] !== undefined) return match[1];
    }
    throw new Error(`baris "${label}" tidak ada di ringkasan corpus`);
  };

  const total = pick(/^kasus\s*:\s*(\d+)$/, 'kasus');
  const precision = pick(/^precision \(flagged HIGH\)\s*:\s*([\d.]+%)/, 'precision');
  const recall = pick(/^recall \(suspicious\)\s*:\s*([\d.]+%)/, 'recall');
  const nagVisible = pick(/^nag rate \(visible\)\s*:\s*([\d.]+%)/, 'nag rate visible');
  const nagWide = pick(/^nag rate \(wide\)\s*:\s*([\d.]+%)/, 'nag rate wide');

  return `Corpus: ${total} kasus · presisi (flagged HIGH) ${precision} · recall ${recall} · nag rate ${nagVisible} (visible) / ${nagWide} (wide)`;
}

/** Menyisipkan baris baru ke tabel indeks, dan membuang baris "belum dirilis" bila masih ada. */
function withIndexRow(source: string, row: string): string {
  const out: string[] = [];
  let inserted = false;

  for (const line of source.split('\n')) {
    if (/^\|\s*belum dirilis\s*\|/.test(line)) continue;
    out.push(line);
    if (!inserted && /^\|[\s-]+\|/.test(line)) {
      out.push(row);
      inserted = true;
    }
  }

  if (!inserted) throw new Error('tabel indeks tidak ditemukan di CHANGELOG.md');
  return out.join('\n');
}

function writeOutput(key: string, value: string): void {
  const path = process.env['GITHUB_OUTPUT'];
  if (path === undefined || path.length === 0) return;
  appendFileSync(path, `${key}=${value}\n`, 'utf8');
}

function main(): void {
  const today = new Date().toISOString().slice(0, 10);
  const changelog = readFileSync(CHANGELOG, 'utf8');
  const baseline = lastTag(REPO);

  /**
   * Penjaga terhadap checkout yang kehilangan tag.
   *
   * `actions/checkout` mengambil riwayat penuh dengan `fetch-depth: 0`, tetapi **tag tidak ikut**
   * kecuali `fetch-tags: true`. Tanpa penjaga ini, kegagalannya sunyi dan hasilnya salah dengan
   * cara yang mahal: seluruh riwayat dihitung ulang sebagai "belum pernah dirilis", versi paket
   * melompat, dan versi algoritma naik tanpa sebab. Itu terjadi pada rilis kedua — satu perbaikan
   * keluar sebagai `0.5.0`.
   *
   * Indeks `CHANGELOG.md` dipakai sebagai saksi, bukan tebakan: barisnya hanya bertuliskan
   * "pesan tag" setelah ada rilis otomatis sebelumnya.
   */
  if (baseline === null && hasTaggedReleaseRow(changelog)) {
    throw new Error(
      'tidak ada tag yang terbaca, padahal CHANGELOG.md sudah memuat rilis bertag: ' +
        'checkout ini kehilangan tag, bukan repositori yang belum pernah dirilis. ' +
        'Periksa `fetch-tags: true` pada job rilis.',
    );
  }

  const range = baseline === null ? 'HEAD' : `${baseline}..HEAD`;
  const commits = releaseCommits(range);

  console.log(`rentang commit   : ${range}`);
  console.log(`commit dinilai   : ${commits.length}`);

  if (commits.length === 0) {
    console.log('tidak ada perubahan sejak rilis terakhir; tidak ada yang dirilis');
    writeOutput('skip', 'true');
    return;
  }

  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string };
  const base = baseline === null ? pkg.version : baseline.replace(/^v/, '');
  const packageVersion = bump(base, bumpKind(commits));

  if (!isNewer(packageVersion, pkg.version)) {
    throw new Error(
      `versi hasil hitungan ${packageVersion} tidak lebih baru dari package.json ${pkg.version}; ` +
        'tag atau versi paket tampaknya mundur, dan rilis dibatalkan',
    );
  }

  // Penjaga idempotensi: menjalankan ulang rilis untuk versi yang sudah ditandai tidak boleh
  // membuat tag kedua dengan nama yang sama — itu gagal, tetapi gagalnya berisik dan membingungkan.
  if (tagExists(REPO, `v${packageVersion}`)) {
    console.log(`tag v${packageVersion} sudah ada; tidak ada yang dirilis`);
    writeOutput('skip', 'true');
    return;
  }

  /**
   * Berkas yang berubah sejak rilis terakhir, atau `null` bila tidak ada rujukannya.
   *
   * Tanpa tag rujukan, rentangnya adalah seluruh riwayat, sehingga "berubah sejak rilis terakhir"
   * tidak punya arti. `null` di sini berarti **tidak diketahui**, dan pemanggilnya menebak ke sisi
   * yang murah: anggap engine berubah. Sebelumnya keadaan ini terbaca dari keluaran git yang
   * kebetulan kosong — kebetulan yang benar hasilnya, tetapi bukan alasan yang dapat diperiksa.
   */
  const files = baseline === null ? null : changedFiles(REPO, range);
  const coreChanged = files === null || isEngineChange(files);
  const dataChanged =
    files !== null && files.some((path) => path.startsWith('packages/core/src/data/'));

  const previousAlgorithm = readAlgorithmVersion();
  const algorithm = coreChanged ? bump(previousAlgorithm, 'patch') : previousAlgorithm;

  const cases = loadCases(FIXTURES);
  const metrics = computeMetrics(runCases(cases));
  if (!gatesPass(metrics)) {
    throw new Error('release gate corpus gagal; rilis dibatalkan sebelum apa pun ditulis');
  }

  const notes = renderNotes({
    version: packageVersion,
    date: today,
    algorithm,
    previousAlgorithm,
    corpus: corpusLine(metrics),
    baseline,
    commits,
  });

  console.log(`versi paket      : ${pkg.version} -> ${packageVersion}`);
  console.log(`ALGORITHM_VERSION: ${previousAlgorithm} -> ${algorithm}${coreChanged ? '' : ' (tidak berubah)'}`);
  console.log(`berkas engine    : ${files === null ? 'tidak diketahui (belum ada tag)' : coreChanged ? 'berubah' : 'tidak berubah'}`);
  console.log(corpusLine(metrics));
  console.log('');
  console.log('--- catatan rilis ---');
  console.log(notes);
  console.log('---------------------');

  if (DRY_RUN) {
    console.log('dry-run: tidak ada berkas yang diubah');
    return;
  }

  const notesPath = process.env['RELEASE_NOTES_PATH'];
  if (notesPath === undefined || notesPath.length === 0) {
    throw new Error('RELEASE_NOTES_PATH tidak diisi; catatan rilis tidak punya tujuan');
  }
  writeFileSync(notesPath, notes, 'utf8');

  const nextPkg = `${JSON.stringify({ ...pkg, version: packageVersion }, null, 2)}\n`;
  writeFileSync(PACKAGE_JSON, nextPkg, 'utf8');

  let versionSource = readFileSync(VERSION_TS, 'utf8');
  versionSource = replaceConstant(versionSource, 'ALGORITHM_VERSION', algorithm);
  if (dataChanged) versionSource = replaceConstant(versionSource, 'DATA_UPDATED_AT', today);
  writeFileSync(VERSION_TS, versionSource, 'utf8');

  writeFileSync(
    CHANGELOG,
    withIndexRow(
      readFileSync(CHANGELOG, 'utf8'),
      indexRow({
        version: packageVersion,
        date: today,
        algorithm,
        algorithmChanged: algorithm !== previousAlgorithm,
        summary: summarize(commits),
      }),
    ),
    'utf8',
  );

  const parsed = parseVersion(packageVersion);
  writeOutput('skip', 'false');
  writeOutput('version', packageVersion);
  writeOutput('algorithm', algorithm);
  writeOutput('notes_path', notesPath);
  console.log(`berkas diperbarui: package.json, packages/core/src/version.ts, CHANGELOG.md`);
  console.log(`versi mayor: ${parsed.major}`);
}

main();
