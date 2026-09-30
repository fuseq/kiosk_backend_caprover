const express = require('express');
const mongoose = require('mongoose');
const Device = require('../models/Device');
const Venue = require('../models/Venue');
const LandingPage = require('../models/LandingPage');
const DeviceGroup = require('../models/DeviceGroup');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, FEATURES, allowedVenueIds, isAdmin } = require('../middleware/access');
const { requireDeviceAuth } = require('../middleware/device-auth');
const { rateLimit } = require('../middleware/rate-limit');
const { extractDeviceToken } = require('../utils/device-token');
const { aspectFromResolution } = require('../utils/aspect');
const { landingChromePayload } = require('../utils/landing-chrome');
const { venueScopeFilter } = require('./helpers');
const { logActivity } = require('../services/activity-log');
const { mapSyncSlides, buildSyncPayload } = require('../utils/landing-sync');
const { venueContentSignature } = require('../utils/venue-content-signature');
const playbackTelemetry = require('../services/playback-telemetry');

const router = express.Router();

const registerRateLimit = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'device-register' });
const configRateLimit = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'device-config' });
const playbackRateLimit = rateLimit({ windowMs: 60_000, max: 180, keyPrefix: 'device-playback' });

function clientIp(req) {
  return req.ip || req.connection?.remoteAddress || '';
}

const CONTENT_ALIGN = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const KIOSK_SHELL_MODES = ['both', 'landing', 'map'];

function normalizeContentAlign(value) {
  const next = String(value || 'center').trim();
  return CONTENT_ALIGN.includes(next) ? next : 'center';
}

function normalizeKioskShellMode(value) {
  const next = String(value || 'both').trim().toLowerCase();
  return KIOSK_SHELL_MODES.includes(next) ? next : 'both';
}

function buildDeviceInfo(device) {
  return {
    id: device._id,
    displayId: device.displayId,
    name: device.name,
    aspectRatio: device.aspectRatio || aspectFromResolution(device.deviceInfo?.screenResolution) || '',
    contentAlign: normalizeContentAlign(device.contentAlign),
    kioskShellMode: normalizeKioskShellMode(device.kioskShellMode),
    enrollmentStatus: device.enrollmentStatus,
  };
}

async function buildVenueBootstrap(venueId) {
  if (!venueId) return null;
  const venue = await Venue.findById(venueId).lean();
  if (!venue) return null;
  return {
    id: String(venue._id),
    slug: venue.slug,
    name: venue.name,
    contentSignature: venueContentSignature(venue),
  };
}

