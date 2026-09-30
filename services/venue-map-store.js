const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs').promises;
const net = require('net');
const path = require('path');

const MAX_GEOJSON_BYTES = 15 * 1024 * 1024;

/**
 * storageKey her zaman "venue-maps/<venueId>/venue.geojson" biçimindedir.
 * VENUE_ASSETS_BUCKET tanımlıysa GCS objesi, değilse storage/ altındaki yerel dosya.
 */
const STORAGE_PREFIX = 'venue-maps';
const LOCAL_STORAGE_ROOT = path.join(__dirname, '..', 'storage');
const objectStore = require('./object-store');

function venueObjectName(venueId) {
  return `${STORAGE_PREFIX}/${venueId}/venue.geojson`;
}

/** CapRover döneminde anahtarlar "storage/venue-maps/..." olarak kaydedilmişti. */
function normalizeStorageKey(storageKey) {
  const key = String(storageKey || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^storage\//, '');
  if (!key || key.split('/').includes('..')) {
    throw Object.assign(new Error('Geçersiz harita depolama yolu'), { status: 500 });
  }
  return key;
}

function localPathFor(key) {
  const root = path.resolve(LOCAL_STORAGE_ROOT);
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('Geçersiz harita depolama yolu'), { status: 500 });
  }
  return target;
}

const ALLOWED_GEOMETRIES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString',
  'Polygon', 'MultiPolygon', 'GeometryCollection',
]);

function floorLabel(key) {
  // Kullanıcı tanımlı ad yokken anahtarın kendisini kullan.
  // "Zemin Kat / 1. Bodrum" uydurmak editördeki kat adlarını eziyordu.
  return String(key);
}

function validateCoordinates(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return false;
  if (typeof coords[0] === 'number') {
    return coords.length >= 2 && coords.every(Number.isFinite);
  }
  return coords.every(validateCoordinates);
}

function validateGeometry(geometry) {
  if (!geometry || !ALLOWED_GEOMETRIES.has(geometry.type)) return false;
  if (geometry.type === 'GeometryCollection') {
    return Array.isArray(geometry.geometries)
      && geometry.geometries.length > 0
      && geometry.geometries.every(validateGeometry);
  }
  return validateCoordinates(geometry.coordinates);
}

function parseAndValidateGeojson(input) {
  let data;
  try {
    data = typeof input === 'string' || Buffer.isBuffer(input)
      ? JSON.parse(input.toString('utf8'))
      : input;
  } catch {
    throw Object.assign(new Error('Dosya geçerli JSON değil'), { status: 400 });
  }

  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw Object.assign(new Error('GeoJSON bir FeatureCollection olmalı'), { status: 400 });
  }
  if (!data.features.length) {
    throw Object.assign(new Error('GeoJSON en az bir feature içermeli'), { status: 400 });
  }

  const floors = new Set();
  let roomCount = 0;
  for (const [index, feature] of data.features.entries()) {
    if (!feature || feature.type !== 'Feature' || !validateGeometry(feature.geometry)) {
      throw Object.assign(new Error(`Feature ${index + 1} geçersiz geometri içeriyor`), { status: 400 });
    }
    const properties = feature.properties || {};
    if (properties.layer === 'rooms') {
      roomCount += 1;
      floors.add(String(properties.floor ?? '0'));
    }
  }

  if (!roomCount) {
    throw Object.assign(
      new Error('Birim Yönetimi için properties.layer=\"rooms\" olan en az bir feature gerekli'),
      { status: 400 }
    );
  }

  const floorKeys = [...floors].sort((a, b) => Number(b) - Number(a));
  return {
    data,
    metadata: {
      featureCount: data.features.length,
      roomCount,
      floors: floorKeys,
      floorMap: Object.fromEntries(floorKeys.map(key => [key, floorLabel(key)])),
    },
  };
}

function isPrivateIp(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd')
      || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea')
      || value.startsWith('feb')) return true;

  const ipv4 = value.startsWith('::ffff:') ? value.slice(7) : value;
  if (net.isIP(ipv4) !== 4) return false;
  const [a, b] = ipv4.split('.').map(Number);
  return a === 10 || a === 127 || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

