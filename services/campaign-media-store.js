/**
 * Kampanya medyası (görsel / video) — GCS veya yerel storage.
 * Path: campaign-media/{venueId}/{uuid}.{ext}
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const STORAGE_PREFIX = 'campaign-media';
const LOCAL_STORAGE_ROOT = path.join(__dirname, '..', 'storage');
const objectStore = require('./object-store');

const MEDIA_TYPES = [
  {
    mediaType: 'image',
    ext: 'png',
    contentType: 'image/png',
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mediaType: 'image',
    ext: 'jpg',
    contentType: 'image/jpeg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mediaType: 'image',
    ext: 'webp',
    contentType: 'image/webp',
    matches: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mediaType: 'video',
    ext: 'mp4',
    contentType: 'video/mp4',
    matches: (b) => {
      if (b.length < 12) return false;
      const box = b.subarray(4, 8).toString('ascii');
      return box === 'ftyp';
    },
  },
  {
    mediaType: 'video',
    ext: 'webm',
    contentType: 'video/webm',
    matches: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
];

function detectMediaType(buffer) {
  const found = MEDIA_TYPES.find((type) => type.matches(buffer));
  if (!found) {
    throw Object.assign(
      new Error('PNG, JPEG, WebP, MP4 veya WebM dosyası yükleyin'),
      { status: 400 },
    );
  }
  return found;
}

function assertSize(buffer, mediaType) {
  if (!buffer?.length) {
    throw Object.assign(new Error('Dosya boş'), { status: 400 });
  }
  const max = mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (buffer.length > max) {
    throw Object.assign(
      new Error(mediaType === 'video' ? 'Video en fazla 50 MB olabilir' : 'Görsel en fazla 15 MB olabilir'),
      { status: 413 },
    );
  }
}

function normalizeStorageKey(storageKey) {
  const key = String(storageKey || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^storage\//, '');
  if (!key || key.split('/').includes('..') || !key.startsWith(`${STORAGE_PREFIX}/`)) {
    throw Object.assign(new Error('Geçersiz medya depolama yolu'), { status: 400 });
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

function objectName(venueId, ext) {
  return `${STORAGE_PREFIX}/${String(venueId)}/${crypto.randomUUID()}.${ext}`;
}

/**
 * @returns {Promise<{storageKey:string, contentType:string, mediaType:string,
 *   sizeBytes:number, checksum:string, originalFileName:string, filename:string}>}
 */
async function saveCampaignMedia(venueId, buffer, originalFileName = '') {
  const detected = detectMediaType(buffer);
  assertSize(buffer, detected.mediaType);
  const key = objectName(venueId, detected.ext);
  if (objectStore.isRemote()) {
    await objectStore.put(key, buffer, {
      contentType: detected.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    });
  } else {
    const target = localPathFor(key);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, buffer, { flag: 'wx' });
    await fs.rename(temporary, target);
  }

  return {
    storageKey: key,
    contentType: detected.contentType,
    mediaType: detected.mediaType,
    sizeBytes: buffer.length,
    checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
    originalFileName: path.basename(String(originalFileName || '')).slice(0, 200),
    filename: path.basename(key),
  };
}

async function readCampaignMedia(storageKey) {
  const key = normalizeStorageKey(storageKey);
  if (objectStore.isRemote()) {
    return { buffer: await objectStore.get(key), key };
  }
  return { buffer: await fs.readFile(localPathFor(key)), key };
}

/** storageKey veya filename + venueId ile çözümle */
function resolveCampaignKey(venueId, filenameOrKey) {
  const raw = String(filenameOrKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw.startsWith(`${STORAGE_PREFIX}/`)) return normalizeStorageKey(raw);
  const safe = path.basename(raw);
  if (!safe || safe.includes('..')) {
    throw Object.assign(new Error('Geçersiz dosya adı'), { status: 400 });
  }
  return normalizeStorageKey(`${STORAGE_PREFIX}/${String(venueId)}/${safe}`);
}

function contentTypeForKey(key) {
  const ext = path.extname(key).toLowerCase().replace('.', '');
  const found = MEDIA_TYPES.find((t) => t.ext === ext);
  return found?.contentType || 'application/octet-stream';
}

module.exports = {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  STORAGE_PREFIX,
  saveCampaignMedia,
  readCampaignMedia,
  resolveCampaignKey,
  contentTypeForKey,
  detectMediaType,
};