async function buildLandingConfig(device) {
  const deviceId = String(device._id);
  const deviceInfo = buildDeviceInfo(device);
  const deviceAspect = deviceInfo.aspectRatio;
  const venueId = device.venueId || null;

  const groupFilter = { deviceIds: deviceId, isActive: true };
  if (venueId) groupFilter.venueId = venueId;
  const groups = await DeviceGroup.find(groupFilter).select('_id');
  const groupIds = groups.map(g => String(g._id));

  const orConditions = [{ deviceIds: deviceId }];
  if (groupIds.length) orConditions.push({ groupIds: { $in: groupIds } });
  const lpFilter = { isActive: true, $or: orConditions };
  if (venueId) lpFilter.venueId = venueId;
  const candidates = await LandingPage.find(lpFilter);

  const now = new Date();
  const campaignActive = (lp) => {
    const s = lp.schedule || {};
    if (s.startDate && now < new Date(s.startDate)) return false;
    if (s.endDate && now > new Date(s.endDate)) return false;
    return true;
  };

  const active = candidates
    .filter(campaignActive)
    .sort((a, b) => {
      const aDirect = (a.deviceIds || []).includes(deviceId) ? 1 : 0;
      const bDirect = (b.deviceIds || []).includes(deviceId) ? 1 : 0;
      if (aDirect !== bDirect) return bDirect - aDirect;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

  const landingPage = active[0] || null;
  const venue = await buildVenueBootstrap(venueId);
  const venueDoc = venueId ? await Venue.findById(venueId).select('timezone').lean() : null;
  const timezone = venueDoc?.timezone || 'Europe/Istanbul';
  const serverTime = now.toISOString();

  if (!landingPage) {
    return {
      device: deviceInfo,
      venue,
      landingPage: null,
      /* Kampanya yok ≠ mekân yok. Yalnızca-harita kiosklarında slayt olmaz;
       * isAssigned mekân bağını anlatır. */
      isAssigned: Boolean(venue),
      enrollmentStatus: device.enrollmentStatus,
      serverTime,
      message: 'No landing page assigned to this device',
    };
  }

  const slides = mapSyncSlides(landingPage.slides, landingPage.transitionDuration, {
    deviceAspect,
    groupIds,
    now,
  });

  const chrome = landingChromePayload(landingPage);
  const sync = buildSyncPayload(landingPage, slides, timezone);

  return {
    device: deviceInfo,
    venue,
    enrollmentStatus: device.enrollmentStatus,
    serverTime,
    landingPage: {
      id: landingPage._id,
      name: landingPage.name,
      slides,
      transitionDuration: landingPage.transitionDuration,
      showNavbar: chrome.showNavbar,
      showSidePanel: chrome.showSidePanel,
      displayMode: chrome.displayMode,
      letterboxColor: chrome.letterboxColor,
      sync,
      schedule: {
        startDate: landingPage.schedule?.startDate || null,
        endDate: landingPage.schedule?.endDate || null,
      },
    },
    isAssigned: true,
  };
}

/** POST /api/devices/register — kiosk (public, token required) */
router.post('/register', registerRateLimit, async (req, res) => {
  try {
    const { fingerprint, deviceInfo } = req.body || {};
    const deviceToken = extractDeviceToken(req);

    if (!fingerprint) {
      return res.status(400).json({ error: 'Fingerprint is required' });
    }
    if (!deviceToken) {
      return res.status(401).json({ error: 'Cihaz anahtarı gerekli' });
    }

    const device = await Device.registerSecure({
      fingerprint: String(fingerprint).trim(),
      deviceInfo,
      deviceToken,
      ipAddress: clientIp(req),
    });

    if (device.enrollmentStatus === 'pending') {
      const createdMs = device.createdAt ? new Date(device.createdAt).getTime() : 0;
      if (Date.now() - createdMs < 2 * 60 * 1000) {
        await logActivity({
          type: 'device_pending',
          icon: 'hourglass',
          tone: 'orange',
          text: `${device.name || device.displayId || 'Cihaz'} onay bekliyor`,
          venueId: device.venueId,
          meta: { deviceId: String(device._id) },
        });
      }
    }

    res.json({
      device: Device.publicDevicePayload(device),
      enrollmentStatus: device.enrollmentStatus,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code || undefined,
      });
    }
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * POST /api/devices/:deviceId/playback — kiosk telemetry (device token)
 * Body: sync position snapshot for multi-device comparison.
 */
router.post('/:deviceId/playback', playbackRateLimit, requireDeviceAuth(), async (req, res) => {
  try {
    const device = req.device;
    if (String(device._id) !== String(req.params.deviceId)) {
      return res.status(403).json({ error: 'Cihaz kimliği uyuşmuyor' });
    }

    const body = req.body || {};
    const index = Number(body.index);
    const offsetMs = Number(body.offsetMs);

    await Device.updateOne(
      { _id: device._id },
      {
        $set: {
          lastPlayback: {
            landingPageId: body.landingPageId ? String(body.landingPageId) : null,
            playlistSignature: body.playlistSignature ? String(body.playlistSignature) : '',
            syncEnabled: Boolean(body.syncEnabled),
            epochAt: body.epochAt || null,
            index: Number.isFinite(index) ? index : null,
            offsetMs: Number.isFinite(offsetMs) ? Math.round(offsetMs) : null,
            totalMs: Number.isFinite(Number(body.totalMs)) ? Math.round(Number(body.totalMs)) : null,
            elapsedMs: Number.isFinite(Number(body.elapsedMs)) ? Math.round(Number(body.elapsedMs)) : null,
            videoCurrentSec: Number.isFinite(Number(body.videoCurrentSec))
              ? Math.round(Number(body.videoCurrentSec) * 1000) / 1000
              : null,
            clockOffsetMs: Number.isFinite(Number(body.clockOffsetMs))
              ? Math.round(Number(body.clockOffsetMs))
              : null,
            mediaType: body.mediaType === 'video' ? 'video' : 'image',
            slideId: body.slideId ? String(body.slideId) : null,
            clientReportedAt: body.clientReportedAt || null,
            receivedAt: new Date(),
          },
          lastSeen: new Date(),
        },
      },
    );

    res.set('Cache-Control', 'no-store');
    res.json({ ok: true });
  } catch (error) {
    console.error('Error saving playback telemetry:', error);
    res.status(500).json({ error: 'Playback telemetry kaydedilemedi' });
  }
});

/**
 * GET /api/devices/playback-status — admin: compare latest telemetry for venue devices
 * Query: venueId (required), thresholdMs (optional, default 1000)
 */
router.get('/playback-status', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const venueIdParam = String(req.query.venueId || '').trim();
    if (!venueIdParam) {
      return res.status(400).json({ error: 'venueId gerekli' });
    }

    const allowed = await allowedVenueIds(req.user, { feature: FEATURES.DEVICES });
    if (!allowed.includes(venueIdParam)) {
      return res.status(403).json({ error: 'Bu mekan için yetkiniz yok' });
    }

    const devices = await Device.find({
      isActive: true,
      enrollmentStatus: 'active',
      venueId: new mongoose.Types.ObjectId(venueIdParam),
    }).select('_id displayId name lastPlayback').lean();

    const thresholdMs = Number(req.query.thresholdMs) || undefined;
    const result = playbackTelemetry.compareDeviceRows(devices, { thresholdMs });

    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (error) {
    console.error('Error loading playback status:', error);
    res.status(500).json({ error: 'Playback status alınamadı' });
  }
});

/** GET /api/devices/:deviceId/config — kiosk (device token required) */
router.get('/:deviceId/config', configRateLimit, requireDeviceAuth(), async (req, res) => {
  try {
    const device = req.device;
    device.lastSeen = new Date();
    await device.save();

    const venueSlug = String(req.query.venue || '').trim().toLowerCase();

    if (device.enrollmentStatus === 'pending') {
      return res.json({
        device: buildDeviceInfo(device),
        venue: null,
        landingPage: null,
        isAssigned: false,
        enrollmentStatus: 'pending',
        message: 'Cihaz henüz bir mekana atanmadı',
      });
    }

    if (device.enrollmentStatus !== 'active' || !device.venueId) {
      return res.status(403).json({
        error: 'Cihaz etkin değil',
        code: 'DEVICE_NOT_ACTIVE',
      });
    }

    if (venueSlug) {
      const requestedVenue = await Venue.findOne({ slug: venueSlug }).lean();
      if (!requestedVenue) {
        return res.status(404).json({
          error: 'Mekân bulunamadı',
          code: 'VENUE_NOT_FOUND',
        });
      }
      if (String(device.venueId) !== String(requestedVenue._id)) {
        const assignedVenue = await buildVenueBootstrap(device.venueId);
        return res.json({
          device: buildDeviceInfo(device),
          venue: assignedVenue,
          requestedVenue: {
            slug: requestedVenue.slug,
            name: requestedVenue.name,
            id: String(requestedVenue._id),
          },
          landingPage: null,
          isAssigned: false,
          enrollmentStatus: device.enrollmentStatus,
          code: 'VENUE_MISMATCH',
          message: 'Cihaz farklı bir mekâna atanmış',
        });
      }
    }

    const payload = await buildLandingConfig(device);
    res.json(payload);
  } catch (error) {
    console.error('Error getting device config:', error);
    res.status(500).json({ error: 'Failed to get device config' });
  }
});

/** GET /api/devices — auth + devices permission */
router.get('/', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const pendingOnly = req.query.pending === '1' || req.query.pending === 'true';

    if (pendingOnly) {
      if (!isAdmin(req.user)) {
        return res.status(403).json({ error: 'Bekleyen cihazları yalnızca admin görebilir' });
      }
      const devices = await Device.find({
        isActive: true,
        enrollmentStatus: { $in: ['pending', 'revoked'] },
      }).sort({ lastSeen: -1 });

      return res.json({
        devices: devices.map(device => ({
          id: device._id,
          ...device.toObject(),
          status: device.computedStatus,
          isPending: true,
        })),
      });
    }

    let filter = { isActive: true, enrollmentStatus: 'active' };
    const venueIdParam = req.query.venueId;

    if (venueIdParam) {
      const allowed = await allowedVenueIds(req.user, { feature: FEATURES.DEVICES });
      const vid = String(venueIdParam);
      if (!allowed.includes(vid)) {
        return res.status(403).json({ error: 'Bu mekan için yetkiniz yok' });
      }
      filter.venueId = new mongoose.Types.ObjectId(vid);
    } else {
      const scope = await venueScopeFilter(req.user, null, { feature: FEATURES.DEVICES });
      if (scope._id === null) return res.json({ devices: [] });
      Object.assign(filter, scope);
    }

    const devices = await Device.find(filter).sort({ lastSeen: -1 });

    res.json({
      devices: devices.map(device => ({
        id: device._id,
        ...device.toObject(),
        status: device.computedStatus,
      })),
    });
  } catch (error) {
    console.error('Error loading devices:', error);
    res.status(500).json({ error: 'Failed to load devices' });
  }
});

/** PUT /api/devices/:deviceId */
router.put('/:deviceId', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, location, tags, venueId, aspectRatio, contentAlign, kioskShellMode } = req.body;

    const device = await Device.findById(deviceId);
    if (!device || !device.isActive) return res.status(404).json({ error: 'Device not found' });

    const admin = isAdmin(req.user);
    const allowed = await allowedVenueIds(req.user, { feature: FEATURES.DEVICES });
    const deviceVenue = device.venueId ? String(device.venueId) : null;

    if (device.enrollmentStatus === 'pending') {
      if (!admin) {
        return res.status(403).json({ error: 'Bekleyen cihazları yalnızca admin yönetebilir' });
      }
    } else if (deviceVenue && !allowed.includes(deviceVenue)) {
      return res.status(403).json({ error: 'Bu cihaz için yetkiniz yok' });
    }

    const wasPending = device.enrollmentStatus === 'pending';
    const prevVenue = device.venueId ? String(device.venueId) : null;

    if (venueId !== undefined) {
      if (!admin) {
        return res.status(403).json({ error: 'Mekan ataması yalnızca admin tarafından yapılabilir' });
      }
      const nextVenue = String(venueId);
      if (!allowed.includes(nextVenue)) {
        return res.status(403).json({ error: 'Bu mekana cihaz atama yetkiniz yok' });
      }
      device.venueId = new mongoose.Types.ObjectId(nextVenue);
      device.enrollmentStatus = 'active';
      device.enrolledAt = device.enrolledAt || new Date();
      device.revokedAt = null;
      if (prevVenue !== nextVenue) {
        await LandingPage.updateMany(
          { deviceIds: deviceId },
          { $pull: { deviceIds: deviceId } }
        );
        await DeviceGroup.updateMany(
          { deviceIds: deviceId },
          { $pull: { deviceIds: deviceId } }
        );
      }
    }

    if (name !== undefined) device.name = name;
    if (location !== undefined) device.location = location;
    if (tags !== undefined) device.tags = tags;
    if (aspectRatio !== undefined) {
      const next = String(aspectRatio || '').trim();
      device.aspectRatio = next;
      // Boş bırakılırsa pre-save ekran çözünürlüğünden yeniden hesaplar
    }
    if (contentAlign !== undefined) {
      device.contentAlign = normalizeContentAlign(contentAlign);
    }
    if (kioskShellMode !== undefined) {
      device.kioskShellMode = normalizeKioskShellMode(kioskShellMode);
    }

    await device.save();

    const label = device.name || device.displayId || 'Cihaz';
    if (wasPending && device.enrollmentStatus === 'active') {
      await logActivity({
        req,
        type: 'device_approved',
        icon: 'check-circle',
        tone: 'green',
        text: `${label} onaylandı ve mekana atandı`,
        venueId: device.venueId,
        meta: { deviceId: String(device._id) },
      });
    } else {
      await logActivity({
        req,
        type: 'device_updated',
        icon: 'device-mobile',
        tone: 'blue',
        text: `${label} güncellendi`,
        venueId: device.venueId,
        meta: { deviceId: String(device._id) },
      });
    }

    res.json({
      device: {
        id: device._id,
        ...device.toObject()
      }
    });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

/** POST /api/devices/:deviceId/revoke — admin only */
router.post('/:deviceId/revoke', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Yalnızca admin cihaz erişimini iptal edebilir' });
    }

    const { deviceId } = req.params;
    const device = await Device.findById(deviceId);
    if (!device || !device.isActive) return res.status(404).json({ error: 'Device not found' });

    await LandingPage.updateMany(
      { deviceIds: deviceId },
      { $pull: { deviceIds: deviceId } }
    );
    await DeviceGroup.updateMany(
      { deviceIds: deviceId },
      { $pull: { deviceIds: deviceId } }
    );

    device.enrollmentStatus = 'revoked';
    device.revokedAt = new Date();
    device.venueId = null;
    await device.save();

    await logActivity({
      req,
      type: 'device_revoked',
      icon: 'prohibit',
      tone: 'orange',
      text: `${device.name || device.displayId || 'Cihaz'} erişimi iptal edildi`,
      venueId: null,
      meta: { deviceId: String(device._id) },
    });

    res.json({ message: 'Cihaz erişimi iptal edildi' });
  } catch (error) {
    console.error('Error revoking device:', error);
    res.status(500).json({ error: 'Failed to revoke device' });
  }
});

