/**
 * Infrastruktur pengiriman massal (ESP) dan platform email transaksional.
 *
 * Kenapa daftar ini wajib ada: pola ESP yang paling umum adalah
 * display name = brand, domain From = domain brand sendiri, tetapi
 * Return-Path = domain ESP. Tanpa kelas ini, `RETURN_PATH_NULL_OR_MISMATCH`
 * dan `REPLY_TO_DOMAIN_MISMATCH` akan menyala pada email yang sepenuhnya sah —
 * sumber false positive terbesar di Tier B.
 *
 * BATAS KELAS INI PENTING: yang masuk hanya domain *infrastruktur pengiriman*,
 * yaitu domain yang muncul di Return-Path atau indikator "via". Domain milik brand
 * (github.com, google.com, paypal.com, midtrans.com, ...) TIDAK boleh masuk ke sini.
 * Menandai domain brand sebagai ESP akan menekan mismatch pada pengirim yang justru
 * harus dinilai, sehingga menciptakan lubang false negative yang sistematis.
 *
 * Disimpan sebagai domain yang dapat didaftarkan menurut PSL.
 */
export const ESP_DOMAINS: ReadonlySet<string> = new Set([
  // --- Pengiriman transaksional ---
  'sendgrid.net',
  'sendgrid.com',
  'sendgridmail.com',
  'mailgun.org',
  'mailgun.net',
  'amazonses.com',
  'postmarkapp.com',
  'postmarkmail.com',
  'sparkpostmail.com',
  'sparkpost.com',
  'mandrillapp.com',
  'mandrill.com',
  'mailjet.com',
  'mailjet.net',
  'brevo.com',
  'sendinblue.com',
  'elasticemail.com',
  'mailersend.com',
  'mailersend.net',
  'resend.com',
  'pepipost.com',
  'smtp2go.com',
  'socketlabs.com',
  'sendpulse.com',
  'mailtrap.io',
  'mailbaby.net',
  'mailroute.net',
  'privateemail.com',

  // --- Pemasaran / newsletter ---
  'mailchimp.com',
  'list-manage.com',
  'list-manage1.com',
  'mcsv.net',
  'mcdlv.net',
  'mailchi.mp',
  'campaign-archive.com',
  'campaign-archive1.com',
  'campaign-archive2.com',
  'cmail19.com',
  'cmail20.com',
  'createsend.com',
  'createsendmail.com',
  'customeriomail.com',
  'customer.io',
  'klaviyo.com',
  'klclick.com',
  'klclick1.com',
  'mailerlite.com',
  'activecampaign.com',
  'acemlna.com',
  'acemlnb.com',
  'aweber.com',
  'getresponse.com',
  'constantcontact.com',
  'ctctcdn.com',
  'exacttarget.com',
  'exct.net',
  'rsgsv.net',
  'hubspotemail.net',
  'hs-sites.com',
  'pardot.com',
  'mktoresp.com',
  'mktomail.com',
  'eloqua.com',
  'en25.com',
  'responsys.net',
  'bronto.com',
  'dotdigital.com',
  'dm-mailinglist.com',
  'icptrack.com',
  'ccsend.com',
  'messagegears.net',
  'ongage.net',
  'sendibm1.com',
  'sendibm2.com',
  'sendibm3.com',
  'sendibm4.com',
  'bm23.com',
  'mailup.net',
  'mailup.com',
  'emarsys.net',
  'selligent.com',
  'iterable.com',
  'braze.com',
  'appboy.com',
  'onesignal.com',

  // --- Dukungan pelanggan / CRM / outreach ---
  'zendesk.com',
  'helpscout.net',
  'freshdesk.com',
  'intercom-mail.com',
  'intercom.io',
  'frontapp.com',
  'kayako.com',
  'groovehq.com',
  'crisp.chat',
  'tawk.to',
  'livechatinc.com',
  'salesloft.com',
  'outreach.io',
  'mixmax.com',
  'yesware.com',
  'reply.io',
  'lemlist.com',
  'instantly.ai',

  // --- Infrastruktur notifikasi milik platform ---
  // Domain ini memang dipakai sebagai domain pengirim untuk notifikasi, dan bukan
  // domain yang mewakili identitas organisasi pengirimnya.
  'facebookmail.com',
  'shopifyemail.com',
  'wixpress.com',
  'secureserver.net',
  'squarespace-mail.com',
]);

export function isEspDomain(registrableDomain: string): boolean {
  return ESP_DOMAINS.has(registrableDomain);
}
