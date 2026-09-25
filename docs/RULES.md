# Referensi kode rule

Setiap verdikt berisi daftar `Evidence`, dan setiap bukti membawa sebuah `code`. Dokumen ini
menjelaskan arti setiap kode: apa yang sebenarnya ditemukan, dan apa yang **tidak** boleh
disimpulkan darinya.

Kolom **polaritas** dan **strength** pada tabel di bawah adalah data turunan, bukan tulisan tangan.
Untuk melihat contoh fixture yang memicu setiap kode:

```bash
pnpm rules
```

Keluaran perintah itu juga memuat id fixture, sehingga setiap kode dapat ditelusuri ke kasus
nyatanya. Test `tools/corpus/tests/rule-coverage.test.ts` memastikan tidak ada kode yang mati dan
tidak ada kode yang tidak terpicu fixture mana pun.

## Cara membaca tabel

### Polaritas

| Nilai | Arti |
|---|---|
| `inconsistency` | Bukti bahwa nama dan alamat **tidak** sejalan |
| `consistency` | Bukti bahwa nama dan alamat sejalan |
| `context` | Menjelaskan situasi. **Tidak pernah** memengaruhi state |
| `neutral` | Tidak condong ke mana pun |

### Strength

| Nilai | Arti |
|---|---|
| `strong` | Cukup untuk menentukan state sendirian |
| `medium` | Bermakna, tetapi tidak boleh sendirian menyimpulkan ketidakcocokan |
| `weak` | Mudah salah. Paling jauh menghasilkan `UNCLEAR` |

### Yang tidak boleh disimpulkan

- Satu `inconsistency` berstrength `strong` **tidak** berarti emailnya berbahaya. Ia berarti nama
  yang ditampilkan dan alamat yang mengirim tidak sejalan.
- Tidak adanya bukti `inconsistency` **bukan** bukti bahwa pengirimnya asli.
- `AUTH_*` yang lulus **tidak** membuktikan organisasi yang diklaim display name adalah asli. Ia
  membuktikan domain tersebut menandatangani pesannya sendiri.

---

## Rule Tier A

Hanya butuh metadata dari DOM inbox.

