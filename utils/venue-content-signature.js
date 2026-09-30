/**
 * ============================================
 * Venue Content Signature
 * ============================================
 * Mekân içeriğinin kısa imzası. Kiosk cihaz config'ini ~15 saniyede bir
 * çekiyor; imza her turda o yanıtla gidiyor ve değiştiğini gören kiosk kendi
 * tam içerik kontrolünü tetikliyor. Böylece editörden yayınlanan bir
 * değişiklik ayrı bir yoklama ucu açmadan, ek istek doğurmadan saniyeler
 * içinde duyuluyor.
 *
 * Bu değer kiosk'un içerik revizyonu hash'iyle bilinçli olarak AYNI DEĞİL:
 * aynı formülü iki ayrı depoda sürdürmek, biri değiştiğinde sessiz bir
 * uyuşmazlık doğurur. Buradaki tek görev "bir şey değişti" demek; hangi
 * revizyona geçildiğine kiosk kendi hesabıyla karar veriyor.
 */

const crypto = require('crypto');

/**
 * Tarihi epoch milisaniyesine indirger.
 *
 * `String(date)` yerel saat dilimine göre biçimleniyor ve kiosk ardışık
 * yoklamalarda farklı Cloud Run örneklerine düşebiliyor. Ham Date'i imzaya
 * katmak, içerik hiç değişmese bile örnekler arasında imzanın oynamasına ve
 * her turda sahte tetiklemeye yol açardı.
 */
function stamp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : String(date.getTime());
}

/**
 * @param {object|null} venue Lean venue dokümanı
 * @returns {string} 12 karakterlik imza — venue yoksa ''
 */
function venueContentSignature(venue) {
  if (!venue || typeof venue !== 'object') return '';

  const parts = [
    venue.geojson?.checksum || '',
    stamp(venue.geojson?.updatedAt),
    venue.geojsonPath || '',
    stamp(venue.kioskConfig?.updatedAt),
    stamp(venue.mapConfig?.updatedAt),
    venue.media?.logo?.checksum || '',
    /* Yukarıdaki alanların kaçırdığı bir yazma yolu olursa yakalayıcı: her
     * venue kaydında artıyor. Fazladan tetiklenen kontrol zararsız — kiosk
     * gerçek bir revizyon değişikliği bulamazsa hiçbir şey yapmıyor. */
    stamp(venue.updatedAt),
  ];

  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 12);
}

module.exports = { venueContentSignature };
