# Lisensi pihak ketiga

Repositori ini berlisensi MIT (lihat `LICENSE`). Dua berkas data pihak ketiga
dibundel di dalamnya, dan keduanya mempertahankan lisensinya masing-masing.

## Public Suffix List

| | |
|---|---|
| Berkas mentah | `tools/gen-psl/public_suffix_list.dat` |
| Hasil generate | `packages/core/src/data/psl.generated.ts` |
| Sumber | <https://publicsuffix.org/list/public_suffix_list.dat> |
| Lisensi | Mozilla Public License 2.0 (MPL-2.0) |
| Versi dibundel | tercatat di `PSL_VERSION` pada berkas hasil generate |

Dipakai untuk memisahkan hostname menjadi suffix publik, domain registrable, dan
subdomain. Berkas mentahnya **tidak diubah** dan header lisensinya dipertahankan
utuh, sesuai ketentuan MPL-2.0 untuk berkas yang tidak dimodifikasi.

Perhatikan bahwa PSL sendiri menyatakan dirinya **bukan** mekanisme keamanan. ICANN/SSAC
mengeluarkan nasihat serupa ([SAC070](https://itp.cdn.icann.org/en/files/planning/resolution-implementation-recommendations-ssac-advice-documents-08jun17-en.pdf)).
Repositori ini memperlakukannya sebagai sumber data untuk memisahkan label domain, dan
menandai `pslMatch: false` ketika tidak ada aturan yang cocok, bukan menganggap hasilnya
selalu benar.

## Unicode confusables.txt

| | |
|---|---|
| Berkas mentah | `tools/gen-unicode/confusables.txt` |
| Hasil generate | `packages/core/src/data/confusables.generated.ts` |
| Sumber | <https://www.unicode.org/Public/security/latest/confusables.txt> |
| Lisensi | Unicode License v3 |
| Versi dibundel | tercatat di `CONFUSABLES_VERSION` pada berkas hasil generate |

Dipakai untuk membangun skeleton confusable menurut Unicode TR39, yaitu dasar deteksi
homoglyph. Generator hanya menyimpan 1.786 entri bersumber non-ASCII yang targetnya
murni ASCII; sisanya ditangani NFKC.

## Ketergantungan pengembangan

Seluruh dependensi hanya untuk pengembangan dan pengujian, dan tidak ada satu pun yang
dibundel ke dalam hasil akhir:

| Paket | Lisensi | Dipakai untuk |
|---|---|---|
| TypeScript | Apache-2.0 | Typecheck |
| Vitest | MIT | Test |
| @types/node | MIT | Tipe untuk alat bantu Node |

Extension yang dibangun dari repositori ini tidak memuat kode pihak ketiga saat
berjalan, dan tidak melakukan network request.
