# Snapshot DOM Gmail

Direktori ini memuat **tiga dari empat** berkas yang dibutuhkan untuk membangun adapter Gmail
(Phase 7): `list-row.html`, `thread-open.html`, dan `show-original.html`. Satu slot sengaja
dibiarkan kosong karena isinya belum pernah ditemukan di akun pemelihara. Seluruh berkas di sini
hanya dapat diambil dari sesi Gmail yang sudah login.

Direktori ini dulu memang kosong, dan kalimat "kosong dengan sengaja" yang berdiri di sini sejak
saat itu sempat tertinggal dari isinya sendiri. Berkas ini adalah tempat orang pertama kali mencari
cara menambah snapshot, sehingga kalimat itu menyuruhnya berhenti sebelum mulai.

## Kenapa ini diperlukan

Adapter harus dipisahkan dari engine supaya algoritma dapat diuji tanpa browser — itulah
sebabnya corpus berjalan di Node dan tuning presisi menjadi iterasi hitungan detik.
Konsekuensinya, adapter tidak dapat dibangun dari ingatan atau dugaan: ia harus
diverifikasi terhadap DOM yang sebenarnya.

Selector Gmail berbasis nama kelas yang berubah secara berkala. Snapshot di direktori ini
menjadi **regression fixture**: `packages/adapters/tests/gmail-snapshots.test.ts` mengurainya
lewat `linkedom`, sehingga selector terbukti cocok dengan markup sungguhan, dan perubahan
adapter yang mematahkan pembacaan itu gagal di CI.

Batasnya perlu disebut supaya tidak diandalkan secara keliru: snapshot yang tersimpan
**tidak berubah** ketika Gmail berubah, jadi test ini tidak akan gagal karena Gmail. Yang
memberi tahu bahwa Gmail sudah berubah adalah `sender-check.probe.js` yang dijalankan di
halaman sungguhan — dan snapshot baru diambil ketika itu terjadi.

## Yang dibutuhkan

Empat berkas. Untuk masing-masing, simpan `outerHTML` elemennya saja, bukan seluruh
halaman.

| Berkas | Yang diambil | Untuk apa |
|---|---|---|
| `list-row.html` | Satu baris dari list view inbox | Selector display name dan alamat di daftar |
| `thread-open.html` | Elemen pengirim pada thread yang dibuka | Tempat panel penjelasan akan dipasang |
| `thread-no-name.html` | Satu thread **tanpa** display name | Memastikan tidak ada yang crash saat nama tidak ada |
| `show-original.html` | Halaman "Show original" | Verifikasi selector Tier B |

**Satu berkas belum dapat diambil, dan alasannya dicatat di sini.** `thread-no-name.html` kosong
karena Gmail tidak merender pengirim tanpa nama pada akun pemelihara: di inbox maupun Spam, tidak
ada satu pun `span[email]` yang kehilangan atribut `name`, dan tidak ada yang atribut `name`-nya
berisi alamatnya sendiri. Slotnya sengaja dibiarkan — siapa pun yang menemukan pesan seperti itu
dapat mengisinya, dan assertion-nya menyala sendiri tanpa perubahan kode.

Perilaku yang dijaganya sudah tercakup pada tingkat logika oleh tiga test di
`packages/adapters/tests/gmail.test.ts`: *membaca nama dari teks bila atribut name tidak ada, dan
mencatatnya*, *memperlakukan teks yang sama dengan alamat sebagai tanpa nama*, dan *tetap memilih
baris pengirim ketika pengirim tidak menampilkan nama*. Yang belum terbukti hanyalah bentuk
markupnya. Bila berkas ini suatu saat diisi, bentuk yang benar adalah **teks elemennya sama dengan
alamatnya**, bukan sekadar atribut `name` yang dihapus: tanpa mengubah teks, adapter akan membaca
teks itu sebagai nama, dan berkasnya tidak akan menguji keadaan yang dimaksud.

Satu pertanyaan sengaja dibiarkan terbuka, tanpa dijawab dengan tebakan: apakah Gmail pernah
mengisi atribut `name` dengan alamatnya sendiri. Bila ya, `readDisplayName` akan melaporkan alamat
itu sebagai display name, karena perbandingan terhadap alamat hanya ada di jalur cadangan teks —
bukan di jalur atribut. Tidak ada bukti ke arah mana pun dari akun ini, jadi kodenya tidak diubah.

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
- regression test di `packages/adapters/tests/gmail-snapshots.test.ts`, yang gagal ketika
  adapter berhenti cocok dengan markup yang terekam;
- fixture untuk memverifikasi pemetaan kolom Show original ke `EmailIdentity`.

Kontrak pemetaan itu, termasuk satu jebakan yang mudah terlewat, ada di
[`docs/DESIGN.md`](../../docs/DESIGN.md) bagian 12.1: kolom **"dikirim oleh"** pada Show
original adalah domain Return-Path, **bukan** `gmailViaHint`. Menyamakan keduanya akan
mengisi `gmailViaHint` pada hampir semua email dan menekan sinyal Tier B secara
diam-diam.
