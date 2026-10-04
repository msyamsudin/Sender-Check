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
import { analyzePage } from '../lib/scan.ts';
import { buildPanelModel } from '../lib/panel-model.ts';
import { renderPanel } from '../lib/panel-view.ts';
import '../lib/panel.css';

/**
 * Jeda sebelum memindai ulang setelah DOM berubah.
 *
 * 400 ms cukup untuk melewati rentetan mutasi saat pesan dibuka, dan cukup pendek sehingga
 * panel terasa muncul bersamaan dengan pesannya.
 */
const DEBOUNCE_MS = 400;

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

      renderPanel(container, model, () => {
        dismissedAt = location.href;
        void hide();
      });
    }

    async function refresh(): Promise<void> {
      const analysis = analyzePage(document, location);
      const finding = analysis.primary;

      if (finding === null || dismissedAt === location.href) {
        await hide();
        return;
      }

      try {
        await show(buildPanelModel(finding));
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

    // Webmail berpindah halaman tanpa memuat ulang dokumen, sehingga `MutationObserver`
    // saja tidak cukup: panel yang sudah ditutup harus dapat muncul lagi di pesan lain.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      dismissedAt = '';
      schedule();
    });

    schedule();
  },
});
