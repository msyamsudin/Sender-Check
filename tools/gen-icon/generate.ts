/**
 * Generator ikon ekstensi.
 *
 * ## Kenapa generator, bukan berkas gambar yang ditempel
 *
 * Ikon adalah berkas biner, dan berkas biner tidak dapat ditinjau lewat diff: perubahan satu
 * piksel terlihat sama dengan perubahan seluruh bentuk. Karena itu bentuknya ditulis sebagai
 * kode di sini — sehingga dapat dibaca, diubah, dan dibangun ulang — sementara berkas PNG-nya
 * adalah hasil yang dapat direproduksi kapan saja.
 *
 * ## Kenapa encoder PNG ditulis sendiri
 *
 * Repositori ini tidak menambah dependensi runtime untuk hal yang dapat dikerjakan bahasa dan
 * API standar (lihat CONTRIBUTING), dan ini juga bukan dependensi runtime: berkas ini hanya
 * berjalan bila ikonnya dibangun ulang. Yang dibutuhkan hanya `zlib` bawaan Node dan
 * spesifikasi PNG, dan bagian yang dipakai sempit: RGBA 8-bit, tanpa interlace, filter nol.
 *
 * ## Bentuknya, dan kenapa bukan centang
 *
 * Dua bidang yang dipisahkan satu celah diagonal: gagasan "dua hal yang seharusnya sejalan",
 * yaitu nama yang ditampilkan dan alamat yang sebenarnya. Ikon centang sengaja **tidak**
 * dipakai karena ia menyiratkan "sudah aman" — dan justru kesimpulan itulah yang alat ini
 * menolak berikan (`docs/DESIGN.md` bagian 15.4). Nama dan logo webmail juga tidak dipakai,
 * sesuai batas yang sama.
 *
 * Warna kedua bidang berbeda supaya "dua hal" itu terbaca, bukan "satu bentuk yang dipotong".
 *
 * ```bash
 * node tools/gen-icon/generate.ts
 * ```
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'apps', 'extension', 'public', 'icon');

/**
 * Ukuran yang ditulis, beserta tempat Firefox dan AMO memakainya.
 *
 * 32 adalah ukuran yang direkomendasikan MDN sebagai ikon utama, dan 64 disarankan
 * bersamanya untuk layar berkerapatan tinggi. 16 dipakai tombol toolbar, 48 dipakai sebagian
 * tampilan add-on, dan 128 dipakai halaman listing AMO.
 */
const SIZES = [16, 32, 48, 64, 128] as const;

/** Bidang kiri: biru tua. */
const FIELD_LEFT = { r: 0x1e, g: 0x5a, b: 0xa8 };

/** Bidang kanan: biru muda dari keluarga yang sama, supaya keduanya terbaca sebagai pasangan. */
const FIELD_RIGHT = { r: 0x7f, g: 0xb2, b: 0xe5 };

/**
 * Sampel per sisi per piksel, untuk tepi yang tidak bergerigi.
 *
 * Tiga dipilih karena cukup untuk membuat tepi lingkaran mulus pada ukuran terbesar dan tidak
 * membebani apa pun: 9 sampel per piksel pada 128×128 berarti sekitar 147 ribu operasi.
 */
const SAMPLES = 3;

/** Jari-jari bidang, sebagai proporsi sisi. Sisanya menjadi margin yang sengaja disisakan. */
const RADIUS_RATIO = 0.44;

/** Lebar celah diagonal, sebagai proporsi sisi, dengan lantai satu setengah piksel. */
const GAP_RATIO = 0.105;
const GAP_MINIMUM = 1.5;

// ---------------------------------------------------------------------------
// Encoder PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBytes = Buffer.from(type, 'latin1');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);

  return Buffer.concat([length, typeBytes, data, checksum]);
}

/**
 * Membungkus piksel RGBA menjadi berkas PNG.
 *
 * Setiap baris diberi satu byte filter bernilai nol (`None`). Filter adaptif akan menghasilkan
 * berkas yang lebih kecil, tetapi ukuran bukan yang dikejar di sini — jumlah berkas, ukuran
 * yang terbaca mata, dan isi yang dapat diperiksa yang lebih penting.
 */
function encodePng(size: number, pixels: Buffer): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // kedalaman bit
  header[9] = 6; // jenis warna: RGBA
  header[10] = 0; // kompresi: deflate
  header[11] = 0; // filter: adaptif per baris (dipakai: hanya nol)
  header[12] = 0; // interlace: tidak

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Bentuk
// ---------------------------------------------------------------------------

/**
 * Menggambar dua bidang yang dipisahkan celah diagonal.
 *
 * Warna diambil dari sisi yang menempati **mayoritas** sampel, dan alfa dari jumlah sampel sisi
 * itu — bukan dari seluruh sampel yang masuk lingkaran. Perbedaannya bukan detail: dengan alfa
 * dari seluruh sampel, piksel di tengah celah akan terisi warna dan celahnya menutup pada
 * ukuran kecil, tepat ketika ia paling dibutuhkan untuk memisahkan dua bidang.
 */
function drawIcon(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const radius = size * RADIUS_RATIO;
  const halfGap = Math.max(GAP_MINIMUM, size * GAP_RATIO) / 2;
  const samples = SAMPLES * SAMPLES;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let left = 0;
      let right = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const dx = x + (sx + 0.5) / SAMPLES - center;
          const dy = y + (sy + 0.5) / SAMPLES - center;

          if (Math.hypot(dx, dy) > radius) continue;
          if (Math.abs(dx - dy) / Math.SQRT2 < halfGap) continue;

          if (dx + dy >= 0) left++;
          else right++;
        }
      }

      const covered = Math.max(left, right);
      if (covered === 0) continue;

      const field = left >= right ? FIELD_LEFT : FIELD_RIGHT;
      const offset = (y * size + x) * 4;

      pixels[offset] = field.r;
      pixels[offset + 1] = field.g;
      pixels[offset + 2] = field.b;
      pixels[offset + 3] = Math.round((covered / samples) * 255);
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const png = encodePng(size, drawIcon(size));
  const path = join(OUT_DIR, `${size}.png`);
  writeFileSync(path, png);
  console.log(`  ${`${size}.png`.padEnd(9)} ${String(png.length).padStart(6)} byte`);
}

console.log(`ikon ditulis ke apps/extension/public/icon/ (${SIZES.length} ukuran)`);
