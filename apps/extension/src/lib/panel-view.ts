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
 *
 * ## Mode diagnostik
 *
 * Yang digambar di sini adalah **satu** panel, dan mode diagnostik tidak mengubah itu: ia
 * mengganti bagian tengah kartu — bukti, autentikasi, dan bagian preventif — dengan nilai
 * mentah engine. Kepala kartu, medan identitas, dan disclaimer tetap sama persis, sehingga
 * panelnya tetap dapat dikenali sebagai panel yang sama. Tombol mode itu sendiri berada di
 * kepala kartu, dan seluruh keadaan mode disimpan pemanggil, bukan di sini.
 */
import type { PanelDiagnostic, PanelModel } from './panel-model.ts';

/** Kunci gaya modul, dipakai juga oleh CSS. */
export const PANEL_CLASS = 'sc-card';

/**
 * Yang dapat dilakukan panel.
 *
 * Dikumpulkan dalam satu objek, bukan sebagai dua argumen: panel punya dua tombol, dan
 * pemanggil yang menambahkan tombol ketiga nanti tidak perlu mengubah tanda tangan setiap
 * fungsi gambar di berkas ini. Keadaan mode diagnostik sendiri **tidak** disimpan di sini —
 * ia milik pemanggil, dan berkas ini hanya melaporkan bahwa tombolnya ditekan.
 */
