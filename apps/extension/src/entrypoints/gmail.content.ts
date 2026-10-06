/**
 * Content script: panel penjelasan di halaman webmail.
 *
 * Yang ada di berkas ini hanya perekat: kapan memindai, kapan menggambar, kapan membuang.
 * Seluruh keputusan tentang apa yang ditampilkan ada di `lib/`, yang bebas DOM dan diuji di
 * Node. Perekatnya sendiri tidak diuji, dan itu disengaja — menguji perekat berarti menguji
 * browser, dan yang diuji bukan lagi logika milik proyek ini.
 *
 * ## Kapan ia bekerja
 *
 * Hanya pada dua keadaan: satu thread yang sedang dibuka, dan halaman "Show original".
 * List view sengaja dilewati — lihat `lib/view.ts`. Bila tidak ada yang dapat dibaca, panel
 * dibuang dan tidak ada yang ditampilkan; itu perilaku yang benar, bukan kegagalan.
 *
 * ## Kenapa MutationObserver, dan kenapa ditunda
 *
 * Webmail membangun ulang DOM-nya setiap kali pengguna membuka pesan. Pemindaian langsung
 * pada setiap mutasi akan berjalan puluhan kali per detik di halaman yang sibuk, dan
 * `docs/DESIGN.md` bagian 10 melarang memblokir main thread. Karena itu setiap mutasi hanya
 * **menjadwalkan** satu pemindaian, dan pemindaiannya sendiri dijalankan pada waktu idle.
 *
 * ## Yang tidak dilakukan berkas ini: mengambil header sendiri
 *
 * `Reply-To` hanya ada di halaman "Show original", dan halaman itu **tidak** diambil sendiri
 * oleh ekstensi. Keputusan itu diambil ulang secara sadar setelah sempat dicoba: janji
 * "tanpa permintaan jaringan" adalah alasan utama alat ini boleh menyentuh kotak masuk orang,
 * dan menukarnya dengan satu tombol tidak sebanding. Yang dilakukan panel adalah menyebutkan
 * bahwa pengirimnya belum dapat dipastikan dan menunjukkan halaman mana yang memuat dasarnya
 * — pengguna yang membukanya, dan panel menilai ulang di sana. Lihat `docs/DESIGN.md` D1.
 */
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { browser } from 'wxt/browser';
import { LIST_ROW_SELECTOR } from '@sender-check/adapters';
import { copyToClipboard } from '../lib/clipboard.ts';
import {
  OPEN_HEADER_REQUEST,
  SNAPSHOT_REQUEST,
  type OpenHeaderResult,
} from '../lib/messaging.ts';
import { analyzeList, analyzePage, diagnosticSourceFor } from '../lib/scan.ts';
import { buildPanelModel, type PanelModel } from '../lib/panel-model.ts';
import { renderPanel, type PanelActions } from '../lib/panel-view.ts';
import '../lib/panel.css';

/**
 * Jeda sebelum memindai ulang setelah DOM berubah.
 *
 * 400 ms cukup untuk melewati rentetan mutasi saat pesan dibuka, dan cukup pendek sehingga
 * panel terasa muncul bersamaan dengan pesannya.
 */
const DEBOUNCE_MS = 400;

/**
 * Pintasan mode diagnostik: `Alt+Shift+D`.
 *
 * Dipilih karena tiga hal: Gmail tidak memakainya (ia memakai `d` sendirian untuk menghapus),
 * ia tidak bentrok dengan pintasan penyunting teks mana pun yang saya ketahui, dan ia dapat
 * ditekan dengan satu tangan.
 *
 * Mode ini sengaja **tidak** disimpan ke storage dan tidak bertahan antar pemuatan halaman.
 * Ia menyajikan istilah internal dan bukti mentah; keadaan yang menempel berarti pengguna
 * dapat menemukannya aktif di kemudian hari tanpa pernah memintanya, dan lupa mengapa
 * panelnya berubah. Karena itu ia juga tidak punya jalan masuk dari daftar pengaturan: satu
 * kombinasi tombol, dan satu tombol kecil di panel — keduanya tindakan yang disengaja.
 */
const DIAGNOSTIC_SHORTCUT_KEY = 'd';

