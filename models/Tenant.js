const mongoose = require('mongoose');

/**
 * Tenant — müşteri/kuruluş. Venue'lar tenant'a atanır; tenant kullanıcıları
 * yalnızca kendi venue'larını görür ve yönetir.
 */
const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Tenant', tenantSchema);