/** POST /api/devices/:deviceId/reset — revoked cihazı yeniden pending yap */
router.post('/:deviceId/reset', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Yalnızca admin cihazı yeniden eşleştirebilir' });
    }

    const device = await Device.findById(req.params.deviceId).select('+deviceTokenHash');
    if (!device || !device.isActive) return res.status(404).json({ error: 'Device not found' });
    if (device.enrollmentStatus !== 'revoked') {
      return res.status(409).json({ error: 'Yalnızca iptal edilmiş cihaz yeniden eşleştirilebilir' });
    }
    if (!device.deviceTokenHash) {
      return res.status(409).json({ error: 'Cihaz anahtarı bulunamadı; cihaz kaydını silip yeniden başlatın' });
    }

    device.enrollmentStatus = 'pending';
    device.revokedAt = null;
    device.enrolledAt = null;
    device.venueId = null;
    await device.save();

    await logActivity({
      req,
      type: 'device_reset',
      icon: 'arrows-clockwise',
      tone: 'orange',
      text: `${device.name || device.displayId || 'Cihaz'} yeniden eşleştirmeye alındı`,
      venueId: null,
      meta: { deviceId: String(device._id) },
    });

    res.json({ message: 'Cihaz yeniden eşleştirme için beklemeye alındı' });
  } catch (error) {
    console.error('Error resetting device:', error);
    res.status(500).json({ error: 'Failed to reset device' });
  }
});

