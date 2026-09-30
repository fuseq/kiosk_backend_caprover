/**
 * ============================================
 * Landing Page Model
 * ============================================
 */

const mongoose = require('mongoose');

const slideSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: [true, 'Image URL is required'],
    trim: true
  },
  /** 'image' | 'video' — imageUrl alanı her iki medya için de kaynak URL taşır. */
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image',
  },
  /**
   * Slide süresi (ms). Video için metadata veya panelden;
   * boşsa kampanya transitionDuration kullanılır.
   */
  durationMs: {
    type: Number,
    default: null,
    min: 1000,
    max: 600000,
  },
  title: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  link: {
    type: String,
    default: ''
  },
  // En-boy oranı (örn. "16:9") ve kaynak boyutları. URL eklenirken admin
  // panelde tarayıcı tarafından otomatik tespit edilip kaydedilir. Cihazın
  // ekran oranıyla eşleştirme için kullanılır.
  aspectRatio: {
    type: String,
    default: ''
  },
  width: {
    type: Number,
    default: 0
  },
  height: {
    type: Number,
    default: 0
  },
  // Görsel bazlı zamanlama (opsiyonel). Boşsa kampanya zamanlaması geçerli.
  schedule: {
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null }
  },
  // Görsel bazlı manuel hedefleme: yalnızca bu cihaz gruplarında oynat.
  // Boş dizi = kampanyanın tüm hedeflerinde (oran eşleşmesine göre) oynat.
  targetGroupIds: [{
    type: String
  }],
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  /** Toplu yükleme grubu — panel accordion'u için; oynatma yok sayar */
  mediaGroupId: {
    type: String,
    default: ''
  },
  mediaGroupTitle: {
    type: String,
    default: ''
  }
}, { 
  timestamps: true,
  _id: true // Mongoose otomatik _id oluşturur
});

const landingPageSchema = new mongoose.Schema({
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
  // Device ID'leri (String UUID formatında)
  deviceIds: [{
    type: String
  }],
  // Hedeflenen cihaz grupları (DeviceGroup._id)
  groupIds: [{
    type: String
  }],
  slides: [slideSchema],
  transitionDuration: {
    type: Number,
    default: 8000,
    min: 1000,
    max: 60000
  },
  /**
   * Clock-based multi-device sync. When enabled, kiosks seek playlist position
   * from (now - epoch) % totalDuration instead of a local setInterval loop.
   */
  sync: {
    enabled: { type: Boolean, default: false },
    epochMode: {
      type: String,
      enum: ['midnight', 'campaignStart', 'absolute'],
      default: 'midnight',
    },
    epochAt: { type: Date, default: null },
    tickMs: { type: Number, default: 250, min: 100, max: 2000 },
  },
  transitionEffect: {
    type: String,
    enum: ['fade', 'slide', 'zoom'],
    default: 'slide'
  },
  // Kiosk landing chrome (bağımsız):
  showNavbar: {
    type: Boolean,
    default: true
  },
  showSidePanel: {
    type: Boolean,
    default: true
  },
  // Legacy özet: ikisi de kapalı → 'fullscreen', aksi halde 'panel'
  displayMode: {
    type: String,
    enum: ['panel', 'fullscreen'],
    default: 'panel'
  },
  /** Medya contain olduğunda kalan bar rengi */
  letterboxColor: {
    type: String,
    enum: ['black', 'white'],
    default: 'black'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  schedule: {
    enabled: { type: Boolean, default: false },
    startDate: { type: Date },
    endDate: { type: Date },
    startTime: { type: String }, // "09:00"
    endTime: { type: String }    // "21:00"
  },
  styling: {
    backgroundColor: { type: String, default: '#000000' },
    overlayOpacity: { type: Number, default: 0, min: 0, max: 1 }
  },
  tags: [{
    type: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for device count
landingPageSchema.virtual('deviceCount').get(function() {
  return this.deviceIds ? this.deviceIds.length : 0;
});

// Virtual for slide count
landingPageSchema.virtual('slideCount').get(function() {
  return this.slides ? this.slides.filter(s => s.isActive).length : 0;
});

// Ensure only one default landing page per venue
landingPageSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    const filter = { _id: { $ne: this._id }, isDefault: true };
    if (this.venueId) filter.venueId = this.venueId;
    await this.constructor.updateMany(filter, { isDefault: false });
  }
  next();
});

// Sort slides by order before saving
landingPageSchema.pre('save', function(next) {
  if (this.slides && this.slides.length > 0) {
    this.slides.sort((a, b) => a.order - b.order);
    // Re-index orders
    this.slides.forEach((slide, index) => {
      slide.order = index;
    });
  }
  next();
});

// Static method to get default landing page for a venue
landingPageSchema.statics.getDefault = async function(venueId = null) {
  const filter = { isDefault: true, isActive: true };
  if (venueId) filter.venueId = venueId;
  let defaultPage = await this.findOne(filter);

  if (!defaultPage) {
    const fallbackFilter = { isActive: true };
    if (venueId) fallbackFilter.venueId = venueId;
    defaultPage = await this.findOne(fallbackFilter).sort({ createdAt: 1 });
  }

  return defaultPage;
};

// Static method to get landing page for a device (venue-scoped)
landingPageSchema.statics.getForDevice = async function(deviceId, venueId = null) {
  const filter = { deviceIds: deviceId, isActive: true };
  if (venueId) filter.venueId = venueId;
  let landingPage = await this.findOne(filter);

  if (!landingPage) {
    landingPage = await this.getDefault(venueId);
  }

  return landingPage;
};

// Static method to assign devices to landing page (same venue only)
landingPageSchema.statics.assignDevices = async function(landingPageId, newDeviceIds, venueId = null) {
  console.log(`📋 Assigning devices to landing page ${landingPageId}:`, newDeviceIds);

  const pullFilter = { _id: { $ne: landingPageId } };
  if (venueId) pullFilter.venueId = venueId;
  await this.updateMany(
    pullFilter,
    { $pull: { deviceIds: { $in: newDeviceIds } } }
  );

  const landingPage = await this.findByIdAndUpdate(
    landingPageId,
    { $set: { deviceIds: newDeviceIds } },
    { new: true }
  );

  console.log(`✅ Devices assigned. Total: ${landingPage?.deviceIds?.length || 0}`);

  return landingPage;
};

// Indexes
landingPageSchema.index({ venueId: 1, isDefault: 1 });
landingPageSchema.index({ isDefault: 1 });
landingPageSchema.index({ isActive: 1 });
landingPageSchema.index({ deviceIds: 1 });
landingPageSchema.index({ groupIds: 1 });
landingPageSchema.index({ createdAt: -1 });

const LandingPage = mongoose.model('LandingPage', landingPageSchema);

module.exports = LandingPage;

