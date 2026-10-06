/**
 * Popup: analisis pesan yang sedang aktif.
 *
 * ## Kenapa popup tidak menganalisis sendiri
 *
 * Popup berjalan di konteks ekstensi, bukan di dalam halaman Gmail — ia tidak punya akses
 * ke DOM sama sekali. Satu-satunya yang dapat ia lakukan adalah meminta isi panel kepada
 * content script yang memang sudah berada di halaman itu, lewat kontrak di
 * `lib/messaging.ts`. Karena itu analisisnya **identik** dengan panel yang muncul di halaman:
 * model yang sama, kalimat yang sama, satu-satunya jalur pembentukan isi.
 *
 * ## Tombol "Analisis header lengkap"
 *
 * `Reply-To`, `Return-Path`, dan `Authentication-Results` hanya ada di halaman "Show
 * original", dan ekstensi tidak pernah mengambil halaman itu sendiri (keputusan D1 di
 * `docs/DESIGN.md`). Yang dilakukan tombol ini adalah mendorong menu Gmail yang memang
 * sudah menyediakannya, dan bila itu tidak berhasil, popup menuliskan langkah manualnya.
 * Ketiga hasilnya dibedakan di `lib/messaging.ts`, karena ketiganya menjawab pertanyaan
 * yang berbeda.
 *
 * ## Yang tidak dilakukannya
 *
 * Tidak ada permission baru, tidak ada `chrome.tabs` selain `query`/`sendMessage` yang tidak
 * memerlukan permission `tabs`, dan tidak ada permintaan jaringan — aturan yang dijaga
 * `tests/architecture.test.ts`.
 */
import { browser } from 'wxt/browser';
import { copyToClipboard } from '../../lib/clipboard.ts';
import {
  OPEN_HEADER_REQUEST,
  SNAPSHOT_REQUEST,
  type OpenHeaderResult,
} from '../../lib/messaging.ts';
import type { PanelModel } from '../../lib/panel-model.ts';
import { renderPanel, type PanelActions } from '../../lib/panel-view.ts';
import '../../lib/panel.css';
import '../../lib/popup.css';

/** Wadah yang dibentuk oleh `popup/index.html`. */
const ROOT_ID = 'sc-popup';

/** Keadaan ketika tidak ada yang dapat dianalisis — list view, halaman lain, atau bukan Gmail. */
const EMPTY_STATE =
  'Belum ada pesan yang dapat dianalisis. Buka sebuah pesan di Gmail, lalu gunakan popup ini lagi.';

/** Keadaan ketika content script tidak menjawab — halaman belum dimuat ulang setelah pemasangan. */
const NO_RECEIVER =
  'Panel belum terpasang di halaman ini. Muat ulang tab Gmail, lalu buka popup lagi.';

/** Langkah manual, yang selalu ditampilkan: tombol hanyalah jalan pintasnya. */
const HEADER_GUIDANCE =
  'Header lengkap ("balas ke", "dikirim oleh", hasil autentikasi) hanya ada di halaman Show original. Buka menu ⋮ pada pesan → "Tampilkan aslinya".';

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Tab Gmail yang sedang aktif, atau `null` bila tidak ada yang dapat dihubungi. */
async function activeTabId(): Promise<number | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Meminta isi panel terkini, atau `null` bila content script tidak menjawab. */
async function requestSnapshot(tabId: number): Promise<PanelModel | null | 'unreachable'> {
  try {
    const model = (await browser.tabs.sendMessage(tabId, SNAPSHOT_REQUEST)) as PanelModel | null;
    return model ?? null;
  } catch {
    return 'unreachable';
  }
}

/**
 * Tombol "Analisis header lengkap" beserta statusnya.
 *
 * Statusnya selalu terisi — tombol yang hanya berkedip lalu diam tidak menjelaskan apa pun,
 * dan di sini pengguna perlu tahu apakah halaman header benar-benar terbuka atau ia harus
 * membukanya sendiri.
 */
function renderBar(tabId: number): HTMLElement {
  const bar = element('div', 'sc-bar');
  bar.append(element('p', 'sc-bar-note', HEADER_GUIDANCE));

  const button = element('button', 'sc-bar-button', 'Analisis header lengkap');
  button.setAttribute('type', 'button');

  // `aria-live` supaya pembaca layar mengumumkan hasilnya tanpa memindahkan fokus.
  const status = element('p', 'sc-bar-status');
  status.setAttribute('aria-live', 'polite');

  button.addEventListener('click', () => {
    button.setAttribute('disabled', '');
    button.textContent = 'Membuka…';
    status.textContent = '';

    void browser.tabs
      .sendMessage(tabId, OPEN_HEADER_REQUEST)
      .then((result) => {
        const outcome = (result ?? {}) as Partial<OpenHeaderResult>;
        if (outcome.opened === true) {
          status.textContent =
            'Halaman header terbuka. Panel akan menilai ulang di sana memakai "balas ke" dan hasil autentikasi.';
        } else if (outcome.menuOpened === true) {
          status.textContent =
            'Menu pesan sudah terbuka — pilih "Tampilkan aslinya" di situ. Nama menunya mengikuti bahasa Gmail.';
        } else {
          status.textContent =
            'Tombol menu pesan tidak ditemukan di halaman ini. Buka manual: menu ⋮ → "Tampilkan aslinya".';
        }
      })
      .catch(() => {
        status.textContent = 'Halaman Gmail tidak menjawab. Muat ulang tab-nya lalu coba lagi.';
      })
      .finally(() => {
        button.removeAttribute('disabled');
        button.textContent = 'Analisis header lengkap';
      });
  });

  bar.append(button, status);
  return bar;
}

/** Menggambar isi popup: panel (bila ada), lalu bilah aksi header. */
function render(root: HTMLElement, model: PanelModel | null, message: string | null, tabId: number | null): void {
  root.replaceChildren();

  if (model !== null) {
    const holder = element('div', 'sc-popup-panel');
    const actions: PanelActions = {
      // Popup tidak punya tombol tutup (klik di luar jendela sudah menutup) dan tidak
      // membuka mode diagnostik — mode itu milik panel halaman, dan keadaannya memang
      // sengaja tidak bertahan antar pemuatan.
      onClose: null,
      onToggleDiagnostic: null,
      onCopyReport: () => copyToClipboard(model.report),
    };
    renderPanel(holder, model, actions);
    root.append(holder);

    if (tabId !== null) root.append(renderBar(tabId));
    return;
  }

  root.append(element('p', 'sc-popup-empty', message ?? EMPTY_STATE));
}

async function main(): Promise<void> {
  const root = document.getElementById(ROOT_ID);
  if (root === null) return;

  root.append(element('p', 'sc-popup-empty', 'Menganalisis pesan…'));

  const tabId = await activeTabId();
  if (tabId === null) {
    render(root, null, NO_RECEIVER, null);
    return;
  }

  const snapshot = await requestSnapshot(tabId);
  if (snapshot === 'unreachable') {
    render(root, null, NO_RECEIVER, null);
    return;
  }

  render(root, snapshot, null, tabId);
}

void main();
