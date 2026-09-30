/**
 * Venue harita / medya deposu.
 *
 * STORAGE_DRIVER:
 *   s3    — AWS S3 (VENUE_ASSETS_BUCKET + AWS_REGION)
 *   gcs   — Google Cloud Storage (varsayılan, bucket tanımlıysa)
 *   local — disk (bucket yoksa)
 *
 * GCP canlısı STORAGE_DRIVER set edilmeden eskisi gibi GCS kullanır.
 */

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const BUCKET_NAME = (process.env.VENUE_ASSETS_BUCKET || '').trim();
const LOCAL_STORAGE_ROOT = path.join(__dirname, '..', 'storage');

function storageDriver() {
  const explicit = String(process.env.STORAGE_DRIVER || '').trim().toLowerCase();
  if (explicit === 's3' || explicit === 'gcs' || explicit === 'local') return explicit;
  if (BUCKET_NAME) return 'gcs';
  return 'local';
}

function isRemote() {
  const driver = storageDriver();
  return (driver === 's3' || driver === 'gcs') && Boolean(BUCKET_NAME);
}

function localPathFor(key) {
  const root = path.resolve(LOCAL_STORAGE_ROOT);
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('Geçersiz depolama yolu'), { status: 500 });
  }
  return target;
}

let cachedGcsBucket;
function gcsBucket() {
  if (!BUCKET_NAME) return null;
  if (!cachedGcsBucket) {
    const { Storage } = require('@google-cloud/storage');
    cachedGcsBucket = new Storage().bucket(BUCKET_NAME);
  }
  return cachedGcsBucket;
}

let cachedS3;
function s3Client() {
  if (!cachedS3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    cachedS3 = new S3Client({
      region: (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'eu-central-1').trim(),
    });
  }
  return cachedS3;
}

async function put(key, buffer, { contentType, cacheControl } = {}) {
  const driver = storageDriver();
  if (driver === 's3' && BUCKET_NAME) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client().send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      CacheControl: cacheControl,
    }));
    return;
  }
  if (driver === 'gcs' && BUCKET_NAME) {
    await gcsBucket().file(key).save(buffer, {
      contentType: contentType || 'application/octet-stream',
      resumable: false,
      metadata: cacheControl ? { cacheControl } : undefined,
    });
    return;
  }
  const target = localPathFor(key);
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, buffer, { flag: 'wx' });
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
}

async function get(key) {
  const driver = storageDriver();
  if (driver === 's3' && BUCKET_NAME) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await s3Client().send(new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return Buffer.from(await res.Body.transformToByteArray());
  }
  if (driver === 'gcs' && BUCKET_NAME) {
    const [buffer] = await gcsBucket().file(key).download();
    return buffer;
  }
  return fs.readFile(localPathFor(key));
}

async function remove(key) {
  const driver = storageDriver();
  if (driver === 's3' && BUCKET_NAME) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client().send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    return;
  }
  if (driver === 'gcs' && BUCKET_NAME) {
    await gcsBucket().file(key).delete({ ignoreNotFound: true });
    return;
  }
  await fs.rm(localPathFor(key), { force: true });
}

module.exports = {
  storageDriver,
  isRemote,
  put,
  get,
  remove,
};
