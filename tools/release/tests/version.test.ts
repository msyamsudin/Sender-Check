import { describe, expect, it } from 'vitest';
import {
  bump,
  bumpKind,
  classify,
  conventionalType,
  formatVersion,
  indexRow,
  isBreaking,
  isNewer,
  isReleaseCommit,
  parseVersion,
  plainSubject,
  renderNotes,
  summarize,
  type Commit,
} from '../src/version.ts';

/**
 * Test untuk aturan rilis otomatis.
 *
 * Ini satu-satunya penjaga aturan yang **tidak diperiksa manusia**: rilis berjalan tanpa siapa pun
 * menekan tombol, sehingga versi yang salah tidak akan terlihat sampai tag tersebar. Karena itu
 * test di sini bukan pelengkap, melainkan pengganti mata manusia.
 */

const feat = (subject: string, body = ''): Commit => ({ subject, body });

describe('versi', () => {
  it('mengurai dan memformat x.y.z', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });

  it('melempar untuk versi yang tidak dikenali, bukan menebak', () => {
    // Versi yang tidak terbaca harus gagal: menebaknya berarti menandai tag yang salah.
    expect(() => parseVersion('0.4')).toThrow();
    expect(() => parseVersion('v0.4.0')).toThrow();
  });

  it('menaikkan menurut jenisnya', () => {
    expect(bump('0.3.0', 'major')).toBe('1.0.0');
    expect(bump('0.3.0', 'minor')).toBe('0.4.0');
    expect(bump('0.3.0', 'patch')).toBe('0.3.1');
  });

  it('membandingkan versi', () => {
    expect(isNewer('0.4.0', '0.3.0')).toBe(true);
    expect(isNewer('0.3.1', '0.3.0')).toBe(true);
    expect(isNewer('0.3.0', '0.3.0')).toBe(false);
    expect(isNewer('0.2.9', '0.3.0')).toBe(false);
  });
});

describe('membaca commit', () => {
  it('mengenali tipe konvensional, dengan atau tanpa scope', () => {
    expect(conventionalType('feat: panel')).toBe('feat');
    expect(conventionalType('fix(panel): teks')).toBe('fix');
    expect(conventionalType('feat!: ubah kontrak')).toBe('feat');
    expect(conventionalType('perbaiki teks panel')).toBeNull();
  });

  it('mengenali perubahan yang merusak, di judul maupun di badan', () => {
    expect(isBreaking(feat('feat!: buang opsi lama'))).toBe(true);
    expect(isBreaking(feat('feat: tambah opsi', 'BREAKING CHANGE: opsi lama dibuang'))).toBe(true);
    expect(isBreaking(feat('feat: tambah opsi', 'BREAKING-CHANGE: opsi lama dibuang'))).toBe(true);
    expect(isBreaking(feat('feat: tambah opsi'))).toBe(false);
  });

  it('mengecualikan commit yang ditulis otomatisasi rilis', () => {
    // Tanpa ini, rilis pertama memicu rilis kedua: commit rilis terlihat seperti perubahan.
    expect(isReleaseCommit('chore(release): 0.4.0')).toBe(true);
    expect(isReleaseCommit('chore: rapikan berkas')).toBe(false);
  });

  it('memilih jenis kenaikan dari daftar commit', () => {
    expect(bumpKind([feat('feat: sesuatu')])).toBe('minor');
    expect(bumpKind([feat('fix: sesuatu')])).toBe('patch');
    expect(bumpKind([feat('docs: sesuatu')])).toBe('patch');
    expect(bumpKind([feat('fix: sesuatu'), feat('feat!: sesuatu')])).toBe('major');
    // Judul yang tidak mengikuti bentuk konvensional tetap menghasilkan rilis: perubahan yang
    // tidak pernah dirilis lebih buruk daripada rilis yang nomornya kurang tepat.
    expect(bumpKind([feat('perbaiki panel')])).toBe('patch');
  });

  it('menempatkan commit ke bagian catatan rilis', () => {
    expect(classify(feat('feat: a'))).toBe('added');
    expect(classify(feat('fix: a'))).toBe('fixed');
    expect(classify(feat('perf: a'))).toBe('changed');
    expect(classify(feat('docs: a'))).toBe('docs');
    expect(classify(feat('chore: a'))).toBe('internal');
    expect(classify(feat('tanpa tipe'))).toBe('internal');
  });
});

describe('ringkasan dan baris indeks', () => {
  it('membuang awalan tipe dan nomor pull request', () => {
    expect(plainSubject('feat(panel): satu sebutan untuk nama kosong (#4)')).toBe(
      'Satu sebutan untuk nama kosong',
    );
  });

  it('membatasi jumlah dan panjang judul', () => {
    const commits = [
      feat('feat: satu'),
      feat('fix: dua'),
      feat('docs: tiga'),
      feat('chore: empat'),
    ];

    expect(summarize(commits)).toBe('Satu; Dua; Tiga; +1 lainnya');
    expect(summarize([feat(`feat: ${'x'.repeat(200)}`)])).toHaveLength(120);
  });

  it('menandai versi algoritma yang tidak berubah', () => {
    const unchanged = indexRow({
      version: '0.4.0',
      date: '2026-09-25',
      algorithm: '0.2.0',
      algorithmChanged: false,
      summary: 'Panel preventif',
    });
    const changed = indexRow({
      version: '0.4.0',
      date: '2026-09-25',
      algorithm: '0.2.1',
      algorithmChanged: true,
      summary: 'Ambang baru',
    });

    expect(unchanged).toContain('0.2.0 (tidak berubah)');
    expect(unchanged).toContain('pesan tag `v0.4.0`');
    expect(changed).toContain('| 0.2.1 |');
  });
});

