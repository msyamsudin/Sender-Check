import { describe, expect, it } from 'vitest';
import { CONFUSABLES_COUNT, CONFUSABLES_RAW } from '../src/data/confusables.generated.ts';
import { mapConfusables, toSkeleton } from '../src/normalize/confusables.ts';
import { digitFoldVariants, foldVariants, isFoldEquivalent, letterFold } from '../src/normalize/fold.ts';
import {
  displayTokens,
  normalizeForComparison,
  normalizeText,
  stripDiacritics,
  tokenize,
} from '../src/normalize/index.ts';
import { decodePunycodeLabel, hasPunycodeLabel, punycodeToUnicode } from '../src/normalize/punycode.ts';
import { analyzeScripts, isAsciiAlphanumeric } from '../src/normalize/scripts.ts';

/**
 * Sampel yang dipilih untuk menyerang normalisasi, bukan untuk membuatnya terlihat
 * baik: kompatibilitas (½, Ⅻ), ligatur (ﬁ, ﬀ), lebar penuh, tanda diakritik lepas,
 * karakter tak terlihat, dan karakter yang berubah bentuk setelah NFKC.
 */
const TRICKY_SAMPLES: readonly string[] = [
  'Budi Santoso',
  'BUDI_SANTOSO',
  'budi.santoso',
  'José Álvarez',
  'JOSÉ ÁLVAREZ',
  'jose.alvarez',
  'İstanbul',
  'Istanbul',
  'Ångström',
  'angstrom',
  'ﬁle',
  'file',
  'ﬀ',
  'ff',
  '½',
  'Ⅻ',
  '①',
  'ｆｕｌｌｗｉｄｔｈ',
  'fullwidth',
  'Ωμέγα',
  'Москва',
  '東京',
  '한국',
  'भारत',
  'مثال',
  'e\u0301',
  'é',
  'a\u00ADb',
  'ab',
  'x\u200By',
  'xy',
  'ẛ',
  's\u0307',
  'KK',
  'K K',
  'Test  Multiple   Spaces',
  '  padded  ',
  '',
  '   ',
  '\u0000\u001f',
  'pernah',
  'modern',
  'internet',
  'gojek',
  'paypa1',
];

function confusableEntries(): Array<[number, string]> {
  const entries: Array<[number, string]> = [];
  for (const line of CONFUSABLES_RAW.split('\n')) {
    if (line.length === 0) continue;
    const separator = line.indexOf(':');
    entries.push([Number.parseInt(line.slice(0, separator), 16), line.slice(separator + 1)]);
  }
  return entries;
}

describe('normalisasi: sifat idempoten', () => {
  it('normalizeForComparison(normalizeForComparison(x)) === normalizeForComparison(x)', () => {
    for (const sample of TRICKY_SAMPLES) {
      const once = normalizeForComparison(sample);
      const twice = normalizeForComparison(once);
      expect(twice, `sampel ${JSON.stringify(sample)}`).toBe(once);
    }
  });

  it('toSkeleton(toSkeleton(x)) === toSkeleton(x)', () => {
    for (const sample of TRICKY_SAMPLES) {
      const once = toSkeleton(sample);
      const twice = toSkeleton(once);
      expect(twice, `sampel ${JSON.stringify(sample)}`).toBe(once);
    }
  });

  it('normalizeText menghasilkan tiga representasi dan original tidak pernah diubah', () => {
    const result = normalizeText('  José   ÁLVAREZ  ');
    expect(result.original).toBe('  José   ÁLVAREZ  ');
    expect(result.normalized).toBe('jose alvarez');
    expect(result.skeleton).toBe('jose alvarez');
  });
});

describe('normalisasi: invarian yang diminta desain', () => {
  it('kapitalisasi tidak mengubah hasil', () => {
    expect(normalizeForComparison('John Smith')).toBe(normalizeForComparison('JOHN SMITH'));
  });

  it('diakritik tidak mengubah hasil', () => {
    expect(normalizeForComparison('José Álvarez')).toBe(normalizeForComparison('Jose Alvarez'));
    expect(normalizeForComparison('café')).toBe(normalizeForComparison('cafe'));
  });

  it('pemisah ekuivalen menghasilkan token yang sama', () => {
    const variants = ['john.smith', 'john_smith', 'john-smith', 'john smith', 'john+smith'];
    const tokenSets = variants.map((value) => tokenize(value).join('|'));
    expect(new Set(tokenSets).size).toBe(1);
  });

  it('karakter tak terlihat dibuang, sehingga penyisipan tidak menyamarkan teks', () => {
    expect(normalizeForComparison('goog\u200Ble')).toBe('google');
    expect(toSkeleton('goog\u200Ble')).toBe(toSkeleton('google'));
  });
});

