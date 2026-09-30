const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { TENANT_FEATURES, DEFAULT_TENANT_PERMISSIONS } = require('../constants/features');

/**
 * User — admin panel kullanıcıları.
 *   role: 'admin'  → tüm özelliklere sahip
 *   role: 'tenant' → memberships[] ile müşteri bazlı izinler
 *
 * Geriye dönük uyumluluk: eski tenantId + permissions alanları okunur;
 * yeni kayıtlar memberships üzerinden yönetilir.
 */
const membershipSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  permissions: {
    type: [{ type: String, enum: TENANT_FEATURES }],
    default: () => [...DEFAULT_TENANT_PERMISSIONS],
  },
  isActive: { type: Boolean, default: true },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
  name: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'tenant'], default: 'tenant' },
  /** @deprecated legacy — memberships kullanılır */
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
  /** @deprecated legacy — memberships[].permissions kullanılır */
  permissions: {
    type: [{ type: String, enum: TENANT_FEATURES }],
    default: () => [...DEFAULT_TENANT_PERMISSIONS],
  },
  memberships: { type: [membershipSchema], default: [] },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

userSchema.methods.checkPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10);
};

module.exports = mongoose.model('User', userSchema);
