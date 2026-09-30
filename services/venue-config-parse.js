/**
 * Editor'dan export edilen config.js / config.json dosyasini ayristirir.
 *
 * Venue Manager haritasi yalnizca `features.map` (ve varsa venue.floorMap)
 * kullanir; kiosk ise config'in tamamina ihtiyac duyar (tema, branding,
 * navigation, routingCost...). Bu yuzden parser her ikisini de dondurur.
 */

const vm = require('vm');

function extractBalancedObject(text) {
  let depth = 0;
  let inStr = null;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
  throw Object.assign(new Error('Config nesnesi tamamlanmamış'), { status: 400 });
}

function extractMapFromConfigObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.features?.map && typeof obj.features.map === 'object') return obj.features.map;
  if (obj.map && typeof obj.map === 'object'
    && (obj.map.basemap || obj.map.sublayerHeights || obj.map.roomRenderMode)) {
    return obj.map;
  }
  if (obj.basemap || obj.sublayerHeights || obj.roomRenderMode) return obj;
  return null;
}

function toJsonClone(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw Object.assign(new Error(`${label} JSON’a dönüştürülemedi`), { status: 400 });
  }
}

/**
 * Kiosk'un tamamini besleyebilecek bir config mi, yoksa yalnizca harita
 * ayarlarini iceren kismi bir parca mi? Kismi parcalar kiosk config'i olarak
 * saklanmaz, aksi halde kiosk eksik bir config ile acilir.
 */
function isFullKioskConfig(obj) {
  return Boolean(
    obj
    && typeof obj === 'object'
    && obj.features && typeof obj.features === 'object'
    && obj.features.map && typeof obj.features.map === 'object'
    && obj.venue && typeof obj.venue === 'object',
  );
}

function trimSheetText(value) {
  return String(value || '').trim();
}

/** Kiosk / panel sheet okuması için sheetId + list sekmesi (veya gid) dolu mu? */
function sheetsConfigComplete(sheets) {
  if (!sheets || typeof sheets !== 'object') return false;
  if (!trimSheetText(sheets.sheetId)) return false;
  return !!(trimSheetText(sheets.tabs?.list) || trimSheetText(sheets.gid));
}

/**
 * Editör "venue'ya kaydet" kioskConfig'e sheets yazar; kiosk ise runtime-config
 * override'ında Venue.sheets kullanır. Bu yüzden tam bir editor config'indeki
 * sheet bağlantısı kanonik Venue.sheets'e kopyalanır. Boş/eksik sheets eski
 * kaydı silmez (derleme varsayılanı veya kısmi parça).
 *
 * Editör formu `tabs.changes` taşımaz; boş gelen changes mevcut değeri korur.
 * @returns {boolean} sheets güncellendi mi
 */
function applyVenueSheetsFromConfig(venue, fullConfig) {
  if (!venue || typeof venue !== 'object') return false;
  const incoming = fullConfig?.venue?.sheets;
  if (!sheetsConfigComplete(incoming)) return false;

  const current = venue.sheets && typeof venue.sheets === 'object' ? venue.sheets : {};
  const currentTabs = current.tabs && typeof current.tabs === 'object' ? current.tabs : {};
  const incomingTabs = incoming.tabs && typeof incoming.tabs === 'object' ? incoming.tabs : {};

  if (!venue.sheets || typeof venue.sheets !== 'object') venue.sheets = {};
  if (!venue.sheets.tabs || typeof venue.sheets.tabs !== 'object') venue.sheets.tabs = {};

  venue.sheets.sheetId = trimSheetText(incoming.sheetId);
  venue.sheets.writeEndpointUrl = trimSheetText(incoming.writeEndpointUrl);
  venue.sheets.gid = trimSheetText(incoming.gid);
  venue.sheets.tabs.list = trimSheetText(incomingTabs.list);
  venue.sheets.tabs.categories = trimSheetText(incomingTabs.categories);
  venue.sheets.tabs.info = trimSheetText(incomingTabs.info);
  venue.sheets.tabs.changes = trimSheetText(incomingTabs.changes) || trimSheetText(currentTabs.changes);

  if (typeof venue.markModified === 'function') venue.markModified('sheets');
  return true;
}

/**
 * @param {Buffer|string} input
 * @param {string} [originalFileName]
 * @returns {{ map: object, floorMap: object|null, full: object|null }}
 */
function parseEditorConfigSource(input, originalFileName = '') {
  const text = Buffer.from(input).toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!text) {
    throw Object.assign(new Error('Config dosyası boş'), { status: 400 });
  }

  let parsed = null;
  const preferJson = /\.json$/i.test(originalFileName) || text[0] === '{';

  if (preferJson && text[0] === '{') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!parsed) {
    const exportMatch = text.match(/export\s+(?:const|let|var)\s+config\s*=/);
    const assignMatch = text.match(/(?:^|[\n;])\s*(?:const|let|var)\s+config\s*=/);
    let start = -1;
    if (exportMatch) {
      start = exportMatch.index + exportMatch[0].length;
    } else if (assignMatch) {
      start = text.indexOf('=', assignMatch.index) + 1;
    } else if (text.startsWith('{')) {
      start = 0;
    } else {
      throw Object.assign(
        new Error('Geçerli bir editor config bulunamadı (export const config = …)'),
        { status: 400 },
      );
    }

    const body = text.slice(start).trim();
    const objectLiteral = body.startsWith('{') ? extractBalancedObject(body) : body.replace(/;?\s*$/, '');

    try {
      parsed = vm.runInNewContext(`(${objectLiteral})`, { Math }, { timeout: 1500 });
    } catch (err) {
      throw Object.assign(
        new Error(`Config ayrıştırılamadı: ${err.message}`),
        { status: 400 },
      );
    }
  }

  const map = extractMapFromConfigObject(parsed);
  if (!map) {
    throw Object.assign(new Error('Config içinde features.map bulunamadı'), { status: 400 });
  }

  const floorMap = parsed?.venue?.floorMap && typeof parsed.venue.floorMap === 'object'
    ? toJsonClone(parsed.venue.floorMap, 'venue.floorMap')
    : null;

  return {
    map: toJsonClone(map, 'features.map'),
    floorMap,
    full: isFullKioskConfig(parsed) ? toJsonClone(parsed, 'config') : null,
  };
}

module.exports = {
  parseEditorConfigSource,
  extractMapFromConfigObject,
  isFullKioskConfig,
  sheetsConfigComplete,
  applyVenueSheetsFromConfig,
};
