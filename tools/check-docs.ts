/**
 * Pemeriksa tautan dan path di dokumentasi Markdown.
 *
 * Dokumentasi yang menunjuk berkas yang tidak ada adalah dokumentasi yang berbohong,
 * dan itu mudah terjadi begitu struktur repositori berubah. Pemeriksa ini menangkap:
 *
 *  1. tautan Markdown yang menunjuk berkas yang tidak ada;
 *  2. path repositori di dalam tanda kutip terbalik yang tidak ada;
 *  3. dokumen di `docs/` yang tidak ditautkan dari README (dokumen yatim);
 *  4. fixture yang didaftarkan harness tetapi berkasnya tidak ada.
 *
 * Dipakai dua kali: sebagai skrip (`pnpm docs:check`) dan sebagai test, sehingga tidak
 * bergantung pada orang yang ingat menjalankannya.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DOC_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'THIRD_PARTY.md',
  'LICENSE',
  'docs/DESIGN.md',
  'docs/USAGE.md',
  'docs/RULES.md',
  'docs/FIREFOX.md',
];

export interface DocProblem {
  readonly file: string;
  readonly target: string;
  readonly reason: string;
}

export interface DocCheckResult {
  readonly checkedTargets: number;
  readonly problems: readonly DocProblem[];
}

/**
 * Artefak hasil build yang **memang tidak ada** di checkout bersih.
 *
 * Direktori-direktori ini diabaikan `.gitignore`, jadi berkasnya hanya ada setelah
 * `pnpm console:build` atau `pnpm corpus` dijalankan. Dokumentasi tetap boleh
 * menunjuknya — justru itu gunanya dokumentasi — tetapi menuntut keberadaannya adalah
 * kesalahan: pemeriksa ini lulus di mesin pengembang yang sudah pernah build dan gagal
 * di CI yang baru saja meng-clone. Itu pernah benar-benar terjadi.
 *
 * Memakai daftar tertutup, bukan awalan direktori, supaya berkas salah tulis di dalam
 * direktori itu tetap tertangkap selama berkasnya ada.
 */
const GENERATED_ARTIFACTS: ReadonlyArray<{ path: string; generator: string }> = [
  { path: 'tools/console/dist', generator: 'tools/console/build.ts' },
  { path: 'tools/console/dist/sender-check.probe.js', generator: 'tools/console/build.ts' },
  { path: 'tools/console/dist/sender-check.console.js', generator: 'tools/console/build.ts' },
  { path: 'tools/console/dist/CARA-PAKAI.txt', generator: 'tools/console/build.ts' },
  { path: 'tools/corpus/reports', generator: 'tools/corpus/src/cli.ts' },
  { path: 'tools/corpus/reports/corpus-report.md', generator: 'tools/corpus/src/cli.ts' },
];

/**
 * `true` bila target adalah artefak build yang generatornya benar-benar ada di repo.
 *
 * Direktori hasil build ikut didaftarkan karena dokumentasi memang menautkan
 * direktorinya ("bundelnya ada di sini"). Untuk direktori, satu-satunya syarat adalah
 * generatornya ada — bukan isinya, karena isi direktori itu memang berbeda-beda
 * tergantung perintah build yang terakhir dijalankan.
 */
function isGeneratedArtifact(relativeTarget: string): boolean {
  const target = relativeTarget.replace(/\/$/, '');
  const entry = GENERATED_ARTIFACTS.find((item) => item.path === target);
  if (entry === undefined) return false;

  // Generatornya harus ada. Kalau tidak, path ini menunjuk sesuatu yang tidak dapat
  // dibuat siapa pun, dan itu tetap masalah.
  return existsSync(join(repoRoot, entry.generator));
}

/**
 * Memeriksa seluruh dokumentasi.
 *
 * Dua basis resolusi dipakai, dan membedakannya penting:
 *  - tautan Markdown relatif terhadap **berkas dokumen** tempat ia ditulis;
 *  - path di dalam tanda kutip terbalik (mis. `docs/RULES.md`) selalu relatif
 *    terhadap **akar repositori**, karena begitulah cara pembaca memahaminya.
 */
export function checkDocs(): DocCheckResult {
  const problems: DocProblem[] = [];
  let checkedTargets = 0;

  const checksTarget = (base: string, file: string, rawTarget: string, reason: string): void => {
    const withoutAnchor = rawTarget.split('#')[0] ?? '';
    if (withoutAnchor.length === 0) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(withoutAnchor)) return;
    if (withoutAnchor.startsWith('/')) return;

    const target = normalize(join(base, withoutAnchor));
    const relativeTarget = relative(repoRoot, target).replaceAll('\\', '/');

    // Artefak build dihitung sebagai target yang diperiksa, tetapi tidak dituntut ada.
    checkedTargets++;
    if (existsSync(target)) return;
    if (isGeneratedArtifact(relativeTarget)) return;
    problems.push({ file, target: rawTarget, reason });
  };

  for (const file of DOC_FILES) {
    const absolute = join(repoRoot, file);
    if (!existsSync(absolute)) {
      problems.push({ file, target: file, reason: 'berkas dokumentasi tidak ada' });
      continue;
    }

    const content = readFileSync(absolute, 'utf8');
    const documentBase = join(repoRoot, dirname(file));

    for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (target !== undefined) {
        checksTarget(documentBase, file, target, 'tautan Markdown menunjuk berkas yang tidak ada');
      }
    }

    for (const match of content.matchAll(/`([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)`/g)) {
      const target = match[1];
      if (target === undefined) continue;
      if (!/^(packages|tools|apps|docs|examples)\//.test(target)) continue;
      checksTarget(repoRoot, file, target, 'path di dalam kode menunjuk berkas yang tidak ada');
    }
  }

  // Dokumen di docs/ harus ditautkan dari README, supaya tidak ada yang terlupakan.
  const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  for (const entry of readdirSync(join(repoRoot, 'docs'))) {
    if (!entry.endsWith('.md')) continue;
    if (!readme.includes(`docs/${entry}`)) {
      problems.push({
        file: 'README.md',
        target: `docs/${entry}`,
        reason: 'dokumen tidak ditautkan dari README',
      });
    }
  }

  // Fixture yang didaftarkan harness harus benar-benar ada.
  const harness = readFileSync(join(repoRoot, 'tools/corpus/src/harness.ts'), 'utf8');
  const fixturesBlock = /const FIXTURE_FILES[^=]*=\s*\[([^\]]*)\]/.exec(harness)?.[1] ?? '';
  for (const match of fixturesBlock.matchAll(/'([^']+)'/g)) {
    const name = match[1];
    if (name === undefined) continue;
    const path = join(repoRoot, 'tools/corpus/fixtures', name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      problems.push({
        file: 'tools/corpus/src/harness.ts',
        target: `tools/corpus/fixtures/${name}`,
        reason: 'fixture didaftarkan tetapi berkasnya tidak ada',
      });
    }
  }

  return { checkedTargets, problems };
}

/** `true` bila berkas ini dijalankan langsung, bukan diimpor sebagai modul. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const { checkedTargets, problems } = checkDocs();

  console.log(`memeriksa ${checkedTargets} tautan dan path di ${DOC_FILES.length} berkas dokumentasi`);

  if (problems.length === 0) {
    console.log('semua tautan dan path valid');
  } else {
    console.log('');
    for (const problem of problems) {
      console.log(`MASALAH  ${problem.file} -> ${problem.target}`);
      console.log(`         ${problem.reason}`);
    }
    console.log('');
    console.log(`${problems.length} masalah ditemukan`);
    process.exitCode = 1;
  }
}