async function assertSafeRemoteUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Geçerli bir harita URL’si girin'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Yalnızca HTTP veya HTTPS URL kullanılabilir'), { status: 400 });
  }
  if (url.username || url.password) {
    throw Object.assign(new Error('Kimlik bilgisi içeren URL kullanılamaz'), { status: 400 });
  }

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => isPrivateIp(item.address))) {
    throw Object.assign(new Error('Yerel veya özel ağ adreslerinden harita alınamaz'), { status: 400 });
  }
  return url;
}

async function readResponseWithLimit(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_GEOJSON_BYTES) {
    throw Object.assign(new Error('GeoJSON dosyası en fazla 15 MB olabilir'), { status: 413 });
  }

  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_GEOJSON_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error('GeoJSON dosyası en fazla 15 MB olabilir'), { status: 413 });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function downloadGeojson(rawUrl) {
  let url = await assertSafeRemoteUrl(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/geo+json, application/json' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) {
        throw Object.assign(new Error('Harita URL’si çok fazla yönlendirme yaptı'), { status: 400 });
      }
      url = await assertSafeRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Harita URL’si HTTP ${response.status} döndürdü`), { status: 400 });
    }
    return { buffer: await readResponseWithLimit(response), finalUrl: url.toString() };
  }
  throw Object.assign(new Error('Harita indirilemedi'), { status: 400 });
}

async function saveVenueMap(venueId, buffer) {
  const key = venueObjectName(String(venueId));
  if (objectStore.isRemote()) {
    await objectStore.put(key, buffer, {
      contentType: 'application/geo+json',
      cacheControl: 'no-cache',
    });
    return key;
  }

  const target = localPathFor(key);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, buffer, { flag: 'wx' });
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
  return key;
}

async function readStoredVenueMap(storageKey) {
  const key = normalizeStorageKey(storageKey);
  if (objectStore.isRemote()) {
    const buffer = await objectStore.get(key);
    return buffer.toString('utf8');
  }

  return fs.readFile(localPathFor(key), 'utf8');
}

async function removeStoredVenueMap(storageKey) {
  if (!storageKey) return;
  let key;
  try {
    key = normalizeStorageKey(storageKey);
  } catch {
    return;
  }

  if (objectStore.isRemote()) {
    await objectStore.remove(key);
    return;
  }

  await fs.rm(localPathFor(key), { force: true });
}

function buildMapMetadata({ buffer, metadata, sourceType, sourceUrl = '', originalFileName = '', storageKey }) {
  return {
    sourceType,
    sourceUrl,
    originalFileName,
    storageKey,
    featureCount: metadata.featureCount,
    roomCount: metadata.roomCount,
    floors: metadata.floors,
    sizeBytes: buffer.length,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    updatedAt: new Date(),
  };
}

/**
 * Venue haritasını GeoJSON metni olarak çözer: önce yönetilen kaynak (GCS
 * ya da yerel storage), sonra harici URL. Harita tanımlı değilse null döner.
 */
async function resolveVenueGeojsonText(venue) {
  const storageKey = venue.geojson?.storageKey;
  if (storageKey) {
    return readStoredVenueMap(storageKey);
  }

  const geoPath = venue.geojsonPath;
  if (geoPath && /^https?:\/\//i.test(geoPath)) {
    const downloaded = await downloadGeojson(geoPath);
    const parsed = parseAndValidateGeojson(downloaded.buffer);
    return JSON.stringify(parsed.data);
  }

  return null;
}

module.exports = {
  MAX_GEOJSON_BYTES,
  venueMapStorageKey: (venueId) => venueObjectName(String(venueId)),
  parseAndValidateGeojson,
  downloadGeojson,
  saveVenueMap,
  readStoredVenueMap,
  removeStoredVenueMap,
  resolveVenueGeojsonText,
  buildMapMetadata,
  assertSafeRemoteUrl,
  isPrivateIp,
};
