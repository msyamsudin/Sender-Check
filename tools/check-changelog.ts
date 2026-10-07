/**
 * Pemeriksa indeks `CHANGELOG.md` terhadap tag yang benar-benar ada.
 *
 * Indeks itu satu baris per rilis, dan setiap barisnya mengklaim tiga hal yang tidak dapat
 * diperiksa manusia dengan membaca barisnya:
 *
 *  1. tag `vX.Y.Z` yang disebutnya benar-benar ada;
 *  2. tag itu beranotasi, sehingga punya pesan — dan pesan itulah catatan rilisnya;
 *  3. `ALGORITHM_VERSION` pada kolomnya sama dengan yang disebut pesan tag itu.
 *
 * Selama ini yang menjaga hanya `release-check` di CI, dan ia hanya berjalan pada **satu** tag:
 * tag yang baru saja didorong. Setelah itu tidak ada apa pun yang memeriksa apakah baris lama
 * masih cocok dengan tagnya — padahal justru baris lama yang dipakai orang untuk mengetahui versi
 * apa yang mengubah keputusan analisis. Baris yang salah di sana membuat cache verdikt pengguna
 * dibuang tanpa sebab, atau tidak dibuang padahal seharusnya.
 *
 * ## Kenapa skrip, bukan hanya test
 *
 * Ia membaca git, bukan berkas di repositori ini saja: pemeriksaannya menuntut tag sudah diambil
 * (`fetch-tags`). Sebagai test ia akan lulus di mesin yang punya tag dan gagal di checkout dangkal,
 * yaitu kegagalan yang menuduh repositori padahal checkout-nya yang kurang — persis kegagalan yang
 * pernah terjadi pada `docs:check`. Logikanya tetap diuji di `tools/release/tests/changelog.test.ts`
 * dengan fakta tag buatan.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileAtRef, tagMessage, tagType, tags } from './release/src/git.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHANGELOG = 'CHANGELOG.md';
const PACKAGE_JSON = 'package.json';

export interface ClaimProblem {
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
  readonly reason: string;
}

/** Satu baris indeks, sebagaimana tertulis — belum dinilai apa pun. */
export interface IndexRow {
  readonly version: string;
  readonly date: string;
  readonly algorithm: string;
  readonly summary: string;
  /** Nama tag yang diklaim baris ini, atau `null` bila ia menunjuk berkas arsip. */
  readonly tag: string | null;
  /** Isi kolom terakhir yang tidak dikenali, supaya dapat disebutkan apa adanya. */
  readonly unrecognized: string | null;
  readonly line: number;
}

/**
 * Mengurai tabel indeks.
 *
 * Hanya baris yang bentuknya `| x.y.z | tanggal | … |` yang diambil; baris kepala dan pemisah
 * tabel tidak cocok dengan bentuk itu, sehingga tidak perlu dikecualikan satu per satu.
 */
export function parseIndex(markdown: string): IndexRow[] {
  const rows: IndexRow[] = [];

  markdown.split('\n').forEach((text, index) => {
    if (!/^\|\s*\d+\.\d+\.\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(text)) return;

    const cells = text
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 5) return;

    const [version = '', date = '', algorithm = '', summary = '', last = ''] = cells;
    const tagMatch = /pesan tag `(v\d+\.\d+\.\d+)`/.exec(last);
    const archive = /CHANGELOG-0\.x\.md/.test(last);

    rows.push({
      version,
      date,
      algorithm,
      summary,
      tag: tagMatch?.[1] ?? null,
      unrecognized: tagMatch === null && !archive ? last : null,
      line: index + 1,
    });
  });

  return rows;
}

/** Fakta sebuah tag, dibaca dari git atau diberikan test. */
export interface TagFacts {
  readonly exists: boolean;
  readonly annotated: boolean;
  readonly message: string;
  /** Versi `package.json` pada commit tag itu, atau `null` bila tidak terbaca. */
  readonly packageVersion: string | null;
}

/**
 * Menilai setiap baris indeks terhadap faktanya.
 *
 * Baris 0.1.0–0.3.0 dikecualikan bukan karena angkanya mungkin salah, melainkan karena mereka
 * memang tidak punya tag: ketiganya dirilis sebelum tag dipakai. Pengecualiannya sempit — pada
 * baris itu saja, dan hanya bila kolom terakhirnya memang menunjuk berkas arsip.
 */
