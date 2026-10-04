import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedFiles, commitsSince, lastTag, tagExists } from '../src/git.ts';

/**
 * Test akses git — terhadap repositori git sungguhan, bukan tiruan.
 *
 * Alasannya konkret: berkas ini pernah memanggil `git tag --list --match 'v[0-9]*'`, dan `git tag`
 * tidak punya opsi `--match`. Perintahnya gagal setiap kali, galatnya ditelan pembungkus yang
 * mengembalikan `null`, dan rilis otomatis membacanya sebagai "repositori belum punya tag" —
 * sehingga rilis kedua menghitung seluruh riwayat dan keluar sebagai `0.5.0` untuk satu perbaikan.
 *
 * Test yang memakai tiruan tidak akan menangkapnya: yang salah adalah perintah gitnya sendiri.
 * Karena itu setiap test di sini membuat repositori sementara dan menjalankan git sungguhan.
 */

const dirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-git-'));
  dirs.push(dir);
  run(dir, ['init', '-q']);
  run(dir, ['config', 'user.email', 'test@example.com']);
  run(dir, ['config', 'user.name', 'Test']);
  return dir;
}

function run(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function commit(repo: string, file: string, content: string, message: string): void {
  mkdirSync(join(repo, 'packages', 'core', 'src'), { recursive: true });
  writeFileSync(join(repo, file), content, 'utf8');
  run(repo, ['add', '-A']);
  run(repo, ['commit', '-qm', message]);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('lastTag', () => {
  it('mengembalikan null bila belum ada tag', () => {
    // Repositori tanpa tag adalah keadaan yang sah, bukan kegagalan — dan hanya keadaan ini yang
    // boleh menghasilkan `null`.
    const repo = tempRepo();
    commit(repo, 'a.txt', 'a', 'feat: awal');

    expect(lastTag(repo)).toBeNull();
  });

  it('menemukan tag rilis, dan memilih yang terbaru menurut versi', () => {
    // Pengurutan teks biasa akan menaruh v0.9.0 di atas v0.10.0; `-v:refname` tidak.
    const repo = tempRepo();
    commit(repo, 'a.txt', 'a', 'feat: awal');
    run(repo, ['tag', '-a', 'v0.9.0', '-m', 'sembilan']);
    run(repo, ['tag', '-a', 'v0.10.0', '-m', 'sepuluh']);

    expect(lastTag(repo)).toBe('v0.10.0');
  });

  it('mengabaikan tag yang bukan berbentuk versi', () => {
    const repo = tempRepo();
    commit(repo, 'a.txt', 'a', 'feat: awal');
    run(repo, ['tag', '-a', 'backup/lengkap', '-m', 'bukan rilis']);
    run(repo, ['tag', '-a', 'v1.0.0', '-m', 'rilis']);

    expect(lastTag(repo)).toBe('v1.0.0');
  });
});

describe('commitsSince', () => {
  it('membaca judul dan badan, terbaru lebih dulu', () => {
    const repo = tempRepo();
    commit(repo, 'a.txt', 'a', 'feat: pertama');
    commit(repo, 'b.txt', 'b', 'fix: kedua (#7)');
    run(repo, ['tag', '-a', 'v0.1.0', '-m', 'rilis']);
    commit(repo, 'c.txt', 'c', 'fix: ketiga\n\nBadan menjelaskan sesuatu.');

    const commits = commitsSince(repo, 'v0.1.0..HEAD');

    expect(commits).toHaveLength(1);
    expect(commits[0]?.subject).toBe('fix: ketiga');
    expect(commits[0]?.body).toContain('Badan menjelaskan sesuatu.');
    // SHA singkat ikut dibawa: ia dipakai sebagai penunjuk ketika badan commit dipotong.
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{7,}$/);
  });
});

describe('changedFiles', () => {
  it('melaporkan berkas yang berubah pada rentang', () => {
    const repo = tempRepo();
    commit(repo, 'packages/core/src/rules.ts', 'x', 'feat: awal');
    run(repo, ['tag', '-a', 'v0.1.0', '-m', 'rilis']);
    commit(repo, 'packages/core/src/rules.ts', 'y', 'fix: ubah aturan');
    commit(repo, 'README.md', 'z', 'docs: ubah readme');

    const files = changedFiles(repo, 'v0.1.0..HEAD');

    expect(files).toContain('packages/core/src/rules.ts');
    expect(files).toContain('README.md');
  });

  it('melempar untuk rentang yang tidak ada, bukan mengembalikan daftar kosong', () => {
    // Rentang yang tidak ada berarti tag rujukannya hilang. Daftar kosong akan terbaca sebagai
    // "tidak ada yang berubah", dan itu kesimpulan yang salah dari kegagalan.
    const repo = tempRepo();
    commit(repo, 'a.txt', 'a', 'feat: awal');

    expect(() => changedFiles(repo, 'v9.9.9..HEAD')).toThrow();
  });
});

describe('tagExists', () => {
  it('membedakan tag yang ada dari yang tidak ada', () => {
    const repo = tempRepo();
    commit(repo, 'a.txt', 'a', 'feat: awal');
    run(repo, ['tag', '-a', 'v0.1.0', '-m', 'rilis']);

    expect(tagExists(repo, 'v0.1.0')).toBe(true);
    expect(tagExists(repo, 'v0.2.0')).toBe(false);
  });
});
