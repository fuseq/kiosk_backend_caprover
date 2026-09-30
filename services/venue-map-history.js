/**
 * Venue içerik geçmişi — yayınlanan harita + config'in son sürümleri.
 *
 * Her yazma (editörden kaydet, URL'den al, geri yükle, haritayı kaldır)
 * öncesinde o anki içerik `venue-maps/<venueId>/history/<id>/` altına
 * kopyalanır; Venue belgesinde yalnızca küçük bir üstveri satırı tutulur.
 * Config Mongo'ya değil depoya yazılır: `GET /api/venues` her venue'yu tam
 * döndürüyor, üç config kopyası listeyi şişirirdi.
 *
 * Sıra: yakala (eski içerik okunur) → belgeyi bellekte değiştir → işle
 * (içerik gerçekten değiştiyse kopyayı yaz) → yeni haritayı yaz → kaydet →
 * düşen eski kopyaları sil. Kopya yazılamazsa yazma iptal edilir; geri
 * dönüş yolu olmadan canlı içeriği ezmeyiz.
 */

const crypto = require('crypto');

const MAX_MAP_HISTORY = 3;
const HISTORY_PREFIX = 'venue-maps';
const HISTORY_REASONS = new Set(['save', 'url', 'restore', 'delete']);

function defaultDeps() {
  return {
    objectStore: require('./object-store'),
    readStoredVenueMap: require('./venue-map-store').readStoredVenueMap,
  };
}

function historyKeys(venueId, versionId) {
  const base = `${HISTORY_PREFIX}/${venueId}/history/${versionId}`;
  return { geojsonKey: `${base}/venue.geojson`, configKey: `${base}/config.json` };
}

