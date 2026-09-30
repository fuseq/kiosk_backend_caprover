/**
 * ============================================
 * Device Model
 * ============================================
 */

const mongoose = require('mongoose');
const { aspectFromResolution } = require('../utils/aspect');
const { hashDeviceToken, verifyDeviceToken } = require('../utils/device-token');

// 6 haneli benzersiz sayı ID üretici
async function generateUniqueDisplayId() {
  const Device = mongoose.model('Device');
  let displayId;
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    displayId = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await Device.findOne({ displayId });
    if (!existing) return displayId;
    attempts++;
  }

  return Date.now().toString().slice(-6);
}

const deviceInfoSchema = new mongoose.Schema({
  userAgent: { type: String, default: '' },
  screenResolution: { type: String, default: '' },
  language: { type: String, default: '' },
  platform: { type: String, default: '' },
  timezone: { type: String, default: '' }
}, { _id: false });

const deviceSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString()
  },
  venueId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Venue',
    index: true,
    default: null
  },
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  displayId: {
    type: String,
    unique: true,
    sparse: true
  },
  name: {
    type: String,
    default: ''
  },
  deviceInfo: {
    type: deviceInfoSchema,
    default: () => ({})
  },
  aspectRatio: {
    type: String,
    default: ''
  },
  /** Medyanın fiziksel ekrandaki yerleşimi (letterbox köşesi) */
  contentAlign: {
    type: String,
    enum: ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
    default: 'center'
  },
  /**
   * Kiosk kabuğunun ekran düzeni. Dokunmatiklik cihazın özelliği olduğu için
   * mekân editöründe değil, cihaz kaydında durur.
   *   both    — reklam + harita
   *   landing — yalnızca reklam (dokunmatik olmayan ekran)
   *   map     — yalnızca harita (dokunmatik kiosk)
   */
  kioskShellMode: {
    type: String,
    enum: ['both', 'landing', 'map'],
    default: 'both'
  },
  enrollmentStatus: {
    type: String,
    enum: ['pending', 'active', 'revoked'],
    default: 'pending',
    index: true
  },
  deviceTokenHash: {
    type: String,
    default: null,
    select: false
  },
  enrolledAt: {
    type: Date,
    default: null
  },
  revokedAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['online', 'idle', 'offline'],
    default: 'offline'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String,
    default: ''
  },
  location: {
    floor: { type: String, default: '' },
    zone: { type: String, default: '' },
    description: { type: String, default: '' }
  },
  tags: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  /** Son kampanya pozisyon telemetrisi (sync deneyi) */
  lastPlayback: {
    type: new mongoose.Schema({
      landingPageId: { type: String, default: null },
      playlistSignature: { type: String, default: '' },
      syncEnabled: { type: Boolean, default: false },
      epochAt: { type: String, default: null },
      index: { type: Number, default: null },
      offsetMs: { type: Number, default: null },
      totalMs: { type: Number, default: null },
      elapsedMs: { type: Number, default: null },
      videoCurrentSec: { type: Number, default: null },
      clockOffsetMs: { type: Number, default: null },
      mediaType: { type: String, default: 'image' },
      slideId: { type: String, default: null },
      clientReportedAt: { type: String, default: null },
      receivedAt: { type: Date, default: null },
    }, { _id: false }),
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

deviceSchema.virtual('computedStatus').get(function() {
  const now = Date.now();
  const lastSeenTime = new Date(this.lastSeen).getTime();
  const diff = now - lastSeenTime;

  const fiveMinutes = 5 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;

  if (diff < fiveMinutes) return 'online';
  if (diff < oneHour) return 'idle';
  return 'offline';
});

deviceSchema.pre('save', function(next) {
  this.status = this.computedStatus;
  // Boş aspectRatio = otomatik (çözünürlükten); doluysa manuel override korunur
  if (!this.aspectRatio) {
    const res = this.deviceInfo && this.deviceInfo.screenResolution;
    if (res) {
      const ar = aspectFromResolution(res);
      if (ar) this.aspectRatio = ar;
    }
  }
  next();
});

deviceSchema.statics.updateLastSeen = async function(deviceId) {
  return this.findByIdAndUpdate(
    deviceId,
    { lastSeen: new Date() },
    { new: true }
  );
};

function mergeDeviceInfo(existingInfo, incomingInfo = {}) {
  const base = existingInfo && typeof existingInfo.toObject === 'function'
    ? existingInfo.toObject()
    : (existingInfo || {});
  return { ...base, ...incomingInfo };
}

function publicDevicePayload(device) {
  return {
    id: device._id,
    displayId: device.displayId,
    name: device.name,
    aspectRatio: device.aspectRatio || aspectFromResolution(device.deviceInfo?.screenResolution) || '',
    enrollmentStatus: device.enrollmentStatus,
    venueId: device.venueId ? String(device.venueId) : null,
    lastSeen: device.lastSeen,
    deviceInfo: device.deviceInfo,
    status: device.computedStatus,
  };
}

/**
 * Güvenli kiosk kaydı / heartbeat.
 * Yeni cihazlar venue'suz pending olarak oluşturulur.
 */
deviceSchema.statics.registerSecure = async function({
  fingerprint,
  deviceInfo = {},
  deviceToken,
  ipAddress = '',
}) {
  if (!fingerprint || !deviceToken) {
    const err = new Error('Fingerprint ve cihaz anahtarı gerekli');
    err.status = 400;
    throw err;
  }

  const tokenHash = hashDeviceToken(deviceToken);
  let device = await this.findOne({ fingerprint }).select('+deviceTokenHash');

  if (device) {
    if (!device.isActive) {
      // Önceki sürümde "sil" soft-delete yapıyordu. Anahtarı olmayan bu
      // legacy kayıtlar yeni güvenli pending kaydın oluşmasını engellememeli.
      if (!device.deviceTokenHash) {
        await this.deleteOne({ _id: device._id });
        device = null;
      } else {
        const err = new Error('Cihaz devre dışı');
        err.status = 403;
        err.code = 'DEVICE_DISABLED';
        throw err;
      }
    }

    if (device?.enrollmentStatus === 'revoked') {
      const err = new Error('Cihaz erişimi iptal edildi');
      err.status = 403;
      err.code = 'DEVICE_REVOKED';
      throw err;
    } else if (device && !verifyDeviceToken(deviceToken, device.deviceTokenHash)) {
      const err = new Error('Geçersiz cihaz anahtarı');
      err.status = 401;
      throw err;
    }

    if (device && !device.displayId) {
      const displayId = await generateUniqueDisplayId();
      device.displayId = displayId;
      if (!device.name || device.name.startsWith('Cihaz ')) {
        device.name = displayId;
      }
    }

    if (device) {
      device.deviceInfo = mergeDeviceInfo(device.deviceInfo, deviceInfo);
      device.lastSeen = new Date();
      if (ipAddress) device.ipAddress = ipAddress;
      await device.save();
      return device;
    }
  }

  const displayId = await generateUniqueDisplayId();
  device = await this.create({
    fingerprint,
    deviceInfo,
    displayId,
    name: displayId,
    isActive: true,
    enrollmentStatus: 'pending',
    venueId: null,
    deviceTokenHash: tokenHash,
    ipAddress,
  });

  return device;
};

deviceSchema.statics.publicDevicePayload = publicDevicePayload;

deviceSchema.index({ lastSeen: -1 });
deviceSchema.index({ status: 1 });
deviceSchema.index({ createdAt: -1 });
deviceSchema.index({ enrollmentStatus: 1, isActive: 1 });

const Device = mongoose.model('Device', deviceSchema);

module.exports = Device;
