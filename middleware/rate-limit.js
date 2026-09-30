/**
 * Basit IP tabanlı rate limit (in-memory).
 */

const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = '' } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.' });
    }

    return next();
  };
}

module.exports = { rateLimit };
