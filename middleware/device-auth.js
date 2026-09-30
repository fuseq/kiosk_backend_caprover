const Device = require('../models/Device');
const { extractDeviceToken, verifyDeviceToken } = require('../utils/device-token');

async function loadDeviceByAuth(req, { deviceId } = {}) {
  const token = extractDeviceToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Cihaz kimlik doğrulaması gerekli' };
  }

  const id = deviceId || req.params.deviceId;
  if (!id) {
    return { ok: false, status: 400, error: 'Cihaz kimliği gerekli' };
  }

  const device = await Device.findById(id).select('+deviceTokenHash');
  if (!device || !device.isActive) {
    return { ok: false, status: 404, error: 'Cihaz bulunamadı' };
  }

  if (device.enrollmentStatus === 'revoked') {
    return { ok: false, status: 403, error: 'Cihaz erişimi iptal edildi', code: 'DEVICE_REVOKED' };
  }

  if (!device.deviceTokenHash || !verifyDeviceToken(token, device.deviceTokenHash)) {
    return { ok: false, status: 401, error: 'Geçersiz cihaz anahtarı' };
  }

  return { ok: true, device, token };
}

function requireDeviceAuth() {
  return async (req, res, next) => {
    try {
      const result = await loadDeviceByAuth(req);
      if (!result.ok) {
        return res.status(result.status).json({
          error: result.error,
          code: result.code || undefined,
        });
      }
      req.device = result.device;
      return next();
    } catch (err) {
      console.error('device-auth', err);
      return res.status(500).json({ error: 'Cihaz doğrulaması başarısız' });
    }
  };
}

module.exports = {
  loadDeviceByAuth,
  requireDeviceAuth,
};