describe('skeleton TR39', () => {
  it('memetakan homoglyph Cyrillic dan Greek ke Latin', () => {
    // NFKC tidak melakukan ini, dan itulah alasan skeleton diperlukan.
    expect('а'.normalize('NFKC')).toBe('а');
    expect(toSkeleton('а')).toBe('a');
    expect(toSkeleton('gооgle')).toBe('google');
    expect(toSkeleton('аmazon')).toBe('amazon');
    expect(toSkeleton('раypal')).toBe('paypal');
    expect(toSkeleton('ο')).toBe('o');
    expect(toSkeleton('ѕ')).toBe('s');
    expect(toSkeleton('ı')).toBe('i');
  });

  it('tidak menganggap perbedaan diakritik sebagai perbedaan homoglyph', () => {
    // Diakritik adalah urusan normalisasi, bukan skeleton. Mencampur keduanya akan
    // menaikkan severity rule secara salah: "café" dan "cafe" akan terlihat sebagai
    // serangan homoglyph padahal hanya beda ejaan.
    expect(toSkeleton('café')).not.toBe(toSkeleton('cafe'));
    expect(toSkeleton(normalizeForComparison('café'))).toBe(toSkeleton('cafe'));
  });

  it('tabel confusable utuh dan hanya bersumber non-ASCII', () => {
    const entries = confusableEntries();
    expect(entries.length).toBe(CONFUSABLES_COUNT);
    for (const [cp, target] of entries) {
      expect(cp, 'sumber ASCII bocor ke tabel').toBeGreaterThan(0x7f);
      expect(target).toMatch(/^[a-z0-9]+$/);
      expect(target.length).toBeLessThanOrEqual(3);
    }
  });

  it('setiap entri tabel idempoten', () => {
    for (const [cp, target] of confusableEntries()) {
      const source = String.fromCodePoint(cp);
      const skeleton = toSkeleton(source);
      expect(toSkeleton(skeleton), `U+${cp.toString(16)}`).toBe(skeleton);
      // Sumber non-ASCII harus benar-benar berubah, kecuali bila dekomposisinya
      // memindahkannya ke karakter lain lebih dulu.
      if (source.normalize('NFD') === source) {
        expect(skeleton, `U+${cp.toString(16)} -> ${target}`).toContain(target);
      }
    }
  });

  it('mapConfusables membiarkan karakter yang tidak dikenal', () => {
    expect(mapConfusables('abc123')).toBe('abc123');
  });
});

describe('punycode (RFC 3492)', () => {
  it('mendekode label punycode yang sah', () => {
    // Nilai acuan dari contoh IDN yang sudah mapan.
    expect(punycodeToUnicode('xn--mnchen-3ya.de')).toBe('münchen.de');
    expect(punycodeToUnicode('xn--bcher-kva.ch')).toBe('bücher.ch');
    expect(decodePunycodeLabel('mnchen-3ya')).toBe('münchen');
    expect(decodePunycodeLabel('warung-gva')).toBe('warungé');
    expect(punycodeToUnicode('xn--fiqs8s')).toBe('中国');
    expect(punycodeToUnicode('xn--p1ai')).toBe('рф');
  });

  it('mendekode label Cyrillic homoglyph, yang menjadi inti deteksi', () => {
    // Tanpa decoder ini, seluruh domain homoglyph berpunycode tidak akan pernah
    // terdeteksi, karena Chrome sengaja mempertahankan bentuk xn-- pada URL.
    expect(punycodeToUnicode('xn--pypal-4ve.com')).toBe('pаypal.com');
    expect(toSkeleton(punycodeToUnicode('xn--pypal-4ve.com').split('.')[0] ?? '')).toBe('paypal');

    expect(punycodeToUnicode('xn--80ak6aa92e.com')).toBe('аррӏе.com');
    expect(toSkeleton(punycodeToUnicode('xn--80ak6aa92e.com').split('.')[0] ?? '')).toBe('apple');
  });

  it('hostname non-punycode dikembalikan apa adanya', () => {
    expect(punycodeToUnicode('example.com')).toBe('example.com');
    expect(hasPunycodeLabel('example.com')).toBe(false);
    expect(hasPunycodeLabel('xn--mnchen-3ya.de')).toBe(true);
  });

  it('label yang rusak tidak pernah melempar', () => {
    for (const broken of ['', '-', '!!!', 'a-', 'xn--', 'a'.repeat(5000), 'zzzz-zzzz-zzzz']) {
      expect(() => decodePunycodeLabel(broken)).not.toThrow();
    }
    expect(decodePunycodeLabel('!!!')).toBeNull();
  });

  it('gagal mendekode satu label mengembalikan seluruh hostname apa adanya', () => {
    // Supaya pemanggil tidak pernah membandingkan campuran bentuk ASCII dan Unicode.
    const hostname = 'xn--!!!.example.com';
    expect(punycodeToUnicode(hostname)).toBe(hostname);
  });
});

