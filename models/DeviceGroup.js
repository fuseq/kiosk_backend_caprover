/**
 * ============================================
 * Device Group Model
 * ============================================
 * Cihazları mantıksal gruplara ayırır (örn. "Zemin Kat", "Giriş Kioskları").
 * Kampanyalar ve görsel-bazlı hedefleme bu gruplara yapılabilir.
 */

const mongoose = require('mongoose');

const deviceGroupSchema = new mongoose.Schema({
  venueId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Venue',
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  /** Gruba uygulanan içerik yerleşimi; kayıtta üye cihazlara yazılır. Boş = henüz uygulanmadı. */
  contentAlign: {
    type: String,
    enum: ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
  },
  /** Gruba uygulanan kiosk ekran düzeni; kayıtta üye cihazlara yazılır. */
  kioskShellMode: {
    type: String,
    enum: ['both', 'landing', 'map'],
  },
  // Gruba üye cihaz ID'leri (Device._id String formatında)
  deviceIds: [{
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

// Virtual: cihaz sayısı
deviceGroupSchema.virtual('deviceCount').get(function() {
  return this.deviceIds ? this.deviceIds.length : 0;
});

deviceGroupSchema.index({ isActive: 1 });
deviceGroupSchema.index({ deviceIds: 1 });
deviceGroupSchema.index({ createdAt: -1 });

const DeviceGroup = mongoose.model('DeviceGroup', deviceGroupSchema);

module.exports = DeviceGroup;
