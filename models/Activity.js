/**
 * Panel aktivite kaydı — dashboard "Son aktiviteler" kaynağı.
 */

const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  type: { type: String, required: true, index: true },
  icon: { type: String, default: 'pulse' },
  tone: { type: String, default: 'blue' },
  text: { type: String, required: true },
  venueId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Venue',
    default: null,
    index: true,
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    default: null,
    index: true,
  },
  actorId: { type: String, default: null },
  actorEmail: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

activitySchema.index({ createdAt: -1 });
activitySchema.index({ venueId: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);
