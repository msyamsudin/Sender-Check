# Changelog

Format [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi
[Semantic Versioning](https://semver.org/lang/id/).

Berkas ini **indeks**: satu baris per versi. Barisnya ditambahkan otomatis oleh
`tools/release/src/prepare.ts` saat CI merilis, sehingga berkas ini tidak pernah disunting
tangan. Catatan rilis penuhnya ada di **pesan tag** dan GitHub Releases, jadi hanya dibaca saat
ditanya. Riwayat terperinci 0.1.0–0.3.0 — versi yang dirilis sebelum tag dan rilis otomatis
dipakai — ada di `docs/CHANGELOG-0.x.md`.

Dua nomor versi: **versi paket** (`package.json`) mengikuti riwayat repositori, sedangkan
**`ALGORITHM_VERSION`** (`packages/core/src/version.ts`) menyatakan versi keputusan analisis dan
ikut menjadi cache key ekstensi. Keduanya wajib dinaikkan setiap kali rule, ambang, atau decision
table berubah.

## Indeks

| Versi | Tanggal | `ALGORITHM_VERSION` | Ringkasan | Catatan rilis |
|---|---|---|---|---|
| 0.6.1 | 2026-10-07 | 0.2.3 (tidak berubah) | Samakan klaim dengan kenyataan, dan jaga agar tidak bisa menyimpang lagi | pesan tag `v0.6.1` |
| 0.6.0 | 2026-10-06 | 0.2.3 | Indikator tampilan daftar, popup, footer versi PSL, dan catatan adapter | pesan tag `v0.6.0` |
| 0.5.1 | 2026-10-04 | 0.2.2 (tidak berubah) | Kunci selector adapter pada snapshot DOM Gmail sungguhan | pesan tag `v0.5.1` |
| 0.5.0 | 2026-10-04 | 0.2.2 | Mode diagnostik yang menampilkan nilai mentah engine | pesan tag `v0.5.0` |
| 0.4.2 | 2026-10-04 | 0.2.1 (tidak berubah) | Tunjuk commit bila judul tidak memuat nomor pull request | pesan tag `v0.4.2` |
| 0.4.1 | 2026-10-04 | 0.2.1 (tidak berubah) | Perbaiki pembacaan tag pada rilis otomatis, dan batalkan rilis 0.5.0; Catatan rilis tanpa tag rujukan, penjaga tag, dan… | pesan tag `v0.4.1` |
| 0.4.0 | 2026-10-04 | 0.2.1 | Panel hanya menilai pengirim dalam percakapan, dan rilis berjalan otomatis; Cabut klaim siap tempel pada pnpm rules dan… | pesan tag `v0.4.0` |
| 0.3.0 | 2026-09-24 | 0.2.0 (tidak berubah) | Adapter Gmail Tier A/B, skrip konsol Firefox, decoder RFC 2047 | `docs/CHANGELOG-0.x.md` |
| 0.2.0 | 2026-09-24 | tidak dicatat | Gate G7 + rule Tier B pertama; ambang dan normalisasi diperbaiki | `docs/CHANGELOG-0.x.md` |
| 0.1.0 | 2026-09-24 | tidak dicatat | Engine analisis, corpus harness, generator data | `docs/CHANGELOG-0.x.md` |

Kolom `ALGORITHM_VERSION` untuk 0.1.0 dan 0.2.0 sengaja dibiarkan "tidak dicatat", bukan diisi
tebakan: ketiga versi itu dirilis sebelum tag dipakai, `git log` hanya memuat satu nilai yang
pernah di-commit (`0.2.0`, sejak commit pertama), dan catatan rilis lamanya tidak menyebut angkanya.
Baris untuk versi berikutnya diisi dari pesan tag, dan **diperiksa CI**, sehingga tidak dapat lagi
hilang.
