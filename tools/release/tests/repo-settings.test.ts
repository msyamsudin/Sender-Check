import { describe, expect, it } from 'vitest';
import {
  DECLARED_SETTINGS,
  findSettingProblems,
  slugFromRemote,
} from '../../../tools/check-repo-settings.ts';

/**
 * Uji logika pemeriksa setelan repositori.
 *
 * Pemeriksaannya sendiri tidak dapat berjalan di CI — `GITHUB_TOKEN` tidak punya izin membaca
 * setelan repositori — jadi yang bisa diuji adalah penilaiannya: apakah ia menangkap setelan
 * yang berubah, dan apakah ia menolak menyimpulkan apa pun ketika medannya tidak ada di respons.
 */

describe('findSettingProblems', () => {
  const declared = [
    { key: 'delete_branch_on_merge', expected: true, reason: 'branch sisa menumpuk tanpa ini' },
  ];

  it('menerima setelan yang sesuai', () => {
    expect(findSettingProblems({ delete_branch_on_merge: true }, declared)).toEqual([]);
  });

  it('menangkap setelan yang berubah, beserta alasan mengapa ia penting', () => {
    const problems = findSettingProblems({ delete_branch_on_merge: false }, declared);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('bernilai false, seharusnya true');
    expect(problems[0]?.reason).toContain('branch sisa menumpuk tanpa ini');
  });

  it('menolak menyimpulkan apa pun bila medannya tidak ada di respons', () => {
    // Medan yang hilang dari respons adalah keadaan yang benar-benar terjadi pada pemanggil
    // tanpa kredensial: seluruh medan setelan tidak ada di sana. Membacanya sebagai "cocok"
    // akan membuat pemeriksaan yang tidak terjadi tampak lulus.
    const problems = findSettingProblems({}, declared);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toContain('tidak ada pada respons API');
  });
});

describe('slugFromRemote', () => {
  it('membaca bentuk https dan ssh', () => {
    expect(slugFromRemote('https://github.com/msyamsudin/Sender-Check.git')).toBe(
      'msyamsudin/Sender-Check',
    );
    expect(slugFromRemote('git@github.com:msyamsudin/Sender-Check.git')).toBe(
      'msyamsudin/Sender-Check',
    );
    expect(slugFromRemote('https://github.com/msyamsudin/Sender-Check')).toBe(
      'msyamsudin/Sender-Check',
    );
  });

  it('mengembalikan null untuk remote yang bukan GitHub', () => {
    expect(slugFromRemote('https://gitlab.com/msyamsudin/Sender-Check.git')).toBeNull();
  });
});

describe('setelan yang dinyatakan', () => {
  it('setiap setelan membawa alasan mengapa proyek bergantung padanya', () => {
    // Tanpa alasan, daftar ini akan menjadi tempat menaruh setelan yang tidak ada yang tahu
    // mengapa ia harus begitu — dan pemeriksaan yang alasannya hilang akan dihapus orang
    // berikutnya tanpa penyesalan.
    for (const setting of DECLARED_SETTINGS) {
      expect(setting.reason.length, setting.key).toBeGreaterThan(20);
    }
    expect(DECLARED_SETTINGS.length).toBeGreaterThan(0);
  });
});