/**
 * Label tombol "lainnya" (⋮) pada sebuah pesan, dibaca dari `aria-label`.
 *
 * Dibandingkan memakai nama kelas Gmail (`Wsq5Cf` dan kawan-kawan): kelas itu diobfuskasi
 * dan berubah antar rilis, sedangkan `aria-label` bertahan jauh lebih lama karena ia yang
 * dipakai pembaca layar. Konsekuensinya i label memang tergantung bahasa, sehingga daftarnya
 * memuat bahasa yang dipakai dokumentasi (Indonesia dan Inggris) dan kegagalannya bukan
 * kehancuran: pengguna cukup membuka menu itu sendiri.
 */
const MORE_BUTTON_LABELS: readonly string[] = [
  'opsi pesan lainnya',
  'opsi lainnya',
  'more message options',
  'more options',
  'more actions',
  'lainnya',
];

/** Nama item menu "Show original" pada dua bahasa yang didokumentasikan. */
const SHOW_ORIGINAL_LABELS: readonly string[] = ['tampilkan aslinya', 'show original'];

/** Berapa lama menunggu menu Gmail selesai dirender setelah tombolnya diklik. */
const MENU_WAIT_MS = 2000;

/**
 * Kelas penanda di tampilan daftar.
 *
 * Penanda berada di **DOM halaman**, bukan di shadow root panel — karena yang ditandai
 * adalah baris milik Gmail. Konsekuensinya gayanya harus inline: CSS panel berada di dalam
 * shadow root dan tidak dapat menjangkau elemen halaman.
 */
const LIST_FLAG_CLASS = 'sc-flag';

/** Gaya penanda: titik kecil berwarna aksen `INCONSISTENT`, sama dengan warna panelnya. */
const LIST_FLAG_STYLE =
  'display:inline-block;width:7px;height:7px;border-radius:50%;background:#b54708;margin-left:4px;vertical-align:middle;';

/** Membuang semua penanda yang pernah dipasang. */
function clearListFlags(): void {
  for (const node of document.querySelectorAll(`.${LIST_FLAG_CLASS}`)) node.remove();
}

/**
 * Menyamakan penanda di daftar dengan keadaan yang seharusnya.
 *
 * Posisi ditentukan oleh indeks: `analyzeList` menghasilkan satu entri per baris dengan
 * urutan dokumen yang sama, sehingga entri ke-i menempel pada baris ke-i. Entri `null`
 * dilewati — itulah gunanya daftar itu tetap sepanjang jumlah baris.
 *
 * Penanda disisipkan sebagai saudara elemen pengirim, bukan ke dalamnya: teks di dalam
 * elemen pengirim dipakai adapter sebagai cadangan ketika atribut `name` tidak ada, dan
 * menambahkan teks ke sana akan merusak pembacaan pada pemindaian berikutnya.
 *
 * ## Kenapa idempoten, bukan "buang semua lalu pasang lagi"
 *
 * Versi pertamanya membuang seluruh penanda lebih dulu pada setiap pemindaian, dan itu
 * berarti dua mutasi `childList` setiap 400 ms tanpa henti — walaupun tidak ada apa pun
 * yang berubah di halaman — ditambah risiko lingkaran bila Gmail sendiri merender ulang
 * baris ketika DOM-nya disentuh. Dengan menyamakan, pemindaian pada keadaan diam tidak
 * menghasilkan mutasi apa pun, sehingga observer tidak pernah menjadwalkan apa pun dan
 * lingkaran itu tidak dapat terbentuk. Penanda yang penandanya sudah sesuai disimpan;
 * hanya yang berbeda atau yang tidak lagi layak yang disentuh.
 */
function renderListFlags(): void {
  const analysis = analyzeList(document);
  const rows = document.querySelectorAll(LIST_ROW_SELECTOR);
  const keep = new Set<Element>();

  if (analysis.matched) {
    analysis.flags.forEach((flag, index) => {
      if (flag === null) return;

      const row = rows[index];
      if (row === undefined) return;

      const existing = row.querySelector(`.${LIST_FLAG_CLASS}`);
      if (existing !== null && existing.getAttribute('title') === flag.reason) {
        keep.add(existing);
        return;
      }
      if (existing !== null) existing.remove();

      const anchor = row.querySelector(flag.sourceSelector);
      if (anchor === null) return;

      const marker = document.createElement('span');
      marker.className = LIST_FLAG_CLASS;
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', flag.reason);
      marker.setAttribute('title', flag.reason);
      marker.setAttribute('style', LIST_FLAG_STYLE);
      anchor.after(marker);
      keep.add(marker);
    });
  }

  // Sisa penanda — baris yang hilang, tidak lagi terbaca, atau tidak lagi layak — dibuang
  // di akhir, setelah seluruh baris disamakan.
  for (const marker of document.querySelectorAll(`.${LIST_FLAG_CLASS}`)) {
    if (!keep.has(marker)) marker.remove();
  }
}

