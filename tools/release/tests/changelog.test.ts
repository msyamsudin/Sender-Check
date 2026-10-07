import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findChangelogProblems,
  parseIndex,
  readFacts,
  type TagFacts,
} from '../../../tools/check-changelog.ts';
import { tags } from '../src/git.ts';

/**
 * Uji pemeriksa indeks CHANGELOG.
 *
 * Sebagian besar test di sini memakai fakta tag buatan, karena yang diuji adalah penilaiannya —
 * apakah ia menangkap tag yang hilang, tag ringan, dan kolom `ALGORITHM_VERSION` yang tidak cocok.
 * Yang tidak dapat diuji dengan tiruan adalah pembacaan gitnya sendiri, jadi tiga test terakhir
 * menjalankan git sungguhan di repositori sementara.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const HEADER = [
  '| Versi | Tanggal | `ALGORITHM_VERSION` | Ringkasan | Catatan rilis |',
  '|---|---|---|---|---|',
];

function row(version: string, algorithm: string, last: string): string {
  return `| ${version} | 2026-10-06 | ${algorithm} | Ringkasan rilis | ${last} |`;
}

function tag(
  version: string,
  algorithm: string,
  extra: Partial<TagFacts> = {},
): [string, TagFacts] {
  return [
    version,
    {
      exists: true,
      annotated: true,
      message: `Rilis\n\nALGORITHM_VERSION: ${algorithm}\n`,
      packageVersion: version.replace(/^v/, ''),
      ...extra,
    },
  ];
}

describe('parseIndex', () => {
  it('membaca baris rilis otomatis dan baris arsip, serta mengabaikan kepala tabel', () => {
    const markdown = [
      ...HEADER,
      row('0.6.0', '0.2.3', 'pesan tag `v0.6.0`'),
      row('0.3.0', '0.2.0 (tidak berubah)', '`docs/CHANGELOG-0.x.md`'),
    ].join('\n');

    const rows = parseIndex(markdown);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ version: '0.6.0', tag: 'v0.6.0', line: 3 });
    expect(rows[1]).toMatchObject({ version: '0.3.0', tag: null, unrecognized: null });
    // Kolomnya dibaca apa adanya, termasuk akhiran "(tidak berubah)" yang juga ada di pesan tag.
    expect(rows[1]?.algorithm).toBe('0.2.0 (tidak berubah)');
  });
});

describe('findChangelogProblems', () => {
  const facts = new Map<string, TagFacts>([tag('v0.6.0', '0.2.3')]);

  it('menerima baris yang cocok dengan tagnya', () => {
    const markdown = [...HEADER, row('0.6.0', '0.2.3', 'pesan tag `v0.6.0`')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.0', facts });

    expect(problems).toEqual([]);
  });

  it('menangkap tag yang tidak ada', () => {
    const markdown = [...HEADER, row('0.5.0', '0.2.2', 'pesan tag `v0.5.0`')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.5.0', facts });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('tag v0.5.0 tidak ada');
  });

  it('menangkap tag ringan yang tidak punya catatan rilis', () => {
    // Dua masalah sekaligus, dan itu memang keadaannya: tag ringan "pesannya" adalah pesan
    // commit rilis (`chore(release): 0.6.0`), yang tentu tidak memuat baris ALGORITHM_VERSION.
    // Satu tag ringan cukup untuk membuat dua klaim barisnya tidak dapat dibuktikan.
    const markdown = [...HEADER, row('0.6.0', '0.2.3', 'pesan tag `v0.6.0`')].join('\n');
    const lightweight = new Map<string, TagFacts>([
      tag('v0.6.0', '0.2.3', { annotated: false, message: 'chore(release): 0.6.0' }),
    ]);

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.0', facts: lightweight });

    const reasons = problems.map((problem) => problem.reason);
    expect(reasons.some((reason) => reason.includes('tag ringan'))).toBe(true);
    expect(reasons.some((reason) => reason.includes('tidak menyebut angka itu'))).toBe(true);
    expect(problems).toHaveLength(2);
  });

  it('menangkap ALGORITHM_VERSION yang tidak cocok dengan pesan tag', () => {
    // Inilah kesalahan yang tidak dapat dilihat manusia dari barisnya: angka di kolom terlihat
    // masuk akal, dan hanya pesan tag yang tahu angka mana yang benar-benar ikut dirilis.
    const markdown = [...HEADER, row('0.6.0', '0.2.2', 'pesan tag `v0.6.0`')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.0', facts });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('pesan tag v0.6.0 tidak menyebut angka itu');
  });

  it('menangkap baris yang menunjuk tag versi lain', () => {
    const markdown = [...HEADER, row('0.6.0', '0.2.3', 'pesan tag `v0.5.1`')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.0', facts });

    expect(problems[0]?.reason).toContain('menandai versi lain');
  });

  it('menangkap tag yang menandai versi package.json yang berbeda', () => {
    const markdown = [...HEADER, row('0.6.0', '0.2.3', 'pesan tag `v0.6.0`')].join('\n');
    const wrong = new Map<string, TagFacts>([tag('v0.6.0', '0.2.3', { packageVersion: '0.5.1' })]);

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.0', facts: wrong });

    expect(problems[0]?.reason).toContain('bukan 0.6.0');
  });

  it('menangkap kolom terakhir yang tidak dikenali', () => {
    // Baris seperti ini tidak menunjuk tag apa pun. Kalau dibiarkan, ia akan terlihat patuh
    // padahal tidak ada satu pun bagiannya yang diperiksa.
    const markdown = [...HEADER, row('0.6.0', '0.2.3', 'lihat catatan')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.0', facts });

    // Satu masalah saja: baris itu tidak dihitung sebagai rilis terbaru, justru karena ia tidak
    // menunjuk tag apa pun. Baris yang tidak menunjuk apa pun tidak boleh juga dianggap terlambat.
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('tidak menunjuk tag mana pun');
  });

  it('menangkap indeks yang tertinggal dari package.json', () => {
    const markdown = [...HEADER, row('0.6.0', '0.2.3', 'pesan tag `v0.6.0`')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.6.1', facts });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('indeks tertinggal dari paket');
  });

  it('mengeluh bila tidak ada satu pun baris yang terbaca', () => {
    const problems = findChangelogProblems({ markdown: '# Changelog\n\nTidak ada tabel.', packageVersion: '0.6.0', facts });

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('tidak ada satu pun baris indeks');
  });

  it('mengecualikan baris arsip yang memang tidak punya tag', () => {
    const markdown = [...HEADER, row('0.3.0', '0.2.0 (tidak berubah)', '`docs/CHANGELOG-0.x.md`')].join('\n');

    const problems = findChangelogProblems({ markdown, packageVersion: '0.3.0', facts: new Map() });

    expect(problems).toEqual([]);
  });
});

describe('readFacts', () => {
  const dirs: string[] = [];

  function tempRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'sc-changelog-'));
    dirs.push(dir);
    run(dir, ['init', '-q']);
    run(dir, ['config', 'user.email', 'test@example.com']);
    run(dir, ['config', 'user.name', 'Test']);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.6.0' }), 'utf8');
    run(dir, ['add', '-A']);
    run(dir, ['commit', '-qm', 'chore(release): 0.6.0']);
    return dir;
  }

  function run(repo: string, args: readonly string[]): string {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('membaca pesan tag beranotasi beserta versi package.json pada tag itu', () => {
    const repo = tempRepo();
    run(repo, ['tag', '-a', 'v0.6.0', '-m', 'Rilis 0.6.0\n\nALGORITHM_VERSION: 0.2.3']);

    const facts = readFacts(repo, ['v0.6.0']).get('v0.6.0');

    expect(facts?.exists).toBe(true);
    expect(facts?.annotated).toBe(true);
    expect(facts?.message).toContain('ALGORITHM_VERSION: 0.2.3');
    expect(facts?.packageVersion).toBe('0.6.0');
  });

  it('membedakan tag ringan dari tag beranotasi', () => {
    const repo = tempRepo();
    run(repo, ['tag', 'v0.6.0']);

    expect(readFacts(repo, ['v0.6.0']).get('v0.6.0')?.annotated).toBe(false);
  });

  it('melaporkan tag yang tidak ada tanpa melempar', () => {
    const repo = tempRepo();

    const facts = readFacts(repo, ['v9.9.9']).get('v9.9.9');

    expect(facts?.exists).toBe(false);
  });
});

describe('indeks dan tag sungguhan', () => {
  it('setiap baris indeks cocok dengan tag yang benar-benar ada', () => {
    const available = tags(repoRoot);

    if (available.length === 0) {
      // Sama seperti snapshot DOM yang belum diambil: keadaan ini tidak boleh menggagalkan CI
      // yang checkout-nya dangkal, tetapi juga tidak boleh diam-diam dilewati.
      console.info('[changelog] tidak ada tag di checkout ini; pemeriksaan dilewati');
      return;
    }

    const markdown = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const rows = parseIndex(markdown);
    const facts = readFacts(
      repoRoot,
      rows.map((entry) => entry.tag).filter((name): name is string => name !== null),
    );

    const problems = findChangelogProblems({ markdown, packageVersion: pkg.version, facts });

    expect(problems.map((problem) => `${problem.file}:${problem.line} ${problem.reason}`)).toEqual([]);
    expect(rows.length).toBeGreaterThan(3);
  });
});
