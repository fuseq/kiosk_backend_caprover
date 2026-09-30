/**
 * Mevcut kayıtlara venueId atar ve tenant kullanıcılarına varsayılan izin verir.
 */

const Venue = require('../models/Venue');
const LandingPage = require('../models/LandingPage');
const Device = require('../models/Device');
const DeviceGroup = require('../models/DeviceGroup');
const User = require('../models/User');
const { DEFAULT_TENANT_PERMISSIONS } = require('../constants/features');

async function resolveDefaultVenueId() {
  // Multi-tenant kurulumda sabit bir varsayılan slug yok; VENUE_SLUG yalnızca
  // tek venue'lü geliştirme ortamları için opsiyonel bir ipucu.
  const slug = (process.env.VENUE_SLUG || '').trim().toLowerCase();
  if (slug) {
    const venue = await Venue.findOne({ slug });
    if (venue) return venue._id;
  }
  const first = await Venue.findOne({ isActive: { $ne: false } }).sort({ createdAt: 1 });
  return first?._id || null;
}

async function backfillVenueIds(venueId) {
  if (!venueId) {
    console.warn('⚠️ Migration: venue bulunamadı, venueId backfill atlandı');
    return;
  }
  const vid = String(venueId);
  const [lp, grp] = await Promise.all([
    LandingPage.updateMany({ venueId: { $exists: false } }, { $set: { venueId } }),
    DeviceGroup.updateMany({ venueId: { $exists: false } }, { $set: { venueId } })
  ]);
  if (lp.modifiedCount || grp.modifiedCount) {
    console.log(`🔄 Migration: venueId=${vid} → landing=${lp.modifiedCount}, groups=${grp.modifiedCount}`);
  }
}

async function backfillDeviceEnrollment() {
  const active = await Device.updateMany(
    { venueId: { $ne: null }, enrollmentStatus: { $exists: false } },
    { $set: { enrollmentStatus: 'active' } }
  );
  const pending = await Device.updateMany(
    {
      $or: [{ venueId: null }, { venueId: { $exists: false } }],
      enrollmentStatus: { $exists: false }
    },
    { $set: { enrollmentStatus: 'pending' } }
  );
  if (active.modifiedCount || pending.modifiedCount) {
    console.log(`🔄 Migration: enrollmentStatus → active=${active.modifiedCount}, pending=${pending.modifiedCount}`);
  }
}

async function backfillUserPermissions() {
  const result = await User.updateMany(
    { role: 'tenant', $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }] },
    { $set: { permissions: [...DEFAULT_TENANT_PERMISSIONS] } }
  );
  if (result.modifiedCount) {
    console.log(`🔄 Migration: ${result.modifiedCount} tenant kullanıcısına varsayılan izinler atandı`);
  }
}

/**
 * Eski tek-tenantId kullanıcılarını memberships[] modeline taşır.
 */
async function backfillUserMemberships() {
  const users = await User.find({
    role: 'tenant',
    tenantId: { $ne: null },
    $or: [
      { memberships: { $exists: false } },
      { memberships: { $size: 0 } },
    ],
  });

  let migrated = 0;
  for (const user of users) {
    const permissions = Array.isArray(user.permissions) && user.permissions.length
      ? user.permissions
      : [...DEFAULT_TENANT_PERMISSIONS];
    user.memberships = [{
      tenantId: user.tenantId,
      permissions,
      isActive: true,
    }];
    await user.save();
    migrated += 1;
  }
  if (migrated) {
    console.log(`🔄 Migration: ${migrated} kullanıcı memberships modeline taşındı`);
  }
}

async function runMigrations() {
  const venueId = await resolveDefaultVenueId();
  await backfillVenueIds(venueId);
  await backfillDeviceEnrollment();
  await backfillUserPermissions();
  await backfillUserMemberships();
}

module.exports = { runMigrations, resolveDefaultVenueId };
