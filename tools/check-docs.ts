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
import { dirname, join, normalize, resolve } from 'node:path';
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

    checkedTargets++;
    const target = normalize(join(base, withoutAnchor));
    if (!existsSync(target)) problems.push({ file, target: rawTarget, reason });
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
