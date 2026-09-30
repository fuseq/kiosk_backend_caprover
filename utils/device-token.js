const crypto = require('crypto');

const TOKEN_BYTES = 32;

function generateDeviceToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function verifyDeviceToken(token, storedHash) {
  if (!token || !storedHash) return false;
  const incoming = hashDeviceToken(token);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(incoming, 'hex'),
      Buffer.from(String(storedHash), 'hex')
    );
  } catch {
    return false;
  }
}

function extractDeviceToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Device ')) {
    return auth.slice(7).trim();
  }
  if (req.body?.deviceToken) {
    return String(req.body.deviceToken).trim();
  }
  return '';
}

module.exports = {
  generateDeviceToken,
  hashDeviceToken,
  verifyDeviceToken,
  extractDeviceToken,
};
