/**
 * Merkezi erişim kontrolü: müşteri üyelikleri + özellik izinleri.
 *
 * Tenant kullanıcıları için izinler memberships üzerinden müşteri bazlıdır.
 * hasPermission(user, feature, { tenantId | venue }) ile kapsam belirtilir.
 * Kapsam yoksa union (herhangi bir üyelikte izin var mı) kullanılır — yalnızca
 * menü görünürlüğü için; veri erişiminde her zaman venue/tenant kapsamı gerekir.
 */

const Venue = require('../models/Venue');
const { FEATURES, normalizePermissions } = require('../constants/features');
const {
  resolveMemberships,
  membershipTenantIds,
  membershipForTenant,
  primaryMembership,
  idString,
} = require('../utils/memberships');

function isAdmin(user) {
  return user?.role === 'admin';
}

function effectivePermissions(user, scope = {}) {
  if (isAdmin(user)) {
    return Object.values(FEATURES);
  }

  const tenantId = idString(scope.tenantId || scope.venue?.tenantId);
  if (tenantId) {
    const membership = membershipForTenant(user, tenantId);
    return membership ? normalizePermissions(membership.permissions) : [];
  }

  // Kapsamsız: tüm üyeliklerin birleşimi (UI menü görünürlüğü)
  const all = new Set();
  for (const m of resolveMemberships(user)) {
    for (const p of m.permissions) all.add(p);
  }
  return [...all];
}

function hasPermission(user, feature, scope = {}) {
  if (isAdmin(user)) return true;
  return effectivePermissions(user, scope).includes(feature);
}

/**
 * Tenant kullanıcısı venue'ya erişebilir mi?
 * Admin her zaman evet.
 */
function canAccessVenue(user, venue) {
  if (!venue) return false;
  if (isAdmin(user)) return true;
  if (!venue.tenantId) return false;
  return !!membershipForTenant(user, venue.tenantId);
}

/**
 * Mongo filter: tenant yalnızca üye olduğu müşterilerin venue'larını görür.
 */
function venueFilterForUser(user) {
  if (isAdmin(user)) return { isActive: { $ne: false } };
  const tenantIds = membershipTenantIds(user);
  if (!tenantIds.length) return { _id: null };
  return {
    tenantId: { $in: tenantIds },
    isActive: { $ne: false },
  };
}

/**
 * venueId ile venue yükle ve erişim kontrolü yap.
 * feature verilirse o özellik için müşteri bazlı izin de kontrol edilir.
 * @returns {Promise<{ok:boolean, venue?:object, error?:string, status?:number}>}
 */
async function loadVenueForUser(user, venueIdOrSlug, { feature } = {}) {
  const idOrSlug = String(venueIdOrSlug || '').trim();
  if (!idOrSlug) return { ok: false, status: 400, error: 'Venue kimliği gerekli' };

  let venue;
  if (/^[a-f0-9]{24}$/i.test(idOrSlug)) {
    venue = await Venue.findById(idOrSlug);
  } else {
    venue = await Venue.findOne({ slug: idOrSlug.toLowerCase() });
  }
  if (!venue || venue.isActive === false) {
    return { ok: false, status: 404, error: 'Venue bulunamadı' };
  }
  if (!canAccessVenue(user, venue)) {
    return { ok: false, status: 403, error: 'Bu venue için yetkiniz yok' };
  }
  if (feature && !hasPermission(user, feature, { venue })) {
    return { ok: false, status: 403, error: 'Bu özellik için yetkiniz yok', feature };
  }
  return { ok: true, venue };
}

/**
 * venueId listesi: admin tüm venue'lar, tenant üye olduğu müşterilerin venue'ları.
 * feature verilirse yalnızca o izne sahip üyeliklerin venue'ları döner.
 */
async function allowedVenueIds(user, { feature } = {}) {
  if (isAdmin(user)) {
    const venues = await Venue.find({ isActive: { $ne: false } }).select('_id').lean();
    return venues.map(v => String(v._id));
  }

  let tenantIds = membershipTenantIds(user);
  if (feature) {
    tenantIds = resolveMemberships(user)
      .filter(m => m.permissions.includes(feature))
      .map(m => m.tenantId);
  }
  if (!tenantIds.length) return [];

  const venues = await Venue.find({
    tenantId: { $in: tenantIds },
    isActive: { $ne: false },
  }).select('_id').lean();
  return venues.map(v => String(v._id));
}

/**
 * Global özellik kontrolü (menü/route gate).
 * Veri erişiminde loadVenueForUser(..., { feature }) tercih edilmeli.
 */
function requirePermission(feature) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Oturum gerekli' });
    if (!hasPermission(req.user, feature)) {
      return res.status(403).json({ error: 'Bu özellik için yetkiniz yok', feature });
    }
    next();
  };
}

function attachAccessHelpers(req, _res, next) {
  req.access = {
    isAdmin: () => isAdmin(req.user),
    hasPermission: (f, scope) => hasPermission(req.user, f, scope),
    permissions: (scope) => effectivePermissions(req.user, scope),
    memberships: () => resolveMemberships(req.user),
  };
  next();
}

module.exports = {
  FEATURES,
  isAdmin,
  effectivePermissions,
  hasPermission,
  canAccessVenue,
  venueFilterForUser,
  loadVenueForUser,
  allowedVenueIds,
  requirePermission,
  attachAccessHelpers,
  resolveMemberships,
  membershipTenantIds,
  membershipForTenant,
  primaryMembership,
};
