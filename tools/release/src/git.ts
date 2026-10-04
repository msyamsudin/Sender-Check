/**
 * Akses git untuk rilis otomatis.
 *
 * Dipisahkan dari `prepare.ts` supaya dapat diuji terhadap repositori git sungguhan, dan karena
 * berkas ini pernah menyimpan bug yang tidak terlihat selama dua rilis:
 *
 * ```ts
 * git tag --list --merged HEAD --sort=-v:refname --match 'v[0-9]*'
 * ```
 *
 * `git tag` **tidak punya** opsi `--match` — itu opsi `git branch` dan `git for-each-ref`;
 * `git tag` menerima pola sebagai argumen posisi. Perintahnya gagal setiap kali, galatnya ditelan
 * pembungkus yang mengembalikan `null`, dan hasilnya terbaca sebagai "repositori belum punya tag".
 * Akibatnya rilis kedua menghitung ulang seluruh riwayat dan keluar sebagai `0.5.0` untuk satu
 * perbaikan, sekaligus menaikkan versi algoritma tanpa sebab.
 *
 * Aturan yang dipegang berkas ini sejak itu: **kegagalan git tidak pernah berarti "tidak ada"**.
 * `git()` melempar, dan hanya pertanyaan yang jawabannya memang boleh kosong yang menafsirkan
 * keluaran kosong sebagai `null` — dengan komentar yang menyebutkan alasannya.
 */
import { execFileSync } from 'node:child_process';
import type { Commit } from './version.ts';

/**
 * Jalankan git di dalam `repo` dan kembalikan stdout-nya.
 *
 * Galat dilempar, tidak ditelan. Perintah git yang salah tulis adalah kesalahan program, dan
 * kesalahan program yang disembunyikan akan muncul kembali sebagai keputusan yang salah.
 */
export function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Tag rilis terakhir yang dapat dijangkau dari HEAD, atau `null` bila memang belum ada.
 *
 * Polanya (`v[0-9]*`) diberikan sebagai argumen posisi, bukan sebagai opsi. Urutannya
 * `-v:refname` sehingga `v0.10.0` berada di atas `v0.9.0` — pengurutan teks biasa akan salah.
 */
export function lastTag(repo: string): string | null {
  const list = git(repo, [
    'tag',
    '--list',
    '--merged',
    'HEAD',
    '--sort=-v:refname',
    'v[0-9]*',
  ]).trim();

  if (list.length === 0) return null;
  return list.split('\n')[0]?.trim() ?? null;
}

/**
 * Commit pada rentang, **terbaru lebih dulu** — sama seperti keluaran `git log`.
 *
 * Badan commit ikut diambil karena ia memuat badan pull request pada squash merge. Penyaringan
 * commit rilis dilakukan pemanggil, bukan di sini: berkas ini hanya membaca git.
 */
export function commitsSince(repo: string, range: string): Commit[] {
  const raw = git(repo, ['log', '--format=%s%x1f%b%x1e', range]);
  const commits: Commit[] = [];

  for (const record of raw.split('\x1e')) {
    const trimmed = record.replace(/^\n/, '');
    if (trimmed.trim().length === 0) continue;

    const [subject = '', body = ''] = trimmed.split('\x1f');
    commits.push({ subject, body });
  }

  return commits;
}

/** Berkas yang berubah pada rentang. Rentang yang tidak ada akan melempar, bukan mengembalikan kosong. */
export function changedFiles(repo: string, range: string): string[] {
  return git(repo, ['diff', '--name-only', range])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `true` bila tag dengan nama itu sudah ada. */
export function tagExists(repo: string, tag: string): boolean {
  return git(repo, ['tag', '--list', tag]).trim().length > 0;
}
