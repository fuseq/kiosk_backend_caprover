/**
 * Tenant kullanıcıları için özellik bayrakları.
 * Admin rolü tüm özelliklere sahiptir (bu liste kontrol edilmez).
 */

const FEATURES = Object.freeze({
  UNIT_ADS: 'unit_ads',
  LANDING_CAMPAIGNS: 'landing_campaigns',
  VENUE_MANAGER: 'venue_manager',
  DEVICES: 'devices',
});

/** Tenant kullanıcısı oluştururken seçilebilir özellikler. */
const TENANT_FEATURES = Object.freeze([
  FEATURES.UNIT_ADS,
  FEATURES.LANDING_CAMPAIGNS,
  FEATURES.VENUE_MANAGER,
  FEATURES.DEVICES,
]);

const FEATURE_LABELS = Object.freeze({
  [FEATURES.UNIT_ADS]: 'Birim reklamları',
  [FEATURES.LANDING_CAMPAIGNS]: 'Kiosk kampanyaları (slider)',
  [FEATURES.VENUE_MANAGER]: 'Birim yönetimi (harita)',
  [FEATURES.DEVICES]: 'Cihaz ve grup yönetimi',
});

/** Yeni tenant kullanıcıları için varsayılan izinler (geriye dönük uyum). */
const DEFAULT_TENANT_PERMISSIONS = Object.freeze([FEATURES.UNIT_ADS]);

function isValidFeature(key) {
  return TENANT_FEATURES.includes(key);
}

function normalizePermissions(list) {
  if (!Array.isArray(list)) return [...DEFAULT_TENANT_PERMISSIONS];
  const out = [...new Set(list.filter(isValidFeature))];
  return out.length ? out : [...DEFAULT_TENANT_PERMISSIONS];
}

module.exports = {
  FEATURES,
  TENANT_FEATURES,
  FEATURE_LABELS,
  DEFAULT_TENANT_PERMISSIONS,
  isValidFeature,
  normalizePermissions,
};
