import { describe, expect, it } from 'vitest';
import { fakeDocument, type ElementInit } from '../../../packages/adapters/tests/fake-dom.ts';
import { analyzeList, isTruncatedName, TRUNCATED_NAME_LENGTH } from '../src/lib/scan.ts';

/**
 * Indikator tampilan daftar: kapan sebuah baris menerima penanda, dan kapan tidak.
 *
 * Yang diuji di sini bukan apakah selector cocok dengan Gmail (itu urusan snapshot di
 * `packages/adapters/tests/gmail-snapshots.test.ts`), melainkan dua keputusan yang tidak
 * dapat diuji dari DOM mana pun:
 *
 *  1. nama yang dipotong Gmail **dilewati** — keputusan yang tercatat di §12.1 butir 6;
 *  2. hanya `INCONSISTENT` dengan bukti kuat yang ditandai, sesuai §9.
 *
 * DOM tiruan dipakai dari helper bersama di `packages/adapters/tests/fake-dom.ts`, bukan
 * helper kedua: dua helper untuk hal yang sama berarti dua versi kebenaran tentang bentuk
 * DOM yang diuji.
 */

/** Satu baris tampilan daftar, lengkap dengan `role="row"` yang dijadikan jangkarnya. */
function listRow(displayName: string | null, address: string): ElementInit {
  const sender: ElementInit =
    displayName === null
      ? { tag: 'span', attrs: { email: address }, text: address }
      : { tag: 'span', attrs: { email: address, name: displayName }, text: displayName };

  return {
    tag: 'tr',
    attrs: { role: 'row' },
    children: [{ tag: 'td', attrs: { role: 'gridcell' }, children: [sender] }],
  };
}

/** Baris yang tidak menyediakan pengirim sama sekali — entri `null` pada hasil. */
const emptyRow: ElementInit = {
  tag: 'tr',
  attrs: { role: 'row' },
  children: [{ tag: 'td', attrs: { role: 'gridcell' }, children: [] }],
};

/** Dipangkas persis seperti Gmail: 19 karakter pertama, lalu titik. */
function cutLikeGmail(full: string): string {
  return `${full.slice(0, TRUNCATED_NAME_LENGTH - 1)}.`;
}

describe('deteksi nama potong', () => {
  it('menangkap pola yang benar-benar teramati: 20 karakter dan berakhir titik', () => {
    // Dua contoh asli dari probe inbox 100 baris, dicatat di §12.1 butir 6.
    expect(isTruncatedName('Contoh Sekuritas In.')).toBe(true);
    expect(isTruncatedName('Korea Investment An.')).toBe(true);
    expect('Contoh Sekuritas In.').toHaveLength(TRUNCATED_NAME_LENGTH);
  });

  it('nama utuh tidak dianggap potong, termasuk yang panjang dan yang berakhir titik', () => {
    // Gagal ke arah yang aman: nama yang salah dianggap potong hanya membuat penanda
    // tidak muncul. Yang harus dicegah adalah sebaliknya — menilai nama yang sudah dipotong.
    expect(isTruncatedName('Alpha Capital Group')).toBe(false);
    expect(isTruncatedName('Bank BCA')).toBe(false);
    expect(isTruncatedName('Rise')).toBe(false);
    expect(isTruncatedName('Inc.')).toBe(false);
    expect(isTruncatedName('Korea Investment Holdings.')).toBe(false);
    expect(isTruncatedName(null)).toBe(false);
  });

  it('spasi di belakang tidak mengubah penanda potong', () => {
    expect(isTruncatedName('Contoh Sekuritas In.  ')).toBe(true);
  });
});

describe('penanda per baris', () => {
  it('menandai baris INCONSISTENT berbukti kuat', () => {
    const doc = fakeDocument(listRow('Bank BCA', 'bcaindonesia@gmail.com'));
    const analysis = analyzeList(doc);

    expect(analysis.matched).toBe(true);
    expect(analysis.flags).toHaveLength(1);

    const flag = analysis.flags[0];
    expect(flag?.state).toBe('INCONSISTENT');
    expect(flag?.sourceSelector).toBe('[email]');
    expect(flag?.reason).toBe('Nama pengirim tidak sejalan dengan alamatnya');
  });

  it('melewatkan nama yang dipotong Gmail, walaupun isinya sama dengan yang dinilai thread', () => {
    // Inilah inti keputusan §12.1 butir 6. Nama utuh dan nama potong memakai alamat yang
    // sama; yang utuh ditandai, yang potong tidak — karena thread akan menilai nama utuh,
    // dan dua penilaian berbeda untuk pengirim yang sama adalah hasil yang tidak boleh
    // muncul.
    const full = 'Bank BCA Online Banking';
    expect(cutLikeGmail(full)).toBe('Bank BCA Online Ban.');
    expect(cutLikeGmail(full)).toHaveLength(TRUNCATED_NAME_LENGTH);
    expect(isTruncatedName(cutLikeGmail(full))).toBe(true);

    const whole = analyzeList(fakeDocument(listRow(full, 'bcaindonesia@gmail.com')));
    const cut = analyzeList(fakeDocument(listRow(cutLikeGmail(full), 'bcaindonesia@gmail.com')));

    expect(whole.flags[0], 'nama utuh seharusnya ditandai').not.toBeNull();
    expect(cut.flags[0], 'nama potong seharusnya dilewati').toBeNull();
  });

  it('tidak menandai nama yang tidak ditampilkan sama sekali', () => {
    const analysis = analyzeList(fakeDocument(listRow(null, 'budi@example.org')));

    expect(analysis.matched).toBe(true);
    expect(analysis.flags).toEqual([null]);
  });

  it('hasilnya selalu sebanyak barisnya, termasuk baris yang tidak terbaca', () => {
    // Penanda dipasang berdasarkan indeks, sehingga satu entri yang hilang akan menggeser
    // seluruh penanda sesudahnya ke baris yang salah. Entri `null` bukan kekosongan —
    // ia menjaga kesejajaran.
    const doc = fakeDocument(listRow('Bank BCA', 'bcaindonesia@gmail.com'), emptyRow, listRow('Rise', 'no-reply@mngl.in'));
    const analysis = analyzeList(doc);

    expect(analysis.flags).toHaveLength(3);
    expect(analysis.flags[0]).not.toBeNull();
    expect(analysis.flags[1]).toBeNull();
  });

  it('halaman tanpa baris daftar tidak menghasilkan penanda apa pun', () => {
    const analysis = analyzeList(fakeDocument({ tag: 'div', text: 'bukan daftar' }));

    expect(analysis.matched).toBe(false);
    expect(analysis.flags).toEqual([]);
  });
});
