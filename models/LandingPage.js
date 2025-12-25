/**
 * ============================================
 * Landing Page Model
 * ============================================
 */

const mongoose = require('mongoose');

const slideSchema = new mongoose.Schema({
  imageUrl: {
    type: String,
    required: true
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
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const landingPageSchema = new mongoose.Schema({
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
  slides: [slideSchema],
  transitionDuration: {
    type: Number,
    default: 8000,
    min: 1000,
    max: 60000
  },
  transitionEffect: {
    type: String,
    enum: ['fade', 'slide', 'zoom'],
    default: 'slide'
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

// Ensure only one default landing page
landingPageSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { isDefault: false }
    );
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

// Static method to get default landing page
landingPageSchema.statics.getDefault = async function() {
  let defaultPage = await this.findOne({ isDefault: true, isActive: true });
  
  if (!defaultPage) {
    // Return first active landing page
    defaultPage = await this.findOne({ isActive: true }).sort({ createdAt: 1 });
  }
  
  return defaultPage;
};

// Static method to get landing page for a device
landingPageSchema.statics.getForDevice = async function(deviceId) {
  // First, try to find a landing page assigned to this device
  let landingPage = await this.findOne({
    deviceIds: deviceId,
    isActive: true
  });
  
  // If not found, return default
  if (!landingPage) {
    landingPage = await this.getDefault();
  }
  
  return landingPage;
};

// Static method to assign devices to landing page
landingPageSchema.statics.assignDevices = async function(landingPageId, newDeviceIds) {
  console.log(`📋 Assigning devices to landing page ${landingPageId}:`, newDeviceIds);
  
  // Remove these devices from other landing pages
  await this.updateMany(
    { _id: { $ne: landingPageId } },
    { $pull: { deviceIds: { $in: newDeviceIds } } }
  );
  
  // Update this landing page with new deviceIds (replace all)
  const landingPage = await this.findByIdAndUpdate(
    landingPageId,
    { $set: { deviceIds: newDeviceIds } },
    { new: true }
  );
  
  console.log(`✅ Devices assigned. Total: ${landingPage?.deviceIds?.length || 0}`);
  
  return landingPage;
};

// Indexes
landingPageSchema.index({ isDefault: 1 });
landingPageSchema.index({ isActive: 1 });
landingPageSchema.index({ deviceIds: 1 });
landingPageSchema.index({ createdAt: -1 });

const LandingPage = mongoose.model('LandingPage', landingPageSchema);

module.exports = LandingPage;