export interface PanelActions {
  readonly onClose: () => void;
  readonly onToggleDiagnostic: () => void;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHeader(
  model: PanelModel,
  actions: PanelActions,
): HTMLElement {
  const header = element('header', 'sc-head');

  const mark = element('span', 'sc-mark', model.mark);
  mark.setAttribute('aria-hidden', 'true');

  const titles = element('div', 'sc-titles');
  titles.append(
    element('p', 'sc-title', model.title),
    element('p', 'sc-subject', model.subject),
  );

  const buttons = element('div', 'sc-actions');

  const diagnostic = element(
    'button',
    'sc-diag-toggle',
    model.diagnostic === null ? 'diagnostik' : 'diagnostik · aktif',
  );
  diagnostic.setAttribute('type', 'button');
  diagnostic.setAttribute('aria-pressed', model.diagnostic === null ? 'false' : 'true');
  // Jalan masuknya disebutkan pada `title`, bukan sebagai teks di dalam kartu: tombol ini
  // alat pengembang, dan panel bagi pengguna biasa tidak boleh menjelaskan dirinya sendiri
  // dengan istilah internal.
  diagnostic.setAttribute('title', 'Mode diagnostik (Alt+Shift+D)');
  diagnostic.addEventListener('click', actions.onToggleDiagnostic);

  const close = element('button', 'sc-close', '×');
  close.setAttribute('type', 'button');
  close.setAttribute('aria-label', 'Tutup panel Sender-Check');
  close.addEventListener('click', actions.onClose);

  buttons.append(diagnostic, close);
  header.append(mark, titles, buttons);
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
 * Bagian "apa yang belum diperiksa, dan apa yang sebaiknya dilakukan".
 *
 * `null` bila tidak ada yang perlu dikatakan — dan itu keadaan normal pada state yang sudah
 * punya penilaian. Bagian ini sengaja tidak memakai warna peringatan: `UNASSESSABLE` berarti
 * belum dapat dipastikan, bukan mencurigakan, dan mewarnainya seperti temuan akan membuat
 * setiap email dengan nama orang biasa tampak berbahaya.
 */
function renderBasis(model: PanelModel): HTMLElement | null {
  if (model.basis === null && model.guidance === null) return null;

  const section = element('section', 'sc-section sc-section--basis');

  if (model.basis !== null) {
    section.append(element('p', 'sc-basis', model.basis));
  }

  if (model.guidance !== null) {
    section.append(element('p', 'sc-guidance', model.guidance));
  }

  return section;
}

/**
 * Satu daftar label/nilai.
 *
 * Dipakai untuk ringkasan dan untuk `gate`, karena keduanya berbentuk sama. Tidak ada
 * pengetahuan tentang nama medannya di sini — itulah yang membuat berkas ini tetap tipis
 * ketika engine menambah satu nilai diagnostik baru.
 */
function renderRows(rows: readonly { label: string; value: string }[]): HTMLElement {
  const list = element('dl', 'sc-diag-rows');

  for (const row of rows) {
    const item = element('div', 'sc-diag-row');
    item.append(
      element('dt', 'sc-diag-label', row.label),
      element('dd', 'sc-diag-value', row.value),
    );
    list.append(item);
  }

  return list;
}

function renderDiagnosticSection(title: string, rows: readonly { label: string; value: string }[]): HTMLElement {
  const section = element('section', 'sc-diag-section');
  section.append(element('h4', 'sc-diag-h', title), renderRows(rows));
  return section;
}

/**
 * Bagian diagnostik: nilai mentah engine, apa adanya.
 *
 * Sengaja dibedakan tampilannya dari bagian lain — tipografi monospace dan latar gelap — dan
 * itu bukan hiasan. Isi bagian ini adalah istilah internal dan bukti mentah, dan pengguna
 * yang membukanya harus melihat dengan sekali pandang bahwa ini bukan penilaian melainkan
 * dasarnya. Disclaimer tetap di bawah kartu, seperti pada panel biasa.
 */
function renderDiagnostic(diagnostic: PanelDiagnostic): HTMLElement {
  const section = element('section', 'sc-section sc-section--diag');

  section.append(
    element('h3', 'sc-h', 'Diagnostik'),
    element(
      'p',
      'sc-diag-note',
      'Nilai internal engine, apa adanya. Yang di atas tetap penilaiannya; bagian ini hanya dasarnya.',
    ),
    renderDiagnosticSection('Verdikt', diagnostic.summary),
    renderDiagnosticSection('Gate', diagnostic.gate),
  );

  const traceSection = element('section', 'sc-diag-section');
  traceSection.append(element('h4', 'sc-diag-h', 'Decision table'));
  if (diagnostic.winner !== null) {
    traceSection.append(element('p', 'sc-diag-winner', diagnostic.winner));
  }
  const rows = element('ul', 'sc-diag-list');
  for (const row of diagnostic.rows) {
    rows.append(element('li', 'sc-diag-item', row));
  }
  traceSection.append(rows);
  section.append(traceSection);

  const codeSection = element('section', 'sc-diag-section');
  codeSection.append(
    element('h4', 'sc-diag-h', 'Kode bukti'),
    element('p', 'sc-diag-mono', diagnostic.codes),
  );
  section.append(codeSection);

  const evidenceSection = element('section', 'sc-diag-section');
  evidenceSection.append(element('h4', 'sc-diag-h', 'Bukti apa adanya (termasuk yang netral)'));

  for (const item of diagnostic.reasons) {
    const entry = element('div', 'sc-diag-evidence');
    entry.append(element('p', 'sc-diag-code', item.heading));

    // `null` berarti bukti netral: panel biasa membuangnya, dan di sini ia tetap muncul tanpa
    // kalimat — supaya terlihat bahwa ia ada dan memang tidak dinilai.
    entry.append(
      element('p', 'sc-diag-row-value', item.sentence ?? '(netral: tidak dipakai menilai)'),
    );
    entry.append(element('p', 'sc-diag-mono', `args   ${item.args}`));
    entry.append(element('p', 'sc-diag-mono', `trace  ${item.trace}`));
    evidenceSection.append(entry);
  }

  section.append(evidenceSection);
  return section;
}

/**
 * Menggambar panel ke dalam `container`.
 *
 * Isi lama dibuang lebih dulu supaya pemanggilan berulang tidak menumpuk panel — dan
 * pemanggilan berulang itu normal: setiap perubahan DOM Gmail memicu pemindaian ulang.
 *
 * Pada mode diagnostik, bagian tengah kartu diganti — bukan ditambahi. Alasannya bukan
 * kerapian: panel ini `position: fixed` dengan tinggi terbatas, dan menambahkan sembilan baris
 * decision table plus seluruh bukti mentah di bawah penjelasan akan membuat penjelasannya
 * sendiri berada di luar layar. Yang tidak boleh hilang tetap ada di mode mana pun: kepala
 * kartu, medan identitas, dan disclaimer.
 */
export function renderPanel(
  container: HTMLElement,
  model: PanelModel,
  actions: PanelActions,
): void {
  container.replaceChildren();

  const card = element('section', `${PANEL_CLASS} ${PANEL_CLASS}--${model.state}`);
  // `role="status"` dan `aria-live="polite"` membuat pembaca layar mengumumkan hasilnya
  // tanpa merebut fokus pengguna dari webmail.
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');

  card.append(renderHeader(model, actions), renderFields(model));

  if (model.diagnostic === null) {
    card.append(renderReasons(model));

    const auth = renderAuthentication(model);
    if (auth !== null) card.append(auth);

    const basis = renderBasis(model);
    if (basis !== null) card.append(basis);
  } else {
    card.append(renderDiagnostic(model.diagnostic));
  }

  card.append(renderDisclaimer(model));
  container.append(card);
}