/** `true` bila sebuah node adalah penanda milik kita. */
function isFlagNode(node: Node): boolean {
  return node instanceof Element && node.classList.contains(LIST_FLAG_CLASS);
}

/**
 * `true` bila seluruh perubahan dalam batch ini berasal dari penanda yang kita pasang sendiri.
 *
 * Tanpa penyaringan ini, pemasangan penanda memicu `MutationObserver` → jadwal pemindaian →
 * pemasangan lagi, dan daftar akan dipindai tanpa henti setiap 400 ms. Penyaringannya sengaja
 * ketat: hanya elemen `.sc-flag` yang diakui milik kita. Satu pun teks yang berubah karena
 * Gmail tidak termasuk, sehingga pemindaian ulang karena perubahan Gmail tidak pernah
 * tertahan oleh penyaring ini.
 */
function isOwnFlagMutation(records: readonly MutationRecord[]): boolean {
  if (records.length === 0) return false;

  return records.every((record) => {
    const nodes = [...record.addedNodes, ...record.removedNodes];
    if (nodes.length === 0) return false;
    return nodes.every(isFlagNode);
  });
}

/** Membaca `aria-label` sebuah elemen, sudah dirapikan dan diturunkan hurufnya. */
function labelOf(element: Element): string {
  return (element.getAttribute('aria-label') ?? '').trim().toLowerCase();
}

/**
 * Tombol "lainnya" (⋮) milik sebuah pesan, atau `null` bila tidak ditemukan.
 *
 * Pencarian dibatasi ke dalam elemen ber-`data-message-id`, bukan seluruh halaman: tombol
 * itu memang milik pesan, dan menjelajahi halaman utuh akan menemukan tombol milik daftar
 * inbox — persis kesalahan yang pernah membuat panel menjelaskan pengirim yang salah.
 */
function findMoreButton(): HTMLElement | null {
  for (const message of document.querySelectorAll('[data-message-id]')) {
    for (const button of message.querySelectorAll('button')) {
      const label = labelOf(button);
      if (label.length > 0 && MORE_BUTTON_LABELS.includes(label)) return button;
    }
  }
  return null;
}

