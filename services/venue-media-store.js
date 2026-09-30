/**
 * Venue'ya ait görsel varlıklar (şimdilik marka logosu).
 *
 * Neden gerekli: kiosk derlemesindeki config `branding.logo: 'assets/logo.png'`
 * gibi göreli bir yol taşıyor, yani logo imajın içine gömülü. Çok kiracılı
 * kurulumda bu, her yeni venue için yeniden derleme demek. Logo buraya
 * yüklendiğinde runtime-config `branding.logo`'yu mutlak bir adresle ezer ve
 * imaj venue'dan bağımsız kalır.
 *
 * Depolama, venue-map-store ile aynı ikili modeli izler: VENUE_ASSETS_BUCKET
 * tanımlıysa GCS objesi, değilse storage/ altında yerel dosya (geliştirme).
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const STORAGE_PREFIX = 'venue-media';
const LOCAL_STORAGE_ROOT = path.join(__dirname, '..', 'storage');
const objectStore = require('./object-store');

/**
 * İzin verilen biçimler imza baytlarından tanınır; dosya adı ve tarayıcının
 * bildirdiği content-type doğrulama için kullanılmaz, ikisi de istemciden gelir.
 *
 * SVG bilinçli olarak dışarıda: içine script gömülebiliyor ve dosyayı kendi
 * origin'imizden servis ettiğimiz için adrese doğrudan gidildiğinde bu depolanmış
 * XSS'e dönüşür. Logolar arayüzde küçük boyutlarda raster olarak çiziliyor.
 */
const IMAGE_TYPES = [
  { ext: 'png', contentType: 'image/png', matches: b => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', contentType: 'image/jpeg', matches: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', contentType: 'image/webp', matches: b => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** @returns {{ext: string, contentType: string}} */
function detectImageType(buffer) {
  const found = IMAGE_TYPES.find(type => type.matches(buffer));
  if (!found) {
    throw Object.assign(
      new Error('Logo için PNG, JPEG veya WebP dosyası yükleyin'),
      { status: 400 },
    );
  }
  return { ext: found.ext, contentType: found.contentType };
}

function assertWithinSizeLimit(buffer) {
  if (!buffer?.length) {
    throw Object.assign(new Error('Logo dosyası boş'), { status: 400 });
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    throw Object.assign(new Error('Logo en fazla 2 MB olabilir'), { status: 413 });
  }
}

function logoObjectName(venueId, ext) {
  return `${STORAGE_PREFIX}/${venueId}/logo.${ext}`;
}

function normalizeStorageKey(storageKey) {
  const key = String(storageKey || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^storage\//, '');
  if (!key || key.split('/').includes('..')) {
    throw Object.assign(new Error('Geçersiz medya depolama yolu'), { status: 500 });
  }
  return key;
}

function localPathFor(key) {
  const root = path.resolve(LOCAL_STORAGE_ROOT);
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('Geçersiz medya depolama yolu'), { status: 500 });
  }
  return target;
}

/**
 * Logoyu doğrular ve saklar.
 *
 * @returns {Promise<{storageKey:string, contentType:string, sizeBytes:number,
 *   checksum:string, originalFileName:string, updatedAt:Date}>}
 */
async function saveVenueLogo(venueId, buffer, originalFileName = '') {
  assertWithinSizeLimit(buffer);
  const { ext, contentType } = detectImageType(buffer);
  const key = logoObjectName(String(venueId), ext);
  if (objectStore.isRemote()) {
    await objectStore.put(key, buffer, {
      contentType,
      cacheControl: 'no-cache',
    });
  } else {
    const target = localPathFor(key);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
  }

  return {
    storageKey: key,
    contentType,
    sizeBytes: buffer.length,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    originalFileName: path.basename(String(originalFileName || '')).slice(0, 200),
    updatedAt: new Date(),
  };
}

/** @returns {Promise<Buffer>} */
async function readStoredVenueMedia(storageKey) {
  const key = normalizeStorageKey(storageKey);
  if (objectStore.isRemote()) {
    return objectStore.get(key);
  }

  return fs.readFile(localPathFor(key));
}

async function removeStoredVenueMedia(storageKey) {
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

module.exports = {
  MAX_LOGO_BYTES,
  detectImageType,
  saveVenueLogo,
  readStoredVenueMedia,
  removeStoredVenueMedia,
};
