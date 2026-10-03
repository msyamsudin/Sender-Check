/**
 * Menuangkan isi panel ke DOM.
 *
 * Berkas ini sengaja tipis: seluruh keputusan tentang **apa** yang ditampilkan ada di
 * `panel-model.ts`, dan berkas ini hanya membuat elemennya. Tidak ada logika analisis di
 * sini, sehingga tidak ada yang perlu diuji di dalam browser.
 *
 * ## Kenapa tidak ada `innerHTML`
 *
 * Display name, alamat, dan objek email seluruhnya berasal dari email yang dikendalikan
 * pengirim. Menempelkannya sebagai HTML berarti menjalankan markup penyerang di dalam
 * halaman webmail pengguna, dengan sesi pengguna itu. Karena itu setiap teks ditulis lewat
 * `textContent`, dan tidak ada satu pun jalur yang menafsirkan teks sebagai markup.
 *
 * Aturan itu ditegakkan test yang membaca berkas ini dan menolak `innerHTML`,
 * `insertAdjacentHTML`, `outerHTML`, dan `document.write`.
 */
import type { PanelModel } from './panel-model.ts';

/** Kunci gaya modul, dipakai juga oleh CSS. */
export const PANEL_CLASS = 'sc-card';

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeader(model: PanelModel, onClose: () => void): HTMLElement {
  const header = element('header', 'sc-head');

  const mark = element('span', 'sc-mark', model.mark);
  mark.setAttribute('aria-hidden', 'true');

  const titles = element('div', 'sc-titles');
  titles.append(
    element('p', 'sc-title', model.title),
    element('p', 'sc-subject', model.subject),
  );

  const close = element('button', 'sc-close', '×');
  close.setAttribute('type', 'button');
  close.setAttribute('aria-label', 'Tutup panel Sender-Check');
  close.addEventListener('click', onClose);

  header.append(mark, titles, close);
  return header;
}

function renderFields(model: PanelModel): HTMLElement {
  const list = element('dl', 'sc-fields');

  for (const field of model.fields) {
    const row = element('div', 'sc-field');
    row.append(
      element('dt', 'sc-field-label', field.label),
      element('dd', 'sc-field-value', field.value),
    );
    list.append(row);
  }

  return list;
}

function renderReasons(model: PanelModel): HTMLElement {
  const section = element('section', 'sc-section');

  if (model.reasons.length === 0) {
    section.append(element('p', 'sc-empty', 'Tidak ada bukti yang dapat ditampilkan.'));
    return section;
  }

  section.append(element('h3', 'sc-h', 'Mengapa'));
  const list = element('ul', 'sc-reasons');

  for (const reason of model.reasons) {
    const item = element('li', `sc-reason sc-reason--${reason.kind}`);

    // Bobot tidak ditampilkan untuk keterangan konteks: "konteks · lemah" tidak berarti apa
    // pun bagi pengguna, dan membuat keterangan dari webmail tampak seperti penilaian.
    const tag = reason.context ? reason.label : `${reason.label} · ${reason.strength}`;

    item.append(
      element('span', 'sc-tag', tag),
      element('span', 'sc-sentence', reason.sentence),
    );
    list.append(item);
  }

  section.append(list);
  return section;
}

function renderAuthentication(model: PanelModel): HTMLElement | null {
  if (model.authentication.length === 0) return null;

  const section = element('section', 'sc-section sc-section--auth');
  section.append(element('h3', 'sc-h', 'Autentikasi'));

  const list = element('ul', 'sc-auth');
  for (const sentence of model.authentication) {
    list.append(element('li', 'sc-auth-item', sentence));
  }

  section.append(list);
  return section;
}

function renderDisclaimer(model: PanelModel): HTMLElement {
  const footer = element('footer', 'sc-disclaimer');
  for (const line of model.disclaimer) {
    footer.append(element('p', 'sc-disclaimer-line', line));
  }
  return footer;
}

/**
 * Menggambar panel ke dalam `container`.
 *
 * Isi lama dibuang lebih dulu supaya pemanggilan berulang tidak menumpuk panel — dan
 * pemanggilan berulang itu normal: setiap perubahan DOM Gmail memicu pemindaian ulang.
 */
export function renderPanel(
  container: HTMLElement,
  model: PanelModel,
  onClose: () => void,
): void {
  container.replaceChildren();

  const card = element('section', `${PANEL_CLASS} ${PANEL_CLASS}--${model.state}`);
  // `role="status"` dan `aria-live="polite"` membuat pembaca layar mengumumkan hasilnya
  // tanpa merebut fokus pengguna dari webmail.
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  card.append(renderHeader(model, onClose), renderFields(model));

  const reasons = renderReasons(model);
  card.append(reasons);

  const auth = renderAuthentication(model);
  if (auth !== null) card.append(auth);

  card.append(renderDisclaimer(model));
  container.append(card);
}