/** Item menu "Show original" yang sedang terbuka, atau `null`. */
function findShowOriginalItem(): HTMLElement | null {
  for (const item of document.querySelectorAll('[role="menuitem"], [role="menu"] li')) {
    // Spasi dirapatkan dulu: teks elemen sering memuat baris baru dari indentation, dan
    // perbandingan kata-kata yang persis akan gagal hanya karena formatnya.
    const text = (item.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    // Selektor campuran mengembalikan `Element`; elemen menu Gmail selalu elemen HTML,
    // dan `click()` hanya dimiliki HTML.
    if (SHOW_ORIGINAL_LABELS.includes(text)) return item as HTMLElement;
  }
  return null;
}

/** Menunggu item menu muncul, karena Gmail merendernya setelah tombolnya diklik. */
async function waitForShowOriginalItem(): Promise<HTMLElement | null> {
  const deadline = Date.now() + MENU_WAIT_MS;
  for (;;) {
    const item = findShowOriginalItem();
    if (item !== null) return item;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Membuka halaman "Show original" dengan mendorong menu Gmail, bukan dengan mengambilnya.
 *
 * Tiga keadaan hasilnya, dan ketiganya dibedakan karena menjawab pertanyaan yang berbeda
 * — lihat `OpenHeaderResult` di `lib/messaging.ts`. Pada dua keadaan terakhir pengguna
 * tetap melihat langkah manualnya di popup: yang dilakukan fungsi ini adalah memperpendek
 * jalannya, bukan menggantinya.
 */
async function openShowOriginal(): Promise<OpenHeaderResult> {
  const button = findMoreButton();
  if (button === null) return { opened: false, menuOpened: false };

  button.click();

  const item = await waitForShowOriginalItem();
  if (item === null) return { opened: false, menuOpened: true };

  item.click();
  return { opened: true, menuOpened: true };
}

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_idle',
  // `ui` berarti CSS yang diimpor entrypoint ini disuntikkan ke dalam shadow root, bukan ke
  // halaman. Tanpa itu, gaya panel akan bocor ke webmail dan sebaliknya.
  cssInjectionMode: 'ui',
  async main(ctx) {
    /**
     * UI panel, dibuat **satu kali** dan disimpan sebagai promise.
     *
     * Sebelumnya UI dibuat malas di dalam `show()` dengan pemeriksaan `ui === null`. Itu
     * meninggalkan celah: `createShadowRootUi` menunggu satu permintaan CSS, dan pemindaian
     * kedua yang dimulai sebelum permintaan pertama selesai akan melihat `ui` masih `null`
     * lalu membuat panel kedua. Panel pertama tidak pernah dibuang oleh siapa pun, sehingga
     * yang tertinggal adalah panel yatim — terlihat, tetapi tidak lagi diperbarui.
     *
     * Menyimpan promise-nya menutup celah itu tanpa mengunci apa pun: pembuatan tetap
     * terjadi saat panel pertama kali dibutuhkan, dan setelah itu semua pemanggil menunggu
     * objek yang sama.
     */
    let uiPromise: Promise<ShadowRootContentScriptUi<HTMLElement>> | null = null;
    let pending: number | null = null;
    /**
     * URL tempat pengguna menutup panel.
     *
     * Ditutup berarti ditutup untuk halaman itu, bukan selamanya: berpindah pesan adalah
     * tindakan yang jelas berbeda dari menutup panel pada pesan sebelumnya.
     */
    let dismissedAt = '';

    /**
     * Mode diagnostik sedang aktif.
     *
     * Disimpan di sini, bukan di `panel-view.ts`, supaya lapisan tampilan tetap tidak punya
     * keadaan: ia menggambar apa yang diberikan model, dan model yang menentukan apakah
     * bagian diagnostiknya ada. Konsekuensinya setiap perubahan mode memicu penggambaran
     * ulang — dan itu memang yang terjadi, lewat jalur pemindaian yang sama dengan perubahan
     * DOM.
     */
    let diagnostic = false;

    /**
     * Isi panel yang sedang digambar, atau `null` bila tidak ada.
     *
     * Inilah yang dijawabkan kepada popup lewat `SNAPSHOT_REQUEST`. Menyimpannya di sini —
     * alih-alih membangun ulang dari DOM ketika popup bertanya — membuat jawabannya selalu
     * **sama persis** dengan yang sedang dilihat pengguna di halaman, termasuk keadaan
     * mode diagnostiknya, dan popup tidak perlu tahu apa pun tentang cara membaca halaman.
     */
    let currentModel: PanelModel | null = null;

    async function hide(): Promise<void> {
      currentModel = null;
      if (uiPromise === null) return;
      (await uiPromise).remove();
    }

    async function show(model: ReturnType<typeof buildPanelModel>): Promise<void> {
      uiPromise ??= createShadowRootUi<HTMLElement>(ctx, {
        name: 'sender-check-panel',
        // `inline` berarti WXT tidak mengatur posisi sama sekali; kartunya memposisikan
        // dirinya sendiri sebagai `fixed` di dalam CSS-nya. Mode `overlay`/`modal` akan
        // membuat kontainer menutupi viewport, dan itu menghalangi klik ke webmail.
        position: 'inline',
        anchor: 'body',
        append: 'last',
        // Panel punya tombol; tanpa ini, menekan spasi atau Enter saat tombol itu fokus
        // akan sampai juga ke pintasan papan tikus webmail.
        isolateEvents: true,
        onMount: (container) => container,
      });

      const ui = await uiPromise;

      // Dibersihkan lebih dulu, karena `ui` yang sama dipakai ulang setiap kali pesan
      // berganti. Tanpa ini, setiap pemindaian ulang akan menumpuk panel.
      ui.remove();
      ui.mount();

      const container = ui.mounted;
      if (container === undefined) return;

      const actions: PanelActions = {
        onClose: () => {
          dismissedAt = location.href;
          void hide();
        },
        // Teks yang disalin diambil dari model yang sedang digambar, bukan dibentuk ulang
        // dari temuan: tombol ini harus menyalin persis apa yang sedang dilihat pengguna,
        // dan dua jalur pembentukan teks akan berarti dua versi untuk satu email.
        onCopyReport: () => copyToClipboard(model.report),
        onToggleDiagnostic: () => {
          diagnostic = !diagnostic;
          // Digambar ulang lewat jalur yang sama dengan pemindaian biasa, bukan dengan
          // menggambar langsung dari sini: hanya `refresh` yang tahu temuan mana yang
          // ditampilkan, dan menggambar dari dua tempat akan membuat keduanya dapat
          // menyimpang.
          schedule();
        },
      };

      renderPanel(container, model, actions);
      currentModel = model;
    }

    async function refresh(): Promise<void> {
      const analysis = analyzePage(document, location);

      // Tampilan daftar tidak memunculkan panel — yang muncul adalah penanda per baris.
      // Keduanya sengaja diperlakukan di cabang terpisah: keadaan "panel ditutup" pada
      // sebuah thread tidak boleh mematikan penanda di daftar, dan sebaliknya.
      if (analysis.kind === 'list') {
        renderListFlags();
        await hide();
        return;
      }

      clearListFlags();

      const finding = analysis.primary;

      if (finding === null || dismissedAt === location.href) {
        await hide();
        return;
      }

      try {
        // Sumber diagnostik hanya diambil ketika mode itu aktif. `diagnosticSourceFor`
        // mengembalikan verdikt mentah, dan tidak ada alasan menyentuhnya pada pemakaian
        // biasa.
        const source = diagnostic ? diagnosticSourceFor(analysis, finding) : null;

        await show(
          buildPanelModel(finding, {
            diagnostic: diagnostic && source !== null,
            ...(source !== null ? { source } : {}),
          }),
        );
      } catch (error) {
        // Halaman web adalah input yang tidak dapat dipercaya: bila body belum ada atau
        // sudah diganti, yang benar adalah tidak menampilkan apa pun dan mencatatnya,
        // bukan melempar dari content script.
        console.warn('[Sender-Check] panel tidak dapat dipasang:', error);
      }
    }

    /** Menjadwalkan satu pemindaian, dan membatalkan jadwal sebelumnya. */
    function schedule(): void {
      // `ctx.setTimeout` membawa serta pembersihannya saat konteks ini tidak lagi berlaku,
      // jadi timeout yang belum sempat berjalan tidak akan memanggil kode setelah ekstensi
      // dimuat ulang. Pembatalannya sendiri memakai `clearTimeout` biasa, sesuai kontrak
      // `ContentScriptContext`.
      if (pending !== null) clearTimeout(pending);
      pending = ctx.setTimeout(() => {
        pending = null;
        // Pemindaian dijalankan saat idle: ia membaca DOM, bukan mengubahnya, tetapi pada
        // thread panjang ia tetap bisa memakan beberapa milidetik.
        ctx.requestIdleCallback(() => void refresh());
      }, DEBOUNCE_MS);
    }

    const observer = new MutationObserver((records) => {
      if (isOwnFlagMutation(records)) return;
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      // Penanda tertinggal di DOM halaman bila ekstensi dimuat ulang: cabut bersih.
      clearListFlags();
    });

    /**
     * Jawaban untuk popup.
     *
     * Dua cabang, dan cara menjawabnya berbeda: snapshot sudah ada di memori sehingga
     * dijawab lewat `sendResponse` biasa, sedangkan membuka halaman header memerlukan
     * waktu (menunggu menu Gmail dirender) sehingga menjawab secara tertunda dengan
     * mengembalikan `true` — pola yang berlaku di Chrome maupun Firefox.
     *
     * Ini juga satu-satunya alasan ekstensi ini tetap tanpa background script: pesan tidak
     * perlu diteruskan ke mana pun, content script halaman yang menjawabnya langsung.
     */
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message === SNAPSHOT_REQUEST) {
        sendResponse(currentModel);
        return false;
      }

      if (message === OPEN_HEADER_REQUEST) {
        void openShowOriginal().then(sendResponse);
        return true;
      }

      return false;
    });

    /**
     * Pintasan mode diagnostik.
     *
     * Didaftarkan pada `window` dengan `capture`, bukan pada `document` tanpa capture: papan
     * tikus webmail menangani tombolnya pada fase bubbling, dan pendengar capture berjalan
     * lebih dulu — sehingga `preventDefault` di sini benar-benar mencegah pintasan webmail
     * ikut berjalan.
     *
     * `event.repeat` dibuang supaya menahan tombol tidak membalik-balik mode itu berkali-kali
     * per detik.
     */
    ctx.addEventListener(
      window,
      'keydown',
      (event) => {
        if (event.repeat) return;
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (event.key.toLowerCase() !== DIAGNOSTIC_SHORTCUT_KEY) return;

        event.preventDefault();
        diagnostic = !diagnostic;
        schedule();
      },
      { capture: true },
    );

    // Webmail berpindah halaman tanpa memuat ulang dokumen, sehingga `MutationObserver`
    // saja tidak cukup: panel yang sudah ditutup harus dapat muncul lagi di pesan lain.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      dismissedAt = '';
      schedule();
    });

    schedule();
  },
});