describe('fold digit dan huruf', () => {
  it('menolak mem-fold kata asli yang mengandung rn atau vv', () => {
    // Tanpa penjaga ini, confusables.txt sendiri membuat "modern" setara "modem".
    expect(letterFold('modern')).toBeNull();
    expect(letterFold('internet')).toBeNull();
    expect(letterFold('pernah')).toBeNull();
    expect(letterFold('turnamen')).toBeNull();
    expect(isFoldEquivalent('modern', 'modem')).toBe(false);
  });

  it('tetap mem-fold token yang bukan kata asli', () => {
    expect(letterFold('arnazon')).toBe('amazon');
    expect(letterFold('vvhatsapp')).toBe('whatsapp');
    expect(isFoldEquivalent('arnazon', 'amazon')).toBe(true);
  });

  it('menghasilkan kandidat substitusi digit dan tidak pernah mengembalikan bentuk asli', () => {
    expect(digitFoldVariants('paypa1')).toContain('paypal');
    expect(digitFoldVariants('paypa1')).not.toContain('paypa1');
    expect(digitFoldVariants('g00gle')).toContain('google');
    expect(digitFoldVariants('abc')).toEqual([]);
    expect(foldVariants('paypal')).toEqual([]);
  });

  it('membatasi jumlah varian agar input jahat tidak meledak', () => {
    const variants = foldVariants('1111111111');
    expect(variants.length).toBeLessThanOrEqual(8);
  });
});

describe('deteksi aksara', () => {
  it('mengenali ASCII sebagai Latin tunggal', () => {
    const analysis = analyzeScripts('google');
    expect(analysis.singleScript).toBe(true);
    expect(analysis.suspiciousMix).toBe(false);
    expect(isAsciiAlphanumeric('google')).toBe(true);
  });

  it('menandai Latin bercampur Cyrillic dalam satu label sebagai campuran mencurigakan', () => {
    const analysis = analyzeScripts('gооgle');
    expect(analysis.singleScript).toBe(false);
    expect(analysis.suspiciousMix).toBe(true);
  });

  it('tidak menuduh aksara tunggal non-Latin sebagai campuran', () => {
    for (const sample of ['Москва', '東京', '한국', 'भारत', 'مثال', 'Ωμέγα']) {
      const analysis = analyzeScripts(sample);
      expect(analysis.suspiciousMix, sample).toBe(false);
    }
  });

  it('mengizinkan sintesis aksara yang sah (Jepang dan Korea)', () => {
    // Bahasa Jepang memang mencampur Kanji, Hiragana, dan Katakana. Menuduh setiap
    // teks multi-aksara sebagai serangan akan salah untuk seluruh pengguna Jepang.
    expect(analyzeScripts('東京タワー').suspiciousMix).toBe(false);
    expect(analyzeScripts('ひらがなカタカナ漢字').suspiciousMix).toBe(false);
    expect(analyzeScripts('한국어漢字').suspiciousMix).toBe(false);
  });

  it('menandai campuran Latin dengan aksara non-confusable sebagai campuran ringan', () => {
    const analysis = analyzeScripts('budiمحمد');
    expect(analysis.suspiciousMix).toBe(false);
    expect(analysis.benignMix).toBe(true);
  });
});

describe('tokenisasi', () => {
  it('mempertahankan aksara asli supaya kanal homoglyph tetap punya bahan', () => {
    const tokens = displayTokens('Gооgle Support');
    expect(tokens[0]?.value).toBe('gооgle');
    expect(tokens[0]?.skeleton).toBe('google');
    expect(tokens[0]?.hasNonAscii).toBe(true);
  });

  it('menandai inisial satu huruf', () => {
    const tokens = displayTokens('J. Smith');
    expect(tokens.map((token) => token.isInitial)).toEqual([true, false]);
  });

  it('stripDiacritics tidak mengubah karakter dasar', () => {
    expect(stripDiacritics('José')).toBe('Jose');
    expect(stripDiacritics('Ångström')).toBe('Angstrom');
  });
});
