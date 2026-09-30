/**
 * Kullanıcı–müşteri üyelik yardımcıları.
 * Legacy User.tenantId + permissions → memberships dönüşümü desteklenir.
 */

const { normalizePermissions } = require('../constants/features');

function idString(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value._id != null) return String(value._id);
  return String(value);
}

/**
 * Kullanıcının aktif üyeliklerini döner.
 * memberships boşsa legacy tenantId alanından sentetik üyelik üretir.
 */
function resolveMemberships(user) {
  if (!user || user.role === 'admin') return [];

  const raw = Array.isArray(user.memberships) ? user.memberships : [];
  const fromMemberships = raw
    .filter(m => m && m.isActive !== false && m.tenantId)
    .map(m => ({
      tenantId: idString(m.tenantId),
      permissions: normalizePermissions(m.permissions),
      isActive: true,
    }));

  if (fromMemberships.length) {
    const seen = new Set();
    return fromMemberships.filter(m => {
      if (seen.has(m.tenantId)) return false;
      seen.add(m.tenantId);
      return true;
    });
  }

  const legacyTenantId = idString(user.tenantId);
  if (!legacyTenantId) return [];
  return [{
    tenantId: legacyTenantId,
    permissions: normalizePermissions(user.permissions),
    isActive: true,
  }];
}

function membershipTenantIds(user) {
  return resolveMemberships(user).map(m => m.tenantId);
}

function membershipForTenant(user, tenantId) {
  const tid = idString(tenantId);
  if (!tid) return null;
  return resolveMemberships(user).find(m => m.tenantId === tid) || null;
}

function primaryMembership(user) {
  const list = resolveMemberships(user);
  return list[0] || null;
}

/**
 * İstemciden gelen üyelik listesini doğrular ve normalize eder.
 * @returns {{ ok:true, memberships:object[] } | { ok:false, error:string }}
 */
function validateMembershipsInput(input) {
  if (!Array.isArray(input) || !input.length) {
    return { ok: false, error: 'En az bir müşteri üyeliği gerekli' };
  }
  if (input.length > 50) {
    return { ok: false, error: 'En fazla 50 müşteri üyeliği tanımlanabilir' };
  }

  const seen = new Set();
  const memberships = [];
  for (const item of input) {
    const tenantId = idString(item?.tenantId);
    if (!/^[a-f0-9]{24}$/i.test(tenantId)) {
      return { ok: false, error: 'Geçersiz müşteri kimliği' };
    }
    if (seen.has(tenantId)) {
      return { ok: false, error: 'Aynı müşteri birden fazla eklenemez' };
    }
    seen.add(tenantId);
    memberships.push({
      tenantId,
      permissions: normalizePermissions(item?.permissions),
      isActive: item?.isActive !== false,
    });
  }
  return { ok: true, memberships };
}

/**
 * Kullanıcı belgesine üyelikleri yazar ve legacy alanları senkronlar.
 */
function applyMembershipsToUser(user, memberships) {
  user.memberships = memberships.map(m => ({
    tenantId: m.tenantId,
    permissions: normalizePermissions(m.permissions),
    isActive: m.isActive !== false,
  }));
  const primary = user.memberships[0] || null;
  user.tenantId = primary ? primary.tenantId : null;
  user.permissions = primary ? [...primary.permissions] : [];
  return user;
}

module.exports = {
  idString,
  resolveMemberships,
  membershipTenantIds,
  membershipForTenant,
  primaryMembership,
  validateMembershipsInput,
  applyMembershipsToUser,
};
