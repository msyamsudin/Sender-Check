/**
 * Deteksi aksara (script) memakai Unicode property escapes bawaan mesin JS.
 *
 * Kenapa tidak memakai tabel data sendiri: `\p{Script_Extensions=...}` sudah tersedia
 * di Node dan di semua browser modern, sehingga cakupannya selalu mengikuti versi
 * Unicode runtime tanpa satu byte data tambahan.
 *
 * Yang dipakai adalah **Script_Extensions**, bukan **Script**. Perbedaannya penting:
 * sejumlah karakter (mis. tanda baca Jepang, U+30FC) dipakai bersama beberapa aksara,
 * dan memakai `Script` akan salah menuduhnya sebagai pencampuran aksara.
 */

/** Aksara yang secara visual mudah tertukar dengan Latin. */
export const CONFUSABLE_WITH_LATIN: ReadonlySet<string> = new Set([
  'Cyrillic',
  'Greek',
  'Coptic',
  'Armenian',
  'Cherokee',
  'Glagolitic',
  'Gothic',
  'Deseret',
  'Osmanya',
  'Adlam',
  'Warang_Citi',
  'Medefaidrin',
  'Vithkuqi',
  'Old_Hungarian',
  'Tifinagh',
  'Nko',
  'Vai',
  'Bamum',
  'Lisu',
  'Miao',
  'Hanifi_Rohingya',
  'Soyombo',
  'Zanabazar_Square',
  'Elymaic',
  'Chorasmian',
  'Kawi',
]);

/** Aksara yang sedang diperiksa. Urutannya tetap agar hasil deterministik. */
const PROBED_SCRIPTS: readonly string[] = [
  'Latin',
  'Cyrillic',
  'Greek',
  'Coptic',
  'Armenian',
  'Hebrew',
  'Arabic',
  'Syriac',
  'Thaana',
  'Devanagari',
  'Bengali',
  'Gurmukhi',
  'Gujarati',
  'Oriya',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Sinhala',
  'Thai',
  'Lao',
  'Tibetan',
  'Myanmar',
  'Georgian',
  'Hangul',
  'Han',
  'Hiragana',
  'Katakana',
  'Bopomofo',
  'Cherokee',
  'Glagolitic',
  'Gothic',
  'Deseret',
  'Osmanya',
  'Adlam',
  'Tifinagh',
  'Nko',
  'Vai',
  'Bamum',
  'Ethiopic',
  'Khmer',
  'Mongolian',
  'Yi',
  'Javanese',
  'Balinese',
  'Sundanese',
  'Batak',
  'Buginese',
  'Runic',
];

interface ScriptProbe {
  readonly name: string;
  readonly pattern: RegExp;
}

let probes: readonly ScriptProbe[] | null = null;

function getProbes(): readonly ScriptProbe[] {
  if (probes !== null) return probes;
  probes = PROBED_SCRIPTS.map((name) => ({
    name,
    pattern: new RegExp(`\\p{Script_Extensions=${name}}`, 'u'),
  }));
  return probes;
}

/** `true` bila teks hanya berisi ASCII huruf/angka — jalur cepat untuk kasus umum. */
export function isAsciiAlphanumeric(text: string): boolean {
  return /^[a-z0-9]+$/.test(text);
}

/**
 * Himpunan aksara yang mungkin dimiliki sebuah karakter.
 * Karakter Common/Inherited (spasi, tanda hubung, digit ASCII) mengembalikan
 * himpunan kosong dan diabaikan oleh pemanggil.
 */
export function scriptExtensionsOf(char: string): string[] {
  const found: string[] = [];
  for (const probe of getProbes()) {
    if (probe.pattern.test(char)) found.push(probe.name);
  }
  return found;
}

export interface ScriptAnalysis {
  /** Semua aksara yang muncul di teks, tanpa Common/Inherited. */
  readonly scripts: readonly string[];
  /** `true` bila seluruh karakter berbagi satu aksara yang sama. */
  readonly singleScript: boolean;
  /**
   * `true` bila teks bercampur aksara yang tidak wajar dalam satu label:
   * Latin bersama aksara yang mudah tertukar dengannya, atau kombinasi di luar
   * daftar putih. Sintesis aksara yang sah (Jepang, Korea) tidak dianggap campuran.
   */
  readonly suspiciousMix: boolean;
  /** `true` bila campurannya hanya Latin + aksara non-confusable (mis. nama Indonesia beraksara Arab). */
  readonly benignMix: boolean;
}

/**
 * Kombinasi aksara yang sah muncul bersamaan. Bahasa Jepang dan Korea memang
 * mencampur aksara, jadi menuduh setiap teks multi-aksara akan salah.
 */
const LEGITIMATE_SCRIPT_COMBINATIONS: readonly (readonly string[])[] = [
  ['Han', 'Hiragana'],
  ['Han', 'Katakana'],
  ['Hiragana', 'Katakana'],
  ['Han', 'Hiragana', 'Katakana'],
  ['Han', 'Bopomofo'],
  ['Han', 'Hangul'],
  ['Hiragana', 'Katakana', 'Han', 'Hangul'],
];

function isLegitimateCombination(scripts: ReadonlySet<string>): boolean {
  // Setiap kombinasi yang muncul harus merupakan himpunan bagian dari salah satu
  // kombinasi sah yang dikenal.
  for (const legit of LEGITIMATE_SCRIPT_COMBINATIONS) {
    const legitSet = new Set(legit);
    let allInside = true;
    for (const script of scripts) {
      if (!legitSet.has(script)) {
        allInside = false;
        break;
      }
    }
    if (allInside) return true;
  }
  return false;
}

/** Analisis aksara untuk satu label atau satu token. */
export function analyzeScripts(text: string): ScriptAnalysis {
  const scripts = new Set<string>();

  // Jalur cepat: ASCII murni tidak perlu diperiksa.
  if (isAsciiAlphanumeric(text)) {
    return {
      scripts: ['Latin'],
      singleScript: true,
      suspiciousMix: false,
      benignMix: false,
    };
  }

  for (const char of text) {
    if (!/[\p{L}\p{N}]/u.test(char)) continue;
    const charScripts = scriptExtensionsOf(char);
    for (const script of charScripts) scripts.add(script);
  }

  if (scripts.size === 0) {
    return { scripts: [], singleScript: true, suspiciousMix: false, benignMix: false };
  }

  const singleScript = scripts.size === 1;

  if (singleScript || isLegitimateCombination(scripts)) {
    return {
      scripts: [...scripts],
      singleScript,
      suspiciousMix: false,
      benignMix: false,
    };
  }

  const hasLatin = scripts.has('Latin');
  let confusablePair = false;
  if (hasLatin) {
    for (const script of scripts) {
      if (script !== 'Latin' && CONFUSABLE_WITH_LATIN.has(script)) {
        confusablePair = true;
        break;
      }
    }
  }

  // Latin bersama aksara yang mudah tertukar adalah sinyal kuat. Latin bersama
  // aksara lain (mis. nama Indonesia beraksara Arab) tetap perlu dilaporkan, tetapi
  // diperlakukan lebih lemah karena bisa sah.
  return {
    scripts: [...scripts],
    singleScript: false,
    suspiciousMix: confusablePair,
    benignMix: hasLatin && !confusablePair,
  };
}