/** DELETE /api/devices/:deviceId */
router.delete('/:deviceId', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findById(deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const admin = isAdmin(req.user);
    if (device.enrollmentStatus === 'pending' && !admin) {
      return res.status(403).json({ error: 'Bekleyen cihazları yalnızca admin silebilir' });
    }

    const allowed = await allowedVenueIds(req.user, { feature: FEATURES.DEVICES });
    if (device.venueId && !allowed.includes(String(device.venueId))) {
      return res.status(403).json({ error: 'Bu cihaz için yetkiniz yok' });
    }

    await LandingPage.updateMany(
      { deviceIds: deviceId },
      { $pull: { deviceIds: deviceId } }
    );
    await DeviceGroup.updateMany(
      { deviceIds: deviceId },
      { $pull: { deviceIds: deviceId } }
    );

    // Silme kalıcıdır; aynı fiziksel kiosk yeniden açılırsa yeni ve güvenli bir
    // pending kayıt oluşturabilir. Geçici engelleme için revoke kullanılmalıdır.
    const label = device.name || device.displayId || 'Cihaz';
    const venueId = device.venueId;
    await Device.deleteOne({ _id: deviceId });

    await logActivity({
      req,
      type: 'device_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `${label} silindi`,
      venueId,
      meta: { deviceId: String(deviceId) },
    });

    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

module.exports = router;
