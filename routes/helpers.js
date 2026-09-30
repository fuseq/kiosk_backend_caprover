/**
 * Route yardımcıları — venue kapsamı ve landing page dönüşümleri.
 */

const mongoose = require('mongoose');
const Venue = require('../models/Venue');
const Device = require('../models/Device');
const { allowedVenueIds } = require('../middleware/access');

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') {
    return { enabled: false, startDate: null, endDate: null };
  }
  const startDate = toDateOrNull(schedule.startDate);
  const endDate = toDateOrNull(schedule.endDate);
  return {
    enabled: schedule.enabled === true || !!startDate || !!endDate,
    startDate,
    endDate
  };
}

function detectMediaType(url, explicit) {
  if (explicit === 'video' || explicit === 'image') return explicit;
  const u = String(url || '').split('?')[0].toLowerCase();
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(u)) return 'video';
  return 'image';
}

function mapSlides(slides, computeAspectRatio) {
  if (!Array.isArray(slides)) return [];
  return slides
    .filter(s => s && s.imageUrl && String(s.imageUrl).trim())
    .map((slide, index) => {
      const width = Number(slide.width) || 0;
      const height = Number(slide.height) || 0;
      const aspectRatio = slide.aspectRatio || computeAspectRatio(width, height) || '';
      const imageUrl = String(slide.imageUrl).trim();
      const mediaType = detectMediaType(imageUrl, slide.mediaType);
      let durationMs = null;
      if (slide.durationMs != null && slide.durationMs !== '') {
        const d = Number(slide.durationMs);
        if (Number.isFinite(d) && d >= 1000) durationMs = Math.min(600000, Math.round(d));
      }
      return {
        imageUrl,
        mediaType,
        durationMs,
        title: slide.title || '',
        description: slide.description || '',
        link: slide.link || '',
        aspectRatio,
        width,
        height,
        schedule: {
          startDate: toDateOrNull(slide.schedule?.startDate),
          endDate: toDateOrNull(slide.schedule?.endDate)
        },
        targetGroupIds: Array.isArray(slide.targetGroupIds) ? slide.targetGroupIds : [],
        order: index,
        isActive: slide.isActive !== false,
        mediaGroupId: slide.mediaGroupId ? String(slide.mediaGroupId) : '',
        mediaGroupTitle: slide.mediaGroupTitle ? String(slide.mediaGroupTitle) : '',
      };
    });
}

async function venueScopeFilter(user, venueIdParam, { feature } = {}) {
  const allowed = await allowedVenueIds(user, { feature });
  if (!allowed.length) return { _id: null };

  if (venueIdParam) {
    const vid = String(venueIdParam);
    if (allowed.includes(vid)) {
      return { venueId: new mongoose.Types.ObjectId(vid) };
    }
    // Geçersiz/yetkisiz venueId → boş sonuç yerine erişilebilir tüm venue'lara düş
  }

  return { venueId: { $in: allowed.map(id => new mongoose.Types.ObjectId(id)) } };
}

async function resolveVenueIdForWrite(user, bodyVenueId, { feature } = {}) {
  const allowed = await allowedVenueIds(user, { feature });
  if (!allowed.length) return { error: 'Erişilebilir venue yok', status: 403 };

  if (bodyVenueId) {
    const vid = String(bodyVenueId);
    if (!allowed.includes(vid)) return { error: 'Bu venue için yetkiniz yok', status: 403 };
    return { venueId: new mongoose.Types.ObjectId(vid) };
  }

  if (allowed.length === 1) {
    return { venueId: new mongoose.Types.ObjectId(allowed[0]) };
  }

  return { error: 'venueId gerekli', status: 400 };
}

async function resolveDefaultVenueObjectId() {
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

async function validateDevicesForVenue(venueId, deviceIds) {
  if (!deviceIds?.length) return { ok: true };
  const ids = [...new Set(deviceIds.map(String))];
  const devices = await Device.find({ _id: { $in: ids }, isActive: true }).select('_id venueId enrollmentStatus');
  if (devices.length !== ids.length) {
    return { ok: false, error: 'Geçersiz veya pasif cihaz kimliği' };
  }
  const vid = String(venueId);
  const foreign = devices.filter(d => !d.venueId || String(d.venueId) !== vid || d.enrollmentStatus !== 'active');
  if (foreign.length) {
    return { ok: false, error: 'Seçilen cihazlardan bazıları bu mekana ait değil veya etkin değil' };
  }
  return { ok: true };
}

async function validateGroupsForVenue(venueId, groupIds) {
  if (!groupIds?.length) return { ok: true };
  const DeviceGroup = require('../models/DeviceGroup');
  const ids = [...new Set(groupIds.map(String))];
  const groups = await DeviceGroup.find({ _id: { $in: ids }, isActive: true }).select('_id venueId');
  if (groups.length !== ids.length) {
    return { ok: false, error: 'Geçersiz veya pasif grup kimliği' };
  }
  const vid = String(venueId);
  const foreign = groups.filter(g => g.venueId && String(g.venueId) !== vid);
  if (foreign.length) {
    return { ok: false, error: 'Seçilen gruplardan bazıları bu mekana ait değil' };
  }
  return { ok: true };
}

module.exports = {
  toDateOrNull,
  normalizeSchedule,
  mapSlides,
  venueScopeFilter,
  resolveVenueIdForWrite,
  resolveDefaultVenueObjectId,
  validateDevicesForVenue,
  validateGroupsForVenue,
};