describe('catatan rilis', () => {
  const NOTES = renderNotes({
    version: '0.4.0',
    date: '2026-09-25',
    algorithm: '0.2.1',
    previousAlgorithm: '0.2.0',
    corpus: 'Corpus: 404 kasus · presisi (flagged HIGH) 100.0%',
    baseline: 'v0.3.0',
    commits: [
      feat('feat: panel preventif (#4)', 'Menjelaskan mengapa panel tidak menilai.\n\nCo-authored-by: X <x@example.com>'),
      feat('fix: klaim palsu dicabut (#5)', 'Klaim itu salah sejak awal.'),
      feat('chore: rapikan skrip'),
    ],
  });

  it('memuat baris ALGORITHM_VERSION yang diperiksa penjaga CI', () => {
    // Penjaga `release-check` mencari bentuk ini di pesan tag. Kalau bentuknya berubah di sini,
    // rilis manual akan gagal dan rilis otomatis kehilangan satu-satunya catatan versinya.
    expect(NOTES).toContain('ALGORITHM_VERSION: 0.2.1');
  });

  it('memuat metrik corpus apa adanya', () => {
    expect(NOTES).toContain('Corpus: 404 kasus · presisi (flagged HIGH) 100.0%');
  });

  it('mengelompokkan commit ke bagian yang dapat dibaca', () => {
    expect(NOTES).toContain('### Ditambahkan');
    expect(NOTES).toContain('### Diperbaiki');
    expect(NOTES).toContain('### Internal');
    expect(NOTES.indexOf('### Ditambahkan')).toBeLessThan(NOTES.indexOf('### Diperbaiki'));
  });

  it('membawa badan commit, dan membuang trailer yang ditambahkan GitHub', () => {
    // Badan commit adalah tempat kalimat yang tidak dapat dihasilkan mesin: pencabutan klaim dan
    // alasan sebuah keputusan berubah. Trailer ko-penulis tidak memberi informasi kepada pembaca.
    expect(NOTES).toContain('  Menjelaskan mengapa panel tidak menilai.');
    expect(NOTES).toContain('  Klaim itu salah sejak awal.');
    expect(NOTES).not.toContain('Co-authored-by');
  });

  it('menyebut rentang commitnya, dan menjelaskan kenaikan tanpa tag rujukan', () => {
    expect(NOTES).toContain('v0.3.0..HEAD');

    const first = renderNotes({
      version: '0.4.0',
      date: '2026-09-25',
      algorithm: '0.2.1',
      previousAlgorithm: '0.2.0',
      corpus: 'Corpus: 1 kasus',
      baseline: null,
      commits: [feat('feat: awal')],
    });

    expect(first).toContain('seluruh riwayat');
    expect(first).toContain('belum ada tag rujukan');
  });

  it('memotong badan yang panjang, dan menunjuk pull request-nya', () => {
    // Badan pull request di repositori ini memuat penalaran panjang. Catatan rilis dibaca untuk
    // tahu apa yang berubah, jadi yang dipotong diberi penunjuk — bukan dibuang tanpa jejak.
    const long = renderNotes({
      version: '0.4.0',
      date: '2026-09-25',
      algorithm: '0.2.0',
      previousAlgorithm: '0.2.0',
      corpus: 'Corpus: 1 kasus',
      baseline: 'v0.3.0',
      commits: [feat('feat: sesuatu (#7)', Array.from({ length: 60 }, (_, i) => `baris ${i}`).join('\n'))],
    });

    expect(long).toContain('  baris 0');
    expect(long).not.toContain('  baris 59');
    expect(long).toContain('Selengkapnya: pull request #7');
  });

  it('tanpa tag rujukan, hanya badan commit yang memicu rilis yang dibawa', () => {
    // Pernah terjadi pada `v0.4.0`: badan pull request lama ikut terbawa dan menyatakan
    // "ALGORITHM_VERSION tetap 0.2.0" tepat di bawah baris kepala yang menyebut `0.2.1`. Judulnya
    // tetap benar, penjelasannya tidak lagi — jadi yang dibuang hanya penjelasannya.
    //
    // Urutan di bawah sengaja mengikuti `git log`: yang memicu rilis lebih dulu. Test versi pertama
    // menuliskan urutannya terbalik, sehingga lolos bersama bug yang mengambil commit paling tua.
    const notes = renderNotes({
      version: '0.4.0',
      date: '2026-09-25',
      algorithm: '0.2.1',
      previousAlgorithm: '0.2.0',
      corpus: 'Corpus: 1 kasus',
      baseline: null,
      commits: [
        feat('feat: perubahan yang memicu rilis (#2)', 'Penjelasan untuk rilis ini.'),
        feat('feat: pekerjaan lama (#1)', 'ALGORITHM_VERSION tetap 0.2.0: tidak ada rule.'),
      ],
    });

    expect(notes).toContain('- feat: pekerjaan lama (#1)');
    expect(notes).toContain('Penjelasan untuk rilis ini.');
    expect(notes).not.toContain('ALGORITHM_VERSION tetap 0.2.0');
    expect(notes).toContain('hanya dibawa untuk commit yang memicu rilis ini');
  });

  it('menyatakan versi algoritma yang tidak berubah sebagai tidak berubah', () => {
    const notes = renderNotes({
      version: '0.4.0',
      date: '2026-09-25',
      algorithm: '0.2.0',
      previousAlgorithm: '0.2.0',
      corpus: 'Corpus: 1 kasus',
      baseline: 'v0.3.0',
      commits: [feat('feat: sesuatu')],
    });

    expect(notes).toContain('ALGORITHM_VERSION: 0.2.0 (tidak berubah)');
  });
});
