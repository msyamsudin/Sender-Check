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
import { analyzePage, diagnosticSourceFor } from '../lib/scan.ts';
import { copyToClipboard } from '../lib/clipboard.ts';
import { buildPanelModel } from '../lib/panel-model.ts';
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

    async function hide(): Promise<void> {
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
    }

    async function refresh(): Promise<void> {
      const analysis = analyzePage(document, location);
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

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());

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
