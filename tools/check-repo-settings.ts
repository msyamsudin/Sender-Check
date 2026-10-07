/**
 * Pemeriksa setelan repositori yang diandalkan alur kerja proyek.
 *
 * Setelan ini hidup **di luar repositori**: tidak ada berkas di sini yang memuatnya, tidak ada
 * diff yang menunjukkannya berubah, dan tidak ada test yang gagal kalau ia dimatikan. Itu jenis
 * keadaan yang sama dengan angka dokumentasi yang basi dan direktori yang disebut kosong — yang
 * berbeda hanya tempatnya. Proyek ini bahkan sudah bergantung padanya tanpa pernah menuliskannya:
 * `delete_branch_on_merge` dinyalakan pada 7 Oktober 2026 supaya branch sisa seperti milik PR #10
 * tidak menumpuk lagi, dan `allow_squash_merge` adalah alasan catatan rilis dapat mengambil nomor
 * pull request dari judul commit.
 *
 * ## Kenapa ia tidak berjalan di CI
 *
 * Setelan repositori dibaca lewat `api.github.com`, dan endpoint itu tidak memuat medan setelan
 * untuk pemanggil tanpa kredensial — sudah diuji: `delete_branch_on_merge` tidak ada di responsnya.
 * Di dalam workflow, satu-satunya kredensial yang tersedia adalah `GITHUB_TOKEN`, dan daftar izin
 * token itu tidak punya `administration`, sehingga ia **tidak dapat** membaca setelan repositori.
 * Satu-satunya jalan lain adalah menyimpan token pribadi sebagai secret, dan itu biaya yang tidak
 * sebanding untuk dua medan.
 *
 * Karena itu pemeriksa ini adalah pemeriksaan pemelihara: dijalankan dengan kredensial yang
 * memang punya hak, dan **mengatakan terus terang bila ia tidak dapat memeriksa** — bukan keluar
 * dengan kode 0 seolah-olah sudah memeriksa. Diamnya sebuah pemeriksaan adalah kegagalannya.
 *
 * ```bash
 * pnpm repo:settings
 * ```
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './release/src/git.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Setelan yang dinyatakan, beserta alasan proyek ini bergantung padanya. */
export interface DeclaredSetting {
  readonly key: string;
  readonly expected: boolean;
  readonly reason: string;
}

export const DECLARED_SETTINGS: readonly DeclaredSetting[] = [
  {
    key: 'delete_branch_on_merge',
    expected: true,
    reason:
      'tanpa ini, branch setiap pull request yang di-squash merge tertinggal di origin — keadaannya sama dengan branch milik PR #10 yang ditemukan masih ada pada 7 Oktober 2026',
  },
  {
    key: 'allow_squash_merge',
    expected: true,
    reason:
      'catatan rilis dibentuk dari judul dan badan commit hasil squash, dan nomor pull request di dalamnya datang dari judul itu; merge biasa akan membuat penunjuknya hilang',
  },
];

export interface SettingProblem {
  readonly key: string;
  readonly reason: string;
}

/** Membandingkan setelan yang dinyatakan dengan keadaan sebenarnya. */
export function findSettingProblems(
  live: Readonly<Record<string, unknown>>,
  declared: readonly DeclaredSetting[] = DECLARED_SETTINGS,
): readonly SettingProblem[] {
  const problems: SettingProblem[] = [];

  for (const setting of declared) {
    if (!(setting.key in live)) {
      problems.push({
        key: setting.key,
        reason: `setelan "${setting.key}" tidak ada pada respons API, sehingga nilainya tidak dapat dipastikan — dan penjaga yang tidak dapat memastikan bukan penjaga`,
      });
      continue;
    }

    if (live[setting.key] !== setting.expected) {
      problems.push({
        key: setting.key,
        reason: `setelan "${setting.key}" bernilai ${String(live[setting.key])}, seharusnya ${String(setting.expected)}: ${setting.reason}`,
      });
    }
  }

  return problems;
}

/** `owner/repo` dari remote origin, atau `null` bila bentuknya tidak dikenali. */
export function slugFromRemote(url: string): string | null {
  const match = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(url.trim());
  if (match === null) return null;
  return `${match[1]}/${match[2]}`;
}

/** Membaca setelan repositori lewat `gh`, yang memakai kredensial pemanggilnya. */
export function readLiveSettings(slug: string): Record<string, unknown> {
  const raw = execFileSync('gh', ['api', `repos/${slug}`], { encoding: 'utf8' });
  return JSON.parse(raw) as Record<string, unknown>;
}

/** `true` bila berkas ini dijalankan langsung, bukan diimpor sebagai modul. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const remote = git(repoRoot, ['remote', 'get-url', 'origin']).trim();
  const slug = slugFromRemote(remote);
  const declared = DECLARED_SETTINGS.map((setting) => setting.key).join(', ');

  if (slug === null) {
    console.log(`remote origin tidak menunjuk repositori GitHub: ${remote}`);
    process.exitCode = 1;
  } else {
    let live: Record<string, unknown> | null = null;
    let blocked = '';

    try {
      live = readLiveSettings(slug);
    } catch (error) {
      blocked = error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error);
    }

    if (live === null) {
      console.log(`repositori   : ${slug}`);
      console.log(`setelan      : ${declared}`);
      console.log('');
      console.log('TIDAK DAPAT DIPERIKSA');
      console.log(`sebab        : ${blocked}`);
      console.log('');
      console.log('Pemeriksaan ini menuntut kredensial yang boleh membaca setelan repositori.');
      console.log('Di dalam workflow, GITHUB_TOKEN tidak punya izin itu — lihat catatan di berkas ini.');
      process.exitCode = 1;
    } else {
      const problems = findSettingProblems(live);

      console.log(`repositori   : ${slug}`);
      console.log(`setelan      : ${declared}`);

      if (problems.length === 0) {
        console.log('setelan yang diandalkan sesuai dengan yang dinyatakan');
      } else {
        console.log('');
        for (const problem of problems) {
          console.log(`MASALAH  ${problem.key}`);
          console.log(`         ${problem.reason}`);
        }
        console.log('');
        console.log(`${problems.length} masalah ditemukan`);
        process.exitCode = 1;
      }
    }
  }
}
