/**
 * ============================================
 * Device Model
 * ============================================
 */

const mongoose = require('mongoose');

const deviceInfoSchema = new mongoose.Schema({
  userAgent: { type: String, default: '' },
  screenResolution: { type: String, default: '' },
  language: { type: String, default: '' },
  platform: { type: String, default: '' },
  timezone: { type: String, default: '' }
}, { _id: false });

const deviceSchema = new mongoose.Schema({
  fingerprint: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    default: function() {
      return `Cihaz ${Date.now().toString(36).toUpperCase()}`;
    }
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
  let device = await this.findOne({ fingerprint });
  
  if (!device) {
    device = await this.create({
      fingerprint,
      deviceInfo
    });
    console.log(`✅ New device registered: ${device._id}`);
  } else {
    // Update device info and lastSeen
    device.deviceInfo = { ...device.deviceInfo.toObject(), ...deviceInfo };
    device.lastSeen = new Date();
    await device.save();
  }
  
  return device;
};

// Index for efficient queries
deviceSchema.index({ lastSeen: -1 });
deviceSchema.index({ status: 1 });
deviceSchema.index({ createdAt: -1 });

const Device = mongoose.model('Device', deviceSchema);

module.exports = Device;