function newVersionId(now = Date.now()) {
  return `${now.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Anahtar sırasından bağımsız JSON — Mongo Mixed alanları sırayı korumaz. */
function stableStringify(value) {
  if (value === undefined || value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function plain(value) {
  if (value == null) return null;
  const obj = typeof value.toObject === 'function' ? value.toObject() : value;
  return JSON.parse(JSON.stringify(obj));
}

/** Geri yüklenebilir config parçası. */
function contentOf(venue) {
  return {
    kioskConfig: plain(venue.kioskConfig),
    mapConfig: plain(venue.mapConfig),
    floorMap: plain(venue.floorMap) || {},
  };
}

function configChecksum(content) {
  return sha256(stableStringify({
    kiosk: content?.kioskConfig?.config ?? null,
    map: content?.mapConfig?.map ?? null,
    floorMap: content?.floorMap ?? {},
  }));
}

/**
 * Yayınlanan içeriğin parmak izi. Yalnızca kiosk'un gördüğü veriye bakar;
 * `updatedAt` / `updatedBy` değişimi yeni sürüm sayılmaz.
 */
function contentFingerprint(venue) {
  return sha256(stableStringify({
    geo: venue?.geojson?.checksum || venue?.geojsonPath || '',
    config: configChecksum(contentOf(venue || {})),
  }));
}

/**
 * Yeni kaydı başa ekler, en fazla `max` tutar.
 * @returns {{ kept: object[], dropped: object[] }}
 */
function planHistoryPush(history, entry, max = MAX_MAP_HISTORY) {
  const list = [entry, ...(Array.isArray(history) ? history : [])];
  return { kept: list.slice(0, max), dropped: list.slice(max) };
}

/**
 * Yazmadan önce çağrılır: o anki haritayı ve config'i belleğe alır.
 * Yönetilen bir harita yoksa (hiç yüklenmemiş / harici URL) kopyalanacak
 * bir şey yoktur, null döner.
 */
async function captureMapSnapshot(venue, deps = defaultDeps()) {
  const storageKey = venue?.geojson?.storageKey;
  if (!storageKey) return null;
  let geojsonText;
  try {
    geojsonText = await deps.readStoredVenueMap(storageKey);
  } catch (err) {
    console.warn('[map-history] mevcut harita okunamadı, sürüm alınmadı:', err.message || err);
    return null;
  }
  const content = contentOf(venue);
  const geo = plain(venue.geojson) || {};
  return {
    geojsonText,
    content,
    fingerprint: contentFingerprint(venue),
    meta: {
      savedAt: geo.updatedAt || null,
      savedBy: geo.updatedBy || '',
      originalFileName: geo.originalFileName || '',
      featureCount: geo.featureCount || 0,
      roomCount: geo.roomCount || 0,
      floors: Array.isArray(geo.floors) ? geo.floors : [],
      sizeBytes: geo.sizeBytes || 0,
      checksum: geo.checksum || '',
      configChecksum: configChecksum(content),
    },
  };
}

/** Depodaki kopyaları siler; hata canlı akışı durdurmaz. */
async function removeHistoryEntries(entries, deps = defaultDeps()) {
  for (const entry of entries || []) {
    for (const key of [entry?.geojsonKey, entry?.configKey]) {
      if (!key) continue;
      await deps.objectStore.remove(key).catch((err) => {
        console.warn('[map-history] eski sürüm silinemedi', key, err.message || err);
      });
    }
  }
}

/**
 * Belge bellekte değiştirildikten sonra çağrılır. İçerik değişmediyse
 * (aynı haritayı yeniden kaydetmek) sürüm alınmaz. `venue.mapHistory`
 * güncellenir; kaydedildikten sonra silinmesi gereken eski kayıtları döndürür.
 */
async function commitMapSnapshot(venue, snapshot, { reason = 'save', archivedBy = '' } = {}, deps = defaultDeps()) {
  if (!snapshot) return [];
  if (contentFingerprint(venue) === snapshot.fingerprint) return [];

  const history = Array.isArray(venue.mapHistory) ? plain(venue.mapHistory) : [];
  const newest = history[0];
  if (newest && newest.checksum === snapshot.meta.checksum
      && newest.configChecksum === snapshot.meta.configChecksum) {
    return [];
  }

  const id = newVersionId();
  const keys = historyKeys(String(venue._id), id);
  try {
    await deps.objectStore.put(keys.geojsonKey, Buffer.from(snapshot.geojsonText, 'utf8'), {
      contentType: 'application/geo+json',
    });
    await deps.objectStore.put(keys.configKey, Buffer.from(JSON.stringify(snapshot.content), 'utf8'), {
      contentType: 'application/json',
    });
  } catch (err) {
    await removeHistoryEntries([keys], deps);
    console.error('[map-history] sürüm yazılamadı', err);
    throw Object.assign(
      new Error('Önceki sürüm yedeklenemediği için işlem iptal edildi'),
      { status: 503 },
    );
  }

  const entry = {
    id,
    ...snapshot.meta,
    archivedAt: new Date(),
    archivedBy,
    reason: HISTORY_REASONS.has(reason) ? reason : 'save',
    ...keys,
  };
  const { kept, dropped } = planHistoryPush(history, entry);
  venue.mapHistory = kept;
  return dropped;
}

async function readHistoryEntry(entry, deps = defaultDeps()) {
  const [geo, cfg] = await Promise.all([
    deps.objectStore.get(entry.geojsonKey),
    deps.objectStore.get(entry.configKey),
  ]);
  return {
    geojsonText: geo.toString('utf8'),
    content: JSON.parse(cfg.toString('utf8')),
  };
}

function findHistoryEntry(venue, versionId) {
  const list = Array.isArray(venue?.mapHistory) ? venue.mapHistory : [];
  return list.find(e => e && e.id === String(versionId)) || null;
}

/** Panele / editöre dönen özet — depolama anahtarları dışarı çıkmaz. */
function historySummary(entry) {
  return {
    id: entry.id,
    savedAt: entry.savedAt || null,
    savedBy: entry.savedBy || '',
    archivedAt: entry.archivedAt || null,
    archivedBy: entry.archivedBy || '',
    reason: entry.reason || 'save',
    originalFileName: entry.originalFileName || '',
    featureCount: entry.featureCount || 0,
    roomCount: entry.roomCount || 0,
    floors: entry.floors || [],
    sizeBytes: entry.sizeBytes || 0,
  };
}

module.exports = {
  MAX_MAP_HISTORY,
  historyKeys,
  stableStringify,
  contentFingerprint,
  planHistoryPush,
  captureMapSnapshot,
  commitMapSnapshot,
  readHistoryEntry,
  removeHistoryEntries,
  findHistoryEntry,
  historySummary,
};
