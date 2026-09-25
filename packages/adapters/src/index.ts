/**
 * @sender-check/adapters — jembatan antara DOM webmail dan engine.
 *
 * Adapter tidak pernah memanggil `analyze()` dan tidak tahu apa pun tentang rule.
 * Ia hanya menerjemahkan DOM menjadi `EmailIdentity`. Batas itu yang membuat engine
 * tetap bebas DOM, dan yang membuat seluruh corpus test dapat berjalan di Node tanpa
 * browser.
 */
export {
  detectGmailView,
  scanGmailInbox,
} from './gmail.ts';
export {
  decodeEncodedWords,
  extractDisplayName,
  parseHeaderBlock,
  scanGmailShowOriginal,
} from './gmail-headers.ts';
export type {
  AdapterReport,
  DocumentLike,
  ElementLike,
  GmailView,
  HeaderReport,
  LocationLike,
  SelectorProbe,
  SenderCandidate,
} from './types.ts';
