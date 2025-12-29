/**
 * ============================================
 * Device Model
 * ============================================
 */

const mongoose = require('mongoose');

// 6 haneli benzersiz sayı ID üretici
async function generateUniqueDisplayId() {
  const Device = mongoose.model('Device');
  let displayId;
  let attempts = 0;
  const maxAttempts = 100;
  
  while (attempts < maxAttempts) {
    // 100000-999999 arası 6 haneli rastgele sayı
    displayId = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Benzersizlik kontrolü
    const existing = await Device.findOne({ displayId });
    if (!existing) {
      return displayId;
    }
    attempts++;
  }
  
  // Fallback: timestamp tabanlı
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
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  displayId: {
    type: String,
    unique: true,
    sparse: true // null değerlere izin ver (eski kayıtlar için)
  },
  name: {
    type: String,
    default: '' // displayId ile otomatik doldurulacak
  },
  deviceInfo: {
    type: deviceInfoSchema,
    default: () => ({})
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
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for computed status based on lastSeen
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

// Update status before saving
deviceSchema.pre('save', function(next) {
  this.status = this.computedStatus;
  next();
});

// Static method to update lastSeen
deviceSchema.statics.updateLastSeen = async function(deviceId) {
  return this.findByIdAndUpdate(
    deviceId,
    { lastSeen: new Date() },
    { new: true }
  );
};

// Static method to find or create device by fingerprint
deviceSchema.statics.findOrCreateByFingerprint = async function(fingerprint, deviceInfo = {}) {
  // Önce mevcut cihazı bul (aktif veya pasif)
  let device = await this.findOne({ fingerprint });
  
  if (!device) {
    // 6 haneli benzersiz ID üret
    const displayId = await generateUniqueDisplayId();
    
    // Yeni cihaz oluştur
    device = await this.create({
      fingerprint,
      deviceInfo,
      displayId,
      name: displayId, // İsim olarak displayId'yi kullan
      isActive: true
    });
    console.log(`✅ New device registered: ${device._id} (displayId: ${displayId}, fingerprint: ${fingerprint})`);
  } else {
    // Mevcut cihazı güncelle
    console.log(`🔄 Existing device updated: ${device._id} (displayId: ${device.displayId}, fingerprint: ${fingerprint})`);
    
    // Eğer displayId yoksa (eski kayıt) oluştur
    if (!device.displayId) {
      const displayId = await generateUniqueDisplayId();
      device.displayId = displayId;
      if (!device.name || device.name.startsWith('Cihaz ')) {
        device.name = displayId;
      }
      console.log(`📛 Display ID atandı: ${displayId}`);
    }
    
    // deviceInfo'yu güvenli şekilde güncelle
    const existingInfo = device.deviceInfo ? device.deviceInfo.toObject() : {};
    device.deviceInfo = { ...existingInfo, ...deviceInfo };
    device.lastSeen = new Date();
    device.isActive = true; // Tekrar aktif yap (silinmişse)
    await device.save();
  }
  
  return device;
};

// Index for efficient queries
deviceSchema.index({ lastSeen: -1 });
deviceSchema.index({ status: 1 });
deviceSchema.index({ createdAt: -1 });
deviceSchema.index({ displayId: 1 });

const Device = mongoose.model('Device', deviceSchema);

module.exports = Device;