| Kode | Polaritas | Strength | Arti |
|---|---|---|---|
| `DISPLAY_NAME_EMBEDS_OTHER_ADDRESS` | inconsistency | strong | Display name memuat alamat email **yang berbeda** dari alamat pengirim. Pola spoof-rendering klasik: yang terbaca pengguna adalah alamat lain |
| `DISPLAY_NAME_CLAIMS_DIFFERENT_DOMAIN` | inconsistency | strong | Display name memuat teks berformat domain (divalidasi lewat PSL) yang bukan domain pengirim. Klaim domain yang tidak dimiliki pengirim |
| `DISPLAY_NAME_EXACTLY_MATCHES_ADDRESS` | consistency | strong | Display name memuat alamat pengirim itu sendiri. Sepenuhnya lazim dan bukan anomali |
| `DISPLAY_NAME_MATCHES_LOCALPART_EXACT` | consistency | strong\* | Nama tercermin pada local-part alamat. Turun menjadi `medium` bila display name mengklaim organisasi, karena untuk organisasi identitas harus hidup di domain, bukan di local-part yang bebas dibentuk pengirim |
| `DISPLAY_NAME_TOKEN_MATCHES_REGISTRABLE_LABEL` | consistency | strong / medium | Token nama cocok dengan bagian identitas domain yang dimiliki pengirim. `strong` bila cocok dengan seluruh label, `medium` bila hanya dengan salah satu komponennya |
| `DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY` | inconsistency | strong / medium | Token nama muncul di subdomain tetapi **tidak** di domain registrable. `strong` bila label subdomainnya persis sama; `medium` bila hanya awalan atau akhiran, karena pola itu juga lazim pada pengirim yang dihosting di bawah domain penyedia |
| `DISPLAY_NAME_TOKEN_AS_LABEL_COMPONENT` | inconsistency | strong | Token nama dipakai sebagai kata tersendiri di dalam label domain, bersama kata lain yang tidak dijelaskan display name. Pola "brand + kata tambahan" pada domain yang bukan milik brand tersebut |
| `LOOKALIKE_NEAR_MISS` | inconsistency | strong / medium | Domain hampir sama dengan nama yang diklaim, tetapi tidak persis. `strong` bila panjangnya berubah (`bcaa`), atau bila perbedaannya adalah substitusi digit (`br1`); `medium` bila substitusi huruf pada panjang yang sama (`bnl`) |
| `ORGANIZATION_CLAIM_UNCORROBORATED_BY_DOMAIN` | inconsistency | medium | Display name mengklaim organisasi, tetapi domain pengirim tidak memuat identitas tersebut |
| `FREEMAIL_WITH_ORGANIZATION_DISPLAYNAME` | inconsistency | strong | Display name mengklaim organisasi, tetapi alamatnya di layanan surel gratis atau sekali pakai. Tidak ada alasan sah untuk itu |
| `CONFUSABLE_MATCH_TO_TOKEN` | inconsistency | strong | Token nama dan label domain sama setelah skeleton Unicode TR39, tetapi berbeda sebelumnya. Ini definisi serangan homoglyph: aksara berbeda, bentuk sama |
| `MIXED_SCRIPT_WITHIN_LABEL` | inconsistency | strong / medium | Satu label domain mencampur aksara. `strong` bila campurannya Latin dengan aksara yang mudah tertukar (Cyrillic, Greek); `medium` bila dengan aksara lain. Sintesis aksara yang sah seperti Jepang dan Korea tidak termasuk |
| `DIGIT_SUBSTITUTION_MATCH` | inconsistency | strong / weak | Token nama dan bagian alamat sama setelah substitusi digit atau huruf (`paypa1` → `paypal`, `rn` → `m`). `strong` bila mengenai label registrable dengan panjang memadai; selain itu `weak` |
| `TOKEN_EMBEDDED_IN_REGISTRABLE_LABEL` | inconsistency | weak | Token nama hanya tertanam sebagai substring di dalam label domain, mis. `signals` di `37signals`. Sinyal lemah: penamaan brand yang wajar juga terlihat seperti ini |
| `PUNYCODE_DOMAIN` | context | weak | Domain memuat label berpunycode. **Bukan** bukti kejahatan: IDN sah banyak. Ia ada untuk menjelaskan mengapa label domain tampak berbeda dari tampilannya |
| `DISPOSABLE_DOMAIN` | context | weak | Domain termasuk layanan surel sekali pakai. Memakai alamat sekali pakai bukan bukti penipuan identitas |
| `GENERIC_TOKEN_ONLY_DISPLAYNAME` | context | weak | Display name hanya berisi peran layanan tanpa identitas (`Admin`, `Support`, `no-reply`). Ini yang membuat engine menolak menilai |
| `HUMAN_NAME_PATTERN` | context | weak | Display name mengikuti pola nama orang. Akronim huruf besar semua sengaja tidak termasuk |
| `RANDOM_LOCAL_PART` | context | weak | Local-part tampak acak. Sangat sering dimiliki pengirim sah seperti sistem tiket dan CRM |
| `NO_DISPLAY_NAME` | context | weak | Webmail tidak menampilkan nama sama sekali. Tidak ada yang dapat dibandingkan |
| `MAILING_LIST_DOMAIN` | context | weak | Alamat milis atau grup. Nama yang tampil adalah nama penulis, sedangkan alamatnya adalah alamat grup — hubungannya terputus secara desain |
| `GMAIL_VIA_ESP_HINT` | context | weak | Webmail menandai pengiriman melalui infrastruktur pihak ketiga. Menekan mismatch Return-Path yang sah |
| `GMAIL_OWN_WARNING_PRESENT` | context | weak | Webmail sendiri menampilkan peringatan pada pesan itu. Dipakai sebagai konteks, bukan sebagai dasar |

