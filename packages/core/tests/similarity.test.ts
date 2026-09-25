import { describe, expect, it } from 'vitest';
import {
  JARO_WINKLER_THRESHOLD,
  MIN_FUZZY_LENGTH,
  bestSimilarity,
  damerauLevenshtein,
  editSimilarity,
  isMeaningfullySimilar,
  isPrefixOrSuffixMatch,
  jaroWinkler,
  longestCommonSubstringLength,
} from '../src/similarity/index.ts';

describe('Jaro-Winkler', () => {
  it('memberi 1 untuk string identik dan 0 untuk tanpa kecocokan', () => {
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });

  it('memberi bonus common prefix seperti spesifikasi', () => {
    // Sifat inilah yang membuat JW berbahaya pada string pendek: "bca" dan "bcapro"
    // mendapat skor tinggi hanya karena tiga huruf pertama sama.
    expect(jaroWinkler('rise', 'risehq')).toBeGreaterThan(jaroWinkler('rise', 'xisehq'));
  });
});

describe('Damerau-Levenshtein', () => {
  it('menghitung transposisi sebagai satu langkah', () => {
    expect(damerauLevenshtein('traveloka', 'taveloka')).toBe(1);
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
  });

  it('menghitung sisip, hapus, dan ganti sebagai satu langkah', () => {
    expect(damerauLevenshtein('bca', 'bcaa')).toBe(1);
    expect(damerauLevenshtein('shopee', 'shope')).toBe(1);
    expect(damerauLevenshtein('bnl', 'bni')).toBe(1);
  });

  it('kemiripan edit dinormalkan ke 0..1', () => {
    expect(editSimilarity('abc', 'abc')).toBe(1);
    expect(editSimilarity('abcd', 'abce')).toBeCloseTo(0.75, 5);
  });
});

describe('substring bersama terpanjang', () => {
  it('menemukan panjang yang benar', () => {
    expect(longestCommonSubstringLength('risehq', 'rise')).toBe(4);
    expect(longestCommonSubstringLength('abc', 'xyz')).toBe(0);
    expect(longestCommonSubstringLength('', 'abc')).toBe(0);
  });
});

describe('bestSimilarity: aturan panjang token', () => {
  it('menerima kecocokan persis sejak tiga karakter', () => {
    const hit = bestSimilarity('bca', 'bca');
    expect(hit?.method).toBe('EXACT');
    expect(hit?.score).toBe(1);
  });

  it('menolak kecocokan persis di bawah tiga karakter', () => {
    // Token dua huruf terlalu pendek untuk membuktikan apa pun.
    expect(bestSimilarity('ab', 'ab')).toBeNull();
  });

  it('mengenali awalan dan akhiran sebagai kecocokan, bukan fuzzy', () => {
    expect(bestSimilarity('rise', 'risehq')?.method).toBe('PREFIX_OR_SUFFIX');
    expect(bestSimilarity('rise', 'myrise')?.method).toBe('PREFIX_OR_SUFFIX');
    expect(bestSimilarity('rise', 'risehq')?.score).toBeCloseTo(4 / 6, 5);
  });

  it('tidak memakai ambang kemiripan pada token pendek, hanya jarak satu karakter', () => {
    // "gojek" dan "gojeg" hanya mirip 80%, di bawah ambang 0,9, tetapi berbeda tepat
    // satu karakter sehingga tetap bermakna.
    expect(bestSimilarity('gojek', 'gojeg')?.method).toBe('DAMERAU_LEVENSHTEIN');
    expect(bestSimilarity('gojek', 'gojeg')?.evidence).toContain('satu karakter');

    // Dua perbedaan pada token lima huruf harus ditolak: di situlah risiko FP mulai
    // tidak sepadan.
    expect(bestSimilarity('gojek', 'gojxx')).toBeNull();
  });

  it('memakai ambang kemiripan hanya ketika kedua token cukup panjang', () => {
    const hit = bestSimilarity('microsoft', 'micros0ft');
    expect(hit).not.toBeNull();
    expect(hit?.score).toBeGreaterThanOrEqual(JARO_WINKLER_THRESHOLD);
    expect(MIN_FUZZY_LENGTH).toBe(6);
  });

  it('melaporkan bukti berupa substring, bukan hanya angka', () => {
    const hit = bestSimilarity('rise', 'risehq');
    expect(hit?.evidence).toContain('rise');
    expect(hit?.evidence).toContain('risehq');
  });

  it('mengembalikan null ketika tidak ada kanal yang layak, bukan nilai rendah', () => {
    // null berarti "tidak ada bukti", bukan "tidak cocok". Pemanggil tidak boleh
    // memperlakukannya sebagai bukti ketidakcocokan.
    expect(bestSimilarity('abc', 'xyz')).toBeNull();
    expect(bestSimilarity('', 'abc')).toBeNull();
  });

  it('isPrefixOrSuffixMatch hanya untuk hubungan satu arah', () => {
    expect(isPrefixOrSuffixMatch('bca', 'bcaa')).toBe(true);
    expect(isPrefixOrSuffixMatch('bcaa', 'bca')).toBe(false);
    expect(isPrefixOrSuffixMatch('bca', 'bca')).toBe(false);
  });

  it('isMeaningfullySimilar tidak menghitung kecocokan substring longgar', () => {
    // "bca" tertanam di tengah "xbcay": cukup untuk sinyal lemah, tidak cukup untuk
    // disebut kecocokan yang bermakna.
    expect(bestSimilarity('bca', 'xbcay')?.method).toBe('CONTAINS');
    expect(isMeaningfullySimilar('bca', 'xbcay')).toBe(false);
    expect(isMeaningfullySimilar('bca', 'bca')).toBe(true);
  });

  it('awalan dan akhiran bukan kecocokan longgar', () => {
    // "signals" adalah akhiran sah dari "37signals", jadi ia diklasifikasikan sebagai
    // hubungan awalan/akhiran, bukan substring longgar.
    expect(bestSimilarity('signals', '37signals')?.method).toBe('PREFIX_OR_SUFFIX');
  });
});
