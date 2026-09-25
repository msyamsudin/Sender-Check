# Snapshot DOM Gmail

Direktori ini kosong dengan sengaja. Isinya dibutuhkan untuk membangun adapter Gmail
(Phase 7), dan hanya dapat diambil dari sesi Gmail yang sudah login.

## Kenapa ini diperlukan

Adapter harus dipisahkan dari engine supaya algoritma dapat diuji tanpa browser — itulah
sebabnya corpus berjalan di Node dan tuning presisi menjadi iterasi hitungan detik.
Konsekuensinya, adapter tidak dapat dibangun dari ingatan atau dugaan: ia harus
diverifikasi terhadap DOM yang sebenarnya.

Selector Gmail berbasis nama kelas yang berubah secara berkala. Snapshot di direktori ini
menjadi **canary test**: ketika Gmail mengubah strukturnya, test gagal di CI alih-alih
extension diam-diam berhenti bekerja.

## Yang dibutuhkan

Empat berkas. Untuk masing-masing, simpan `outerHTML` elemennya saja, bukan seluruh
halaman.

| Berkas | Yang diambil | Untuk apa |
|---|---|---|
| `list-row.html` | Satu baris dari list view inbox | Selector display name dan alamat di daftar |
| `thread-open.html` | Elemen pengirim pada thread yang dibuka | Tempat panel penjelasan akan dipasang |
| `thread-no-name.html` | Satu thread **tanpa** display name | Memastikan tidak ada yang crash saat nama tidak ada |
| `show-original.html` | Halaman "Show original" | Verifikasi selector Tier B |

Untuk yang terakhir, Gmail menyediakan halaman itu lewat menu **⋮ → Show original**
(atau **Tampilkan aslinya**). Alamatnya berbentuk
`mail.google.com/mail/u/N/?...&view=om&th=...`, dan halaman itu memuat header mentah di
dalam DOM-nya. Karena itu engine dapat membaca `Reply-To`, `Return-Path`, dan
`Authentication-Results` **tanpa network request tambahan**: pengguna yang membuka
halamannya, extension hanya membaca.

## Cara mengambilnya

1. Buka pesan yang dituju di Gmail.
2. Klik kanan pada elemen yang dimaksud → **Inspect**.
3. Di panel Elements, klik kanan pada baris elemen yang tersorot → **Copy** → **Copy
   outerHTML**.
4. Tempel ke berkas yang sesuai di direktori ini.

**Samarkan isi pesannya** sebelum disimpan. Yang dibutuhkan adalah struktur dan atribut
DOM, bukan isi kotak masukmu. Ganti nama, alamat, dan subjek dengan nilai rekaan, tetapi
**pertahankan bentuk strukturnya** — termasuk atribut `email` dan `name`, karena justru
keduanya yang dibaca adapter.

## Apa yang akan terjadi setelahnya

Empat berkas ini menjadi:

- dasar `probe(): { matched, selectorUsed, confidence }` pada adapter;
- canary test yang gagal ketika Gmail mengubah struktur DOM;
- fixture untuk memverifikasi pemetaan kolom Show original ke `EmailIdentity`.

Kontrak pemetaan itu, termasuk satu jebakan yang mudah terlewat, ada di
[`docs/DESIGN.md`](../../docs/DESIGN.md) bagian 12.1: kolom **"dikirim oleh"** pada Show
original adalah domain Return-Path, **bukan** `gmailViaHint`. Menyamakan keduanya akan
mengisi `gmailViaHint` pada hampir semua email dan menekan sinyal Tier B secara
diam-diam.