\* Lihat catatan pada bagian [Rule yang perlu penjelasan tambahan](#rule-yang-perlu-penjelasan-tambahan).

## Rule Tier B

Hanya berjalan bila `provenance` bernilai `'dom-original'`, yaitu ketika header dari halaman
"Show original" tersedia. Ketiadaan data Tier B **tidak pernah** diperlakukan sebagai
ketidakcocokan.

| Kode | Polaritas | Strength | Arti |
|---|---|---|---|
| `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT` | inconsistency | strong | Token nama muncul di domain tujuan balasan, tetapi **tidak** di domain pengirim. Artinya identitas yang terlihat pengguna ditegakkan oleh domain yang tidak mengirim pesan itu. Ini kanal terkuat di Tier B |
| `REPLY_TO_DOMAIN_MISMATCH` | inconsistency | medium | Domain tujuan balasan berbeda dari domain pengirim. Sendirian tidak cukup: pemindahan balasan ke penyedia pihak ketiga adalah pola yang lazim |
| `REPLY_TO_FREEMAIL_WHILE_FROM_CORPORATE` | inconsistency | strong | Pengirim mengaku dari domain korporat, tetapi balasan diarahkan ke surel gratis |
| `RETURN_PATH_NULL_OR_MISMATCH` | context | weak | Return-Path tidak ada atau berbeda dari domain pengirim. Tidak diberi bobot karena ini juga bentuk normal pengiriman lewat ESP |
| `AUTH_DMARC_FAIL` | inconsistency | medium | DMARC gagal untuk domain pengirim. Berstrength menengah karena ia mengautentikasi **domain**, bukan display name. Sendirian ia menghasilkan `UNCLEAR`, bukan `INCONSISTENT` |
| `AUTH_SPF_FAIL` | context | weak | SPF gagal. Konteks, bukan dasar |
| `AUTH_DKIM_FAIL` | context | weak | DKIM gagal. Konteks, bukan dasar |
| `AUTH_ALIGNED_PASS` | consistency | medium | DMARC lulus dan selaras dengan domain yang diklaim. Membuktikan domain menandatangani pesannya sendiri, **bukan** bahwa display name-nya benar |

---

## Rule yang perlu penjelasan tambahan

### `REPLY_TO_MATCHES_NAME_BUT_FROM_DOES_NOT`

Ini satu-satunya rule yang lahir langsung dari laporan pengguna, dan ia menutup kelas serangan yang
tidak dapat dilihat oleh cara lain mana pun.

```
dari:                Rise <no-reply@mngl.in>
balas ke:            support@riseworks.digital
dikirim oleh:        mngl.in
ditandatangani oleh: mngl.in
```

Domain pengirim tidak memuat "rise" sama sekali, sedangkan domain tujuan balasan memuatnya.
Seluruh rantai autentikasi lulus untuk `mngl.in`, dan itu memang benar. Karena itu tidak ada satu pun
hasil autentikasi yang bertentangan, dan webmail tidak punya alasan menampilkan peringatan.

Dua keputusan pada rule ini disengaja:

- **Dikecualikan bila domain From adalah kelas `esp`.** Sebagian penyedia mengirim dengan domainnya
  sendiri sebagai From atas nama klien, dan itu konfigurasi yang sah.
- **Tidak ditekan oleh indikator "via".** "Via" menjelaskan mengapa Return-Path berbeda dari From,
  tetapi tidak menjelaskan mengapa identitas yang diklaim justru muncul di domain tujuan balasan.
  Menekannya karena "via" akan membuka kembali kasus yang paling perlu ditangkap.

Hanya kanal kecocokan biasa yang dihitung (persis, awalan, akhiran, atau komponen berpenyekat).
Kanal homoglyph dan near-miss dikecualikan karena keduanya sudah punya rule sendiri.

### `LOOKALIKE_NEAR_MISS`

Strength-nya bergantung pada **jenis** perbedaannya, dan pembedaan ini berasal dari pengukuran,
bukan dari teori:

| Perbedaan | Strength | Contoh |
|---|---|---|
| Panjang berubah | strong | `bcaa` vs `bca`, `tokopedi` vs `tokopedia` |
| Substitusi digit | strong | `br1` vs `bri`, `paypa1` vs `paypal` |
| Substitusi huruf, panjang sama | medium | `bnl` vs `bni`, `gojeg` vs `gojek` |

Alasannya: penyerang cenderung **menambah atau menghapus** huruf pada brand, sedangkan varian ejaan
nama orang Indonesia justru **menukar** huruf (Rizky/Rizki, Yusuf/Yusup, Andi/Andy). Menyamakan
keduanya akan menghukum pemilik domain pribadi yang sah.

### `DISPLAY_NAME_TOKEN_IN_SUBDOMAIN_ONLY`

Pembedaan strength-nya memisahkan dua pola yang tampak identik:

| Domain | Token | Strength | Kenapa |
|---|---|---|---|
| `paypal.com.secure-login.xyz` | `paypal` | strong | Domain palsu ditanam sebagai label utuh di subdomain |
| `tokonusantara.com.host.co.id` | `toko` | medium | Pengirim dihosting di bawah domain penyedia; tokennya hanya awalan di dalam satu label |

### `AUTH_DMARC_FAIL`

Berstrength `medium`, bukan `strong`. DMARC mengautentikasi **domain**, bukan display name. Pada
strength menengah, kegagalan DMARC sendirian menghasilkan `UNCLEAR`/MEDIUM — yang memang seharusnya.
Ia baru ikut mendorong `INCONSISTENT` bila sudah ada inkonsistensi nama↔alamat dari Tier A.

### Rule berpolarity `context`

`PUNYCODE_DOMAIN`, `DISPOSABLE_DOMAIN`, `RANDOM_LOCAL_PART`, `GMAIL_OWN_WARNING_PRESENT`, dan
`RETURN_PATH_NULL_OR_MISMATCH` sengaja **tidak pernah** menggerakkan state. Masing-masing dapat
menjelaskan situasi, tetapi tidak satu pun cukup untuk menyimpulkan apa pun sendirian. Menjadikannya
bukti akan mengubah hampir seluruh inbox menjadi bersinyal.

---

## Menambah atau mengubah rule

Ringkasnya, dan selengkapnya di [`CONTRIBUTING.md`](../CONTRIBUTING.md):

1. Tambahkan kode ke `ALL_RULE_CODES` di `packages/core/src/types.ts`.
2. Pancarkan dari `packages/core/src/evidence/rules.ts`.
3. Tambahkan fixture yang memicunya, **dan** satu kasus sah yang hampir mirip di
   `tools/corpus/fixtures/adversarial.json`.
4. Perbarui tabel di dokumen ini. Kolom turunannya dari `pnpm rules`; kolom arti ditulis manusia.
5. Naikkan `ALGORITHM_VERSION` dan catat di `CHANGELOG.md`.

Test kelengkapan katalog akan gagal bila sebuah kode tidak dapat dipicu fixture mana pun. Itu
disengaja: rule yang tidak punya kasus nyata adalah rule yang belum dipahami.