export function findChangelogProblems(input: {
  readonly markdown: string;
  readonly packageVersion: string;
  readonly facts: ReadonlyMap<string, TagFacts>;
}): readonly ClaimProblem[] {
  const problems: ClaimProblem[] = [];
  const rows = parseIndex(input.markdown);

  if (rows.length === 0) {
    problems.push({
      file: CHANGELOG,
      line: 0,
      excerpt: '',
      reason: 'tidak ada satu pun baris indeks yang terbaca, sehingga tidak ada yang diperiksa',
    });
    return problems;
  }

  for (const row of rows) {
    if (row.unrecognized !== null) {
      problems.push({
        file: CHANGELOG,
        line: row.line,
        excerpt: `| ${row.version} | ${row.date} | ${row.algorithm} | … | ${row.unrecognized} |`,
        reason: `kolom terakhir tidak dikenali ("${row.unrecognized}"): baris ini tidak menunjuk tag mana pun, sehingga tidak diperiksa apa pun`,
      });
      continue;
    }

    if (row.tag === null) continue;

    const expectedTag = `v${row.version}`;
    if (row.tag !== expectedTag) {
      problems.push({
        file: CHANGELOG,
        line: row.line,
        excerpt: `| ${row.version} | … | ${row.tag} |`,
        reason: `versi ${row.version} menunjuk tag ${row.tag}, yang menandai versi lain`,
      });
      continue;
    }

    const facts = input.facts.get(row.tag);
    if (facts === undefined || !facts.exists) {
      problems.push({
        file: CHANGELOG,
        line: row.line,
        excerpt: `| ${row.version} | … | pesan tag \`${row.tag}\` |`,
        reason: `tag ${row.tag} tidak ada, sehingga catatan rilis yang dijanjikan baris ini tidak dapat ditemukan`,
      });
      continue;
    }

    if (!facts.annotated) {
      problems.push({
        file: CHANGELOG,
        line: row.line,
        excerpt: `| ${row.version} | … | pesan tag \`${row.tag}\` |`,
        reason: `tag ${row.tag} adalah tag ringan, sehingga tidak punya catatan rilis`,
      });
    }

    if (facts.packageVersion !== null && facts.packageVersion !== row.version) {
      problems.push({
        file: CHANGELOG,
        line: row.line,
        excerpt: `| ${row.version} | … | pesan tag \`${row.tag}\` |`,
        reason: `tag ${row.tag} menandai package.json versi ${facts.packageVersion}, bukan ${row.version}`,
      });
    }

    if (!facts.message.includes(`ALGORITHM_VERSION: ${row.algorithm}`)) {
      problems.push({
        file: CHANGELOG,
        line: row.line,
        excerpt: `| ${row.version} | … | ${row.algorithm} | … | pesan tag \`${row.tag}\` |`,
        reason: `kolomnya menyebut ALGORITHM_VERSION ${row.algorithm}, tetapi pesan tag ${row.tag} tidak menyebut angka itu`,
      });
    }
  }

  const newest = rows.find((row) => row.tag !== null);
  if (newest !== undefined && newest.version !== input.packageVersion) {
    problems.push({
      file: CHANGELOG,
      line: newest.line,
      excerpt: `| ${newest.version} | … |`,
      reason: `baris rilis terbaru menyebut ${newest.version}, sedangkan package.json sudah di ${input.packageVersion}: indeks tertinggal dari paket`,
    });
  }

  return problems;
}

/** Membaca fakta setiap tag dari git, sekali jalan. */
export function readFacts(repo: string, names: readonly string[]): Map<string, TagFacts> {
  const facts = new Map<string, TagFacts>();

  for (const name of names) {
    let type: string;
    try {
      type = tagType(repo, name);
    } catch {
      facts.set(name, { exists: false, annotated: false, message: '', packageVersion: null });
      continue;
    }

    let packageVersion: string | null = null;
    try {
      const parsed = JSON.parse(fileAtRef(repo, name, PACKAGE_JSON)) as { version?: string };
      packageVersion = parsed.version ?? null;
    } catch {
      packageVersion = null;
    }

    facts.set(name, {
      exists: true,
      annotated: type === 'tag',
      message: tagMessage(repo, name),
      packageVersion,
    });
  }

  return facts;
}

/** `true` bila berkas ini dijalankan langsung, bukan diimpor sebagai modul. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, PACKAGE_JSON), 'utf8')) as { version: string };
  const available = tags(repoRoot);

  if (available.length === 0) {
    console.log('tidak ada tag rilis di checkout ini');
    console.log('jalankan `git fetch --tags` lebih dulu; tanpa tag, tidak ada yang dapat diperiksa');
    process.exitCode = 1;
  } else {
    const markdown = readFileSync(join(repoRoot, CHANGELOG), 'utf8');
    const rows = parseIndex(markdown);
    const facts = readFacts(
      repoRoot,
      rows.map((row) => row.tag).filter((tag): tag is string => tag !== null),
    );

    const problems = findChangelogProblems({ markdown, packageVersion: pkg.version, facts });

    console.log(`tag terbaca    : ${available.length} (terbaru ${available[0] ?? '-'})`);
    console.log(`baris indeks   : ${rows.length}`);
    console.log(`package.json   : ${pkg.version}`);

    if (problems.length === 0) {
      console.log('setiap baris indeks cocok dengan tagnya');
    } else {
      console.log('');
      for (const problem of problems) {
        const where = problem.line === 0 ? problem.file : `${problem.file}:${problem.line}`;
        console.log(`MASALAH  ${where}`);
        if (problem.excerpt.length > 0) console.log(`         ${problem.excerpt}`);
        console.log(`         ${problem.reason}`);
      }
      console.log('');
      console.log(`${problems.length} masalah ditemukan`);
      process.exitCode = 1;
    }
  }
}
