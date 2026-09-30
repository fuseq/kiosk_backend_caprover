const express = require('express');
const path = require('path');
const multer = require('multer');
const Venue = require('../models/Venue');
const Device = require('../models/Device');
const DeviceGroup = require('../models/DeviceGroup');
const LandingPage = require('../models/LandingPage');
const { fetchSheetTab, pickTab } = require('../services/sheets-reader');
const { upsertRows } = require('../services/sheets-writer');
const { mapUnitAdPayload, formatAdCells } = require('../utils/ad-schedule');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, loadVenueForUser, venueFilterForUser, FEATURES, hasPermission } = require('../middleware/access');
const { loadUnits, loadCategories, unitSnapshot, saveUnit } = require('../services/unit-manager');
const { validateUnitFields, resolveUnitFields, canEditUnitStatus } = require('../utils/unit-schema');
const {
  MAX_GEOJSON_BYTES,
  parseAndValidateGeojson,
  downloadGeojson,
  saveVenueMap,
  readStoredVenueMap,
  removeStoredVenueMap,
  buildMapMetadata,
  resolveVenueGeojsonText,
  venueMapStorageKey,
} = require('../services/venue-map-store');
const {
  MAX_MAP_HISTORY,
  captureMapSnapshot,
  commitMapSnapshot,
  readHistoryEntry,
  removeHistoryEntries,
  findHistoryEntry,
  historySummary,
} = require('../services/venue-map-history');
const { parseEditorConfigSource, applyVenueSheetsFromConfig } = require('../services/venue-config-parse');
const {
  MAX_LOGO_BYTES,
  saveVenueLogo,
  removeStoredVenueMedia,
} = require('../services/venue-media-store');
const {
  MAX_VIDEO_BYTES,
  saveCampaignMedia,
} = require('../services/campaign-media-store');
const { logActivity } = require('../services/activity-log');

const router = express.Router();
const mapUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_GEOJSON_BYTES,
    /* geojson + config.js — busboy `files` limiti 1 kalırsa "Too many files" verir */
    files: 8,
    fields: 20,
  },
  fileFilter(req, file, callback) {
    if (file.fieldname === 'config') {
      const nameOk = /\.(js|mjs|cjs|json)$/i.test(file.originalname || '');
      return callback(
        nameOk ? null : new Error('Config için .js veya .json dosyası yükleyin'),
        nameOk,
      );
    }
    if (file.fieldname !== 'geojson') {
      return callback(new Error(`Beklenmeyen dosya alanı: ${file.fieldname}`));
    }
    const nameOk = /\.geojson$|\.json$/i.test(file.originalname || '');
    const typeOk = [
      'application/geo+json', 'application/json', 'text/json',
      'application/octet-stream', 'text/plain',
    ].includes(file.mimetype);
    callback(nameOk && typeOk ? null : new Error('Yalnızca .geojson veya .json dosyası yüklenebilir'), nameOk && typeOk);
  },
});

/**
 * Logo yüklemesi. Biçim doğrulaması burada değil venue-media-store'da imza
 * baytlarından yapılıyor; dosya adı ve content-type istemciden geldiği için
 * güvenilmez. Buradaki tek iş boyutu erken kesmek.
 */
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 10 },
});

const campaignMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 10 },
});

function multerUploadError(err) {
  if (!err) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 413, error: 'Dosya boyutu limiti aşıldı (en fazla 15 MB)' };
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return { status: 400, error: 'GeoJSON ve config.js birlikte yüklenebilir; fazla veya beklenmeyen dosya var' };
  }
  return { status: 400, error: err.message || 'Dosya yüklenemedi' };
}

function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Bu venue ayarını yalnızca admin yönetebilir' });
    return false;
  }
  return true;
}

function mapConfigSummary(venue) {
  const cfg = venue.mapConfig || {};
  return {
    configured: Boolean(cfg.map && typeof cfg.map === 'object'),
    originalFileName: cfg.originalFileName || '',
    updatedAt: cfg.updatedAt || null,
    updatedBy: cfg.updatedBy || '',
  };
}

function mapSummary(venue) {
  const map = venue.geojson || {};
  return {
    configured: Boolean(map.storageKey || venue.geojsonPath),
    sourceType: map.sourceType || (venue.geojsonPath ? (/^https?:\/\//i.test(venue.geojsonPath) ? 'url' : 'legacy') : ''),
    sourceUrl: map.sourceUrl || (/^https?:\/\//i.test(venue.geojsonPath || '') ? venue.geojsonPath : ''),
    originalFileName: map.originalFileName || '',
    featureCount: map.featureCount || 0,
    roomCount: map.roomCount || 0,
    floors: map.floors || [],
    sizeBytes: map.sizeBytes || 0,
    checksum: map.checksum || '',
    updatedAt: map.updatedAt || null,
    updatedBy: map.updatedBy || '',
    config: mapConfigSummary(venue),
  };
}

/**
 * Panele dönen logo özeti. Dosyanın kendisi kimlik doğrulaması olmadan public
 * uçtan servis edilir, bu yüzden burada yalnızca üstveri var.
 */
function logoSummary(venue) {
  const logo = venue.media?.logo || {};
  return {
    configured: Boolean(logo.storageKey),
    originalFileName: logo.originalFileName || '',
    contentType: logo.contentType || '',
    sizeBytes: logo.sizeBytes || 0,
    checksum: logo.checksum || '',
    updatedAt: logo.updatedAt || null,
    updatedBy: logo.updatedBy || '',
  };
}

function applyParsedMapConfig(venue, parsed, { originalFileName = '', updatedBy = '' } = {}) {
  venue.mapConfig = {
    map: parsed.map,
    originalFileName: originalFileName || venue.mapConfig?.originalFileName || '',
    updatedAt: new Date(),
    updatedBy,
  };
  // Tam bir editor config'i geldiyse kiosk da bundan beslenir; kısmi bir
  // harita parçası geldiyse mevcut kiosk config'i korunur.
  if (parsed.full) {
    venue.kioskConfig = {
      config: parsed.full,
      originalFileName: originalFileName || venue.kioskConfig?.originalFileName || '',
      updatedAt: new Date(),
      updatedBy,
    };
    // runtime-config sheets'i kioskConfig'ten değil Venue.sheets'ten ezer;
    // editörde değişen sheetId kayda geçmezse kiosk eski belgeyi okumaya devam eder.
    applyVenueSheetsFromConfig(venue, parsed.full);
  }
  // Editörün floorMap'i (kullanıcının verdiği kat adları) her zaman kazanır.
  // GeoJSON'dan türetilen "Zemin Kat / 1. Bodrum" etiketleri yalnızca
  // config'te floorMap yoksa kullanılır.
  if (parsed.floorMap && Object.keys(parsed.floorMap).length) {
    venue.floorMap = parsed.floorMap;
  }
}

/** CapRover dönemi anahtarları ("storage/venue-maps/...") aynı dosyayı gösterir. */
function isOtherMapKey(previousKey, storageKey) {
  if (!previousKey) return false;
  const norm = (k) => String(k).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^storage\//, '');
  return norm(previousKey) !== norm(storageKey);
}

function firstUploadedFile(req, field) {
  const list = req.files?.[field];
  return Array.isArray(list) && list[0] ? list[0] : null;
}


function venueListTab(venue) {
  return pickTab(venue.sheets, 'list', 'gid') || venue.sheets?.tabs?.list;
}

async function loadVenueUnits(venue) {
  const { rows } = await loadUnits(venue);
  return rows
    .filter(r => (r.ID || r.id || '').trim() && r.Title)
    .map(r => ({
      ...mapUnitAdPayload(r),
      floor: r.Floor || '',
      category: r.Category || ''
    }));
}

async function findVenue(idOrSlug) {
  if (/^[a-f0-9]{24}$/i.test(idOrSlug)) {
    return Venue.findById(idOrSlug);
  }
  return Venue.findOne({ slug: String(idOrSlug).trim().toLowerCase() });
}

/** GET /api/venues */
router.get('/', requireAuth, async (req, res) => {
  try {
    const filter = venueFilterForUser(req.user);
    const venues = await Venue.find(filter).sort({ name: 1 }).lean();
    res.json(venues);
  } catch (err) {
    console.error('GET /api/venues', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/venues — create (admin) */
router.post('/', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Yalnızca admin venue oluşturabilir' });
    }
    const { slug, name, sheets, timezone, tenantId } = req.body || {};
    if (!slug || !name || !sheets?.sheetId) {
      return res.status(400).json({ error: 'slug, name, sheets.sheetId required' });
    }
    const venue = await Venue.create({
      slug: String(slug).trim().toLowerCase(),
      name: String(name).trim(),
      sheets,
      timezone: timezone || 'Europe/Istanbul',
      tenantId: tenantId || null,
      geojsonPath: '',
      floorMap: {},
    });

    await logActivity({
      req,
      type: 'venue_created',
      icon: 'map-pin',
      tone: 'green',
      text: `${venue.name} mekanı oluşturuldu`,
      venueId: venue._id,
      tenantId: venue.tenantId,
    });

    res.status(201).json(venue);
  } catch (err) {
    console.error('POST /api/venues', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/venues/:idOrSlug — tek venue.
 * Editör açılışta kioskConfig + floorMap'i buradan okur; venue listesini çekip
 * içinden aramak zorunda kalmaz.
 */
router.get('/:idOrSlug', requireAuth, async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    res.json(access.venue.toObject ? access.venue.toObject() : access.venue);
  } catch (err) {
    console.error('GET venue', err);
    res.status(500).json({ error: 'Venue okunamadı' });
  }
});

/**
 * DELETE /api/venues/:idOrSlug — mekanı kalıcı sil (yalnızca admin).
 * Harita/logo dosyaları temizlenir; cihazlar mekansız bırakılır;
 * bu mekâna bağlı landing page ve cihaz grupları silinir.
 */
router.delete('/:idOrSlug', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const venue = access.venue;
    const venueId = venue._id;
    const name = venue.name;
    const tenantId = venue.tenantId || null;

    await removeStoredVenueMap(venue.geojson?.storageKey).catch((err) => {
      console.warn('venue map cleanup', err.message || err);
    });
    await removeStoredVenueMedia(venue.media?.logo?.storageKey).catch((err) => {
      console.warn('venue logo cleanup', err.message || err);
    });
    await removeHistoryEntries(venue.mapHistory || []);

    await Promise.all([
      Device.updateMany({ venueId }, { $set: { venueId: null } }),
      DeviceGroup.deleteMany({ venueId }),
      LandingPage.deleteMany({ venueId }),
      Venue.findByIdAndDelete(venueId),
    ]);

    await logActivity({
      req,
      type: 'venue_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `${name} mekanı silindi`,
      venueId: null,
      tenantId,
      meta: { deletedVenueId: String(venueId), slug: venue.slug },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/venues/:idOrSlug', err);
    res.status(500).json({ error: err.message || 'Mekan silinemedi' });
  }
});

/** GET /api/venues/:idOrSlug/map — harita kaynağı özeti */
router.get('/:idOrSlug/map', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    res.json({ venueId: String(access.venue._id), map: mapSummary(access.venue) });
  } catch (err) {
    console.error('GET venue map', err);
    res.status(500).json({ error: 'Harita bilgisi okunamadı' });
  }
});

/** POST /api/venues/:idOrSlug/map/upload — yerel GeoJSON (+ isteğe bağlı editor config.js) */
router.post(
  '/:idOrSlug/map/upload',
  requireAuth,
  requirePermission(FEATURES.VENUE_MANAGER),
  (req, res, next) => {
    mapUpload.fields([
      { name: 'geojson', maxCount: 1 },
      { name: 'config', maxCount: 1 },
    ])(req, res, (err) => {
      if (!err) return next();
      const mapped = multerUploadError(err);
      return res.status(mapped.status).json({ error: mapped.error });
    });
  },
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const access = await loadVenueForUser(req.user, req.params.idOrSlug);
      if (!access.ok) return res.status(access.status).json({ error: access.error });

      const geoFile = firstUploadedFile(req, 'geojson');
      const configFile = firstUploadedFile(req, 'config');
      if (!geoFile?.buffer && !configFile?.buffer) {
        return res.status(400).json({ error: 'GeoJSON veya editor config.js dosyası gerekli' });
      }

      const updatedBy = req.user.email || req.user.name || '';
      let geoFloorMap = null;
      /* Eski içerik, üzerine bir şey yazılmadan önce okunur. */
      const snapshot = await captureMapSnapshot(access.venue);
      const previousKey = access.venue.geojson?.storageKey || '';
      let pendingMap = null;

      if (geoFile?.buffer) {
        const parsed = parseAndValidateGeojson(geoFile.buffer);
        pendingMap = Buffer.from(JSON.stringify(parsed.data));

        access.venue.geojson = {
          ...buildMapMetadata({
            buffer: pendingMap,
            metadata: parsed.metadata,
            sourceType: 'upload',
            originalFileName: path.basename(geoFile.originalname),
            storageKey: venueMapStorageKey(access.venue._id),
          }),
          updatedBy,
        };
        access.venue.geojsonPath = '';
        geoFloorMap = parsed.metadata.floorMap || null;
      }

      if (configFile?.buffer) {
        const parsedConfig = parseEditorConfigSource(configFile.buffer, configFile.originalname);
        applyParsedMapConfig(access.venue, parsedConfig, {
          originalFileName: path.basename(configFile.originalname),
          updatedBy,
        });
      }

      // Editör floorMap yoksa geojson'dan türetilen (key → key) haritayı kullan.
      if ((!access.venue.floorMap || !Object.keys(access.venue.floorMap).length) && geoFloorMap) {
        access.venue.floorMap = geoFloorMap;
      }

      const dropped = await commitMapSnapshot(access.venue, snapshot, { reason: 'save', archivedBy: updatedBy });
      if (pendingMap) {
        const storageKey = await saveVenueMap(access.venue._id, pendingMap);
        if (isOtherMapKey(previousKey, storageKey)) await removeStoredVenueMap(previousKey);
      }
      await access.venue.save();
      await removeHistoryEntries(dropped);

      const parts = [];
      if (geoFile?.buffer) parts.push('harita');
      if (configFile?.buffer) parts.push('config');
      await logActivity({
        req,
        type: 'venue_map_upload',
        icon: 'map-trifold',
        tone: 'teal',
        text: `${access.venue.name} ${parts.join(' + ') || 'harita'} yüklendi`,
        venueId: access.venue._id,
      });

      res.json({ ok: true, map: mapSummary(access.venue) });
    } catch (err) {
      console.error('POST venue map upload', err);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Harita yüklenemedi' });
    }
  }
);

/** PUT /api/venues/:idOrSlug/map/url — URL’den GeoJSON al (+ isteğe bağlı config multipart) */
router.put(
  '/:idOrSlug/map/url',
  requireAuth,
  requirePermission(FEATURES.VENUE_MANAGER),
  (req, res, next) => {
    /* URL + opsiyonel config: multipart veya JSON body. */
    if (String(req.headers['content-type'] || '').includes('multipart/form-data')) {
      return mapUpload.fields([{ name: 'config', maxCount: 1 }])(req, res, (err) => {
        if (!err) return next();
        const mapped = multerUploadError(err);
        return res.status(mapped.status).json({ error: mapped.error });
      });
    }
    return next();
  },
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const access = await loadVenueForUser(req.user, req.params.idOrSlug);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      const sourceUrl = String(req.body?.url || '').trim();
      if (!sourceUrl) return res.status(400).json({ error: 'Harita URL’si gerekli' });

      const updatedBy = req.user.email || req.user.name || '';
      const downloaded = await downloadGeojson(sourceUrl);
      const parsed = parseAndValidateGeojson(downloaded.buffer);
      const normalized = Buffer.from(JSON.stringify(parsed.data));
      const snapshot = await captureMapSnapshot(access.venue);
      const previousKey = access.venue.geojson?.storageKey || '';

      access.venue.geojson = {
        ...buildMapMetadata({
          buffer: normalized,
          metadata: parsed.metadata,
          sourceType: 'url',
          sourceUrl: downloaded.finalUrl,
          storageKey: venueMapStorageKey(access.venue._id),
        }),
        updatedBy,
      };
      access.venue.geojsonPath = '';
      const geoFloorMap = parsed.metadata.floorMap || null;

      const configFile = firstUploadedFile(req, 'config');
      if (configFile?.buffer) {
        const parsedConfig = parseEditorConfigSource(configFile.buffer, configFile.originalname);
        applyParsedMapConfig(access.venue, parsedConfig, {
          originalFileName: path.basename(configFile.originalname),
          updatedBy,
        });
      }

      if ((!access.venue.floorMap || !Object.keys(access.venue.floorMap).length) && geoFloorMap) {
        access.venue.floorMap = geoFloorMap;
      }

      const dropped = await commitMapSnapshot(access.venue, snapshot, { reason: 'url', archivedBy: updatedBy });
      const storageKey = await saveVenueMap(access.venue._id, normalized);
      if (isOtherMapKey(previousKey, storageKey)) await removeStoredVenueMap(previousKey);
      await access.venue.save();
      await removeHistoryEntries(dropped);

      await logActivity({
        req,
        type: 'venue_map_url',
        icon: 'map-trifold',
        tone: 'teal',
        text: `${access.venue.name} haritası URL’den güncellendi`,
        venueId: access.venue._id,
      });

      res.json({ ok: true, map: mapSummary(access.venue) });
    } catch (err) {
      console.error('PUT venue map URL', err);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Harita URL’den alınamadı' });
    }
  }
);

/** DELETE /api/venues/:idOrSlug/map — harita kaynağını kaldır */
router.delete('/:idOrSlug/map', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const snapshot = await captureMapSnapshot(access.venue);
    const storageKey = access.venue.geojson?.storageKey;
    access.venue.geojson = undefined;
    access.venue.geojsonPath = '';
    access.venue.floorMap = {};
    if (req.query?.keepConfig !== '1') {
      access.venue.mapConfig = undefined;
    }
    const dropped = await commitMapSnapshot(access.venue, snapshot, {
      reason: 'delete',
      archivedBy: req.user.email || req.user.name || '',
    });
    await removeStoredVenueMap(storageKey);
    await access.venue.save();
    await removeHistoryEntries(dropped);

    await logActivity({
      req,
      type: 'venue_map_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `${access.venue.name} haritası kaldırıldı`,
      venueId: access.venue._id,
    });

    res.json({ ok: true, map: mapSummary(access.venue) });
  } catch (err) {
    console.error('DELETE venue map', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Harita kaldırılamadı' });
  }
});

/** DELETE /api/venues/:idOrSlug/map/config — yalnızca editor config’i kaldır */
router.delete('/:idOrSlug/map/config', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const snapshot = await captureMapSnapshot(access.venue);
    access.venue.mapConfig = undefined;
    const dropped = await commitMapSnapshot(access.venue, snapshot, {
      reason: 'delete',
      archivedBy: req.user.email || req.user.name || '',
    });
    await access.venue.save();
    await removeHistoryEntries(dropped);

    await logActivity({
      req,
      type: 'venue_map_config_deleted',
      icon: 'sliders-horizontal',
      tone: 'orange',
      text: `${access.venue.name} harita config kaldırıldı`,
      venueId: access.venue._id,
    });

    res.json({ ok: true, map: mapSummary(access.venue) });
  } catch (err) {
    console.error('DELETE venue map config', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Config kaldırılamadı' });
  }
});

/**
 * GET /api/venues/:idOrSlug/map/versions — yayındaki içerik + son sürümler.
 * Editör "Önceki sürümler" listesini buradan kurar.
 */
router.get('/:idOrSlug/map/versions', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    res.json({
      max: MAX_MAP_HISTORY,
      current: mapSummary(access.venue),
      versions: (access.venue.mapHistory || []).map(historySummary),
    });
  } catch (err) {
    console.error('GET venue map versions', err);
    res.status(500).json({ error: 'Sürüm geçmişi okunamadı' });
  }
});

/**
 * GET /api/venues/:idOrSlug/map/versions/:versionId/content — bir sürümün
 * haritası + config'i. Canlıya dokunmaz; editör incelemek için yükler.
 */
router.get('/:idOrSlug/map/versions/:versionId/content', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const entry = findHistoryEntry(access.venue, req.params.versionId);
    if (!entry) return res.status(404).json({ error: 'Sürüm bulunamadı' });

    const { geojsonText, content } = await readHistoryEntry(entry);
    /* Harita metni yeniden ayrıştırılmadan gömülür — 15 MB'a kadar olabilir. */
    const head = JSON.stringify({
      version: historySummary(entry),
      config: content.kioskConfig?.config ?? null,
      floorMap: content.floorMap || {},
    });
    res.type('application/json').send(`${head.slice(0, -1)},"geojson":${geojsonText}}`);
  } catch (err) {
    console.error('GET venue map version content', err);
    res.status(500).json({ error: 'Sürüm okunamadı' });
  }
});

/**
 * POST /api/venues/:idOrSlug/map/versions/:versionId/restore — sürümü canlıya al.
 * Yayındaki içerik önce geçmişe yazılır; geri yükleme de geri alınabilir.
 */
router.post('/:idOrSlug/map/versions/:versionId/restore', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const venue = access.venue;
    const entry = findHistoryEntry(venue, req.params.versionId);
    if (!entry) return res.status(404).json({ error: 'Sürüm bulunamadı' });
    const restoredEntry = JSON.parse(JSON.stringify(entry));

    const { geojsonText, content } = await readHistoryEntry(restoredEntry);
    const parsed = parseAndValidateGeojson(geojsonText);
    const normalized = Buffer.from(JSON.stringify(parsed.data));
    const updatedBy = req.user.email || req.user.name || '';
    const snapshot = await captureMapSnapshot(venue);
    const previousKey = venue.geojson?.storageKey || '';
    const now = new Date();

    venue.geojson = {
      ...buildMapMetadata({
        buffer: normalized,
        metadata: parsed.metadata,
        sourceType: 'upload',
        originalFileName: restoredEntry.originalFileName || '',
        storageKey: venueMapStorageKey(venue._id),
      }),
      updatedBy,
    };
    venue.geojsonPath = '';
    venue.kioskConfig = content.kioskConfig
      ? { ...content.kioskConfig, updatedAt: now, updatedBy }
      : undefined;
    venue.mapConfig = content.mapConfig
      ? { ...content.mapConfig, updatedAt: now, updatedBy }
      : undefined;
    venue.floorMap = content.floorMap || {};
    if (content.kioskConfig?.config) applyVenueSheetsFromConfig(venue, content.kioskConfig.config);

    /* Geri yüklenen sürüm artık yayında; listede ikinci kopyası kalmasın. */
    venue.mapHistory = (venue.mapHistory || []).filter(e => e.id !== restoredEntry.id);
    const dropped = await commitMapSnapshot(venue, snapshot, { reason: 'restore', archivedBy: updatedBy });
    const storageKey = await saveVenueMap(venue._id, normalized);
    if (isOtherMapKey(previousKey, storageKey)) await removeStoredVenueMap(previousKey);
    await venue.save();
    await removeHistoryEntries([restoredEntry, ...dropped]);

    const when = restoredEntry.savedAt ? new Date(restoredEntry.savedAt).toLocaleString('tr-TR') : '';
    await logActivity({
      req,
      type: 'venue_map_restore',
      icon: 'clock-counter-clockwise',
      tone: 'orange',
      text: `${venue.name} içeriği önceki sürüme döndürüldü${when ? ` (${when})` : ''}`,
      venueId: venue._id,
    });

    res.json({
      ok: true,
      map: mapSummary(venue),
      versions: (venue.mapHistory || []).map(historySummary),
    });
  } catch (err) {
    console.error('POST venue map version restore', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Sürüm geri yüklenemedi' });
  }
});

/**
 * POST /api/venues/:idOrSlug/media/logo — venue marka logosu.
 *
 * Kiosk config'indeki `branding.logo` göreli bir yol olduğu için logo imaja
 * gömülüydü; buraya yüklendiğinde runtime-config onu mutlak adresle ezer.
 */
router.post(
  '/:idOrSlug/media/logo',
  requireAuth,
  requirePermission(FEATURES.VENUE_MANAGER),
  (req, res, next) => {
    logoUpload.single('logo')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Logo en fazla 2 MB olabilir' });
      }
      return res.status(400).json({ error: err.message || 'Logo yüklenemedi' });
    });
  },
  async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const access = await loadVenueForUser(req.user, req.params.idOrSlug);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      if (!req.file?.buffer) return res.status(400).json({ error: 'Logo dosyası gerekli' });

      const previousKey = access.venue.media?.logo?.storageKey || '';
      const saved = await saveVenueLogo(access.venue._id, req.file.buffer, req.file.originalname);

      access.venue.media = access.venue.media || {};
      access.venue.media.logo = {
        ...saved,
        updatedBy: req.user.email || req.user.name || '',
      };
      await access.venue.save();

      // Uzantı değiştiyse (png → webp) eski obje artık erişilemez; temizle.
      if (previousKey && previousKey !== saved.storageKey) {
        await removeStoredVenueMedia(previousKey).catch(() => {});
      }

      await logActivity({
        req,
        type: 'venue_logo_upload',
        icon: 'image',
        tone: 'blue',
        text: `${access.venue.name} logosu güncellendi`,
        venueId: access.venue._id,
      });

      res.json({ ok: true, logo: logoSummary(access.venue) });
    } catch (err) {
      console.error('POST venue logo', err);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Logo yüklenemedi' });
    }
  }
);

/** DELETE /api/venues/:idOrSlug/media/logo — kiosk derlemedeki varsayılana döner */
router.delete('/:idOrSlug/media/logo', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    await removeStoredVenueMedia(access.venue.media?.logo?.storageKey);
    if (access.venue.media) access.venue.media.logo = undefined;
    await access.venue.save();

    await logActivity({
      req,
      type: 'venue_logo_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `${access.venue.name} logosu kaldırıldı`,
      venueId: access.venue._id,
    });

    res.json({ ok: true, logo: logoSummary(access.venue) });
  } catch (err) {
    console.error('DELETE venue logo', err);
    res.status(500).json({ error: 'Logo kaldırılamadı' });
  }
});

/**
 * POST /api/venues/:idOrSlug/campaign-media — kampanya görsel/video yükle
 * Auth + LANDING_CAMPAIGNS. Response: public URL + mediaType.
 */
router.post(
  '/:idOrSlug/campaign-media',
  requireAuth,
  requirePermission(FEATURES.LANDING_CAMPAIGNS),
  (req, res, next) => {
    campaignMediaUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Dosya en fazla 50 MB olabilir' });
      }
      return res.status(400).json({ error: err.message || 'Medya yüklenemedi' });
    });
  },
  async (req, res) => {
    try {
      const access = await loadVenueForUser(req.user, req.params.idOrSlug);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      if (!req.file?.buffer) return res.status(400).json({ error: 'Dosya gerekli' });

      const saved = await saveCampaignMedia(
        access.venue._id,
        req.file.buffer,
        req.file.originalname,
      );

      const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
        || `${req.protocol}://${req.get('host')}`;
      const url = `${base}/api/public/venues/${encodeURIComponent(access.venue.slug)}/campaign-media/${encodeURIComponent(saved.filename)}`;

      res.json({
        ok: true,
        url,
        mediaType: saved.mediaType,
        contentType: saved.contentType,
        sizeBytes: saved.sizeBytes,
        filename: saved.filename,
        storageKey: saved.storageKey,
        originalFileName: saved.originalFileName,
      });
    } catch (err) {
      console.error('POST campaign-media', err);
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Medya yüklenemedi' });
    }
  },
);

/** PUT /api/venues/:idOrSlug/unit-schema — admin alan/günlük ayarları */
router.put('/:idOrSlug/unit-schema', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const validation = validateUnitFields(req.body?.fields);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    const changesTab = String(req.body?.changesTab || '').trim();
    if (changesTab.length > 120) {
      return res.status(400).json({ error: 'Günlük sekmesi adı çok uzun' });
    }

    access.venue.unitAttributes = validation.fields.map((field, index) => ({
      ...field,
      order: index,
    }));
    access.venue.unitStatusEditable = req.body?.statusEditable !== false;
    access.venue.sheets.tabs.changes = changesTab;
    await access.venue.save();

    await logActivity({
      req,
      type: 'venue_unit_schema',
      icon: 'table',
      tone: 'blue',
      text: `${access.venue.name} birim alanları güncellendi`,
      venueId: access.venue._id,
    });

    res.json({
      ok: true,
      schema: resolveUnitFields(access.venue),
      changesTab: access.venue.sheets.tabs.changes || '',
      statusEditable: access.venue.unitStatusEditable !== false,
    });
  } catch (err) {
    console.error('PUT venue unit schema', err);
    res.status(500).json({ error: 'Birim alanları kaydedilemedi' });
  }
});

/** GET /api/venues/:idOrSlug/units — unit ads or venue manager */
router.get('/:idOrSlug/units', requireAuth, async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const { venue } = access;

    const hasAds = hasPermission(req.user, FEATURES.UNIT_ADS, { venue });
    const hasVm = hasPermission(req.user, FEATURES.VENUE_MANAGER, { venue });
    if (!hasAds && !hasVm) {
      return res.status(403).json({ error: 'Birim verilerine erişim yetkiniz yok' });
    }

    const { rows, fields, missingColumns, availableColumns } = await loadUnits(venue);
    const units = rows
      .filter(r => (r.ID || r.id || '').trim())
      .map(r => {
        const snap = unitSnapshot(r, r.ID, fields);
        if (!snap) return null;
        const ad = mapUnitAdPayload(r);
        return {
          ...snap,
          // Birim reklamları UI'si (logo / images / adSchedule / adActive)
          logo: ad.logo || snap.values?.Logo || null,
          images: ad.images,
          adSchedule: ad.adSchedule,
          adActive: ad.adActive,
          floor: snap.values?.Floor || r.Floor || '',
          category: snap.values?.Category || r.Category || '',
        };
      })
      .filter(Boolean);

    res.json({
      venue: { id: venue._id, slug: venue.slug, name: venue.name },
      units,
      schema: fields,
      statusEditable: canEditUnitStatus(venue, { isAdmin: req.user.role === 'admin' }),
      missingColumns,
      availableColumns,
    });
  } catch (err) {
    console.error('GET units', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/venues/:idOrSlug/categories */
router.get('/:idOrSlug/categories', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug, { feature: FEATURES.VENUE_MANAGER });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const categories = await loadCategories(access.venue);
    res.json({ categories });
  } catch (err) {
    console.error('GET categories', err);
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/venues/:idOrSlug/units/:unitId — venue manager save */
router.put('/:idOrSlug/units/:unitId', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug, { feature: FEATURES.VENUE_MANAGER });
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const { values, disabled, note } = req.body || {};
    // İstemciden gelen kimliğe güvenme; denetim kaydını doğrulanmış oturumdan üret.
    const editor = req.user.email || req.user.name;
    const result = await saveUnit(
      access.venue,
      {
        id: req.params.unitId,
        values: values || {},
        disabled,
        note: note || '',
        editor,
      },
      { allowStatusEdit: canEditUnitStatus(access.venue, { isAdmin: req.user.role === 'admin' }) }
    );

    if (!result.ok) return res.status(400).json(result);

    if (!result.noop) {
      const unitLabel = result.snapshot?.title || req.params.unitId;
      const changeCount = Array.isArray(result.changes) ? result.changes.length : 0;
      const statusTouched = disabled !== undefined;
      let text = `${unitLabel} birimi güncellendi`;
      if (statusTouched && !changeCount) {
        text = result.disabled ? `${unitLabel} birimi kapatıldı` : `${unitLabel} birimi açıldı`;
      } else if (statusTouched && changeCount) {
        text = result.disabled
          ? `${unitLabel} birimi güncellendi ve kapatıldı (${changeCount} alan)`
          : `${unitLabel} birimi güncellendi ve açıldı (${changeCount} alan)`;
      } else if (changeCount) {
        text = `${unitLabel} birimi güncellendi (${changeCount} alan)`;
      }
      await logActivity({
        req,
        type: statusTouched && !changeCount
          ? (result.disabled ? 'unit_disabled' : 'unit_enabled')
          : 'unit_updated',
        icon: 'storefront',
        tone: result.disabled ? 'orange' : 'teal',
        text,
        venueId: access.venue._id,
        meta: { unitId: req.params.unitId, changes: changeCount, disabled: !!result.disabled },
      });
    }

    res.json(result);
  } catch (err) {
    console.error('PUT unit', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/venues/:idOrSlug/geojson */
router.get('/:idOrSlug/geojson', requireAuth, requirePermission(FEATURES.VENUE_MANAGER), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug, { feature: FEATURES.VENUE_MANAGER });
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const content = await resolveVenueGeojsonText(access.venue);
    if (!content) return res.status(404).json({ error: 'Bu venue için geojson tanımlı değil' });
    res.type('application/geo+json').send(content);
  } catch (err) {
    console.error('GET geojson', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/venues/:idOrSlug/ads/active-map — public kiosk */
router.get('/:idOrSlug/ads/active-map', async (req, res) => {
  try {
    const venue = await findVenue(req.params.idOrSlug);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    const units = await loadVenueUnits(venue);
    const map = {};
    for (const u of units) {
      if (u.adActive && u.images?.length) {
        map[u.id] = { images: u.images, adSchedule: u.adSchedule };
      }
    }
    res.json({
      venue: venue.slug,
      timezone: venue.timezone,
      generatedAt: new Date().toISOString(),
      ads: map
    });
  } catch (err) {
    console.error('GET active-map', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/venues/:idOrSlug/units/:unitId/ad */
router.get('/:idOrSlug/units/:unitId/ad', requireAuth, requirePermission(FEATURES.UNIT_ADS), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug, { feature: FEATURES.UNIT_ADS });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const tab = venueListTab(access.venue);
    const rows = await fetchSheetTab(access.venue.sheets.sheetId, tab);
    const row = rows.find(r => String(r.ID || r.id).trim() === String(req.params.unitId).trim());
    if (!row) return res.status(404).json({ error: 'Unit not found' });
    res.json(mapUnitAdPayload(row));
  } catch (err) {
    console.error('GET unit ad', err);
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/venues/:idOrSlug/units/:unitId/ad */
router.put('/:idOrSlug/units/:unitId/ad', requireAuth, requirePermission(FEATURES.UNIT_ADS), async (req, res) => {
  try {
    const access = await loadVenueForUser(req.user, req.params.idOrSlug, { feature: FEATURES.UNIT_ADS });
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const venue = access.venue;

    const { images, adStartDate, adEndDate, adStartTime, adEndTime, adEnabled } = req.body || {};
    const tab = venueListTab(venue);
    const rows = await fetchSheetTab(venue.sheets.sheetId, tab);
    const row = rows.find(r => String(r.ID || r.id).trim() === String(req.params.unitId).trim());
    if (!row) return res.status(404).json({ error: 'Unit not found' });

    const patch = { ID: String(req.params.unitId).trim() };
    if (images != null) {
      patch.Images = Array.isArray(images) ? images.join('|') : String(images);
    }
    Object.assign(patch, formatAdCells({
      startDate: adStartDate || null,
      endDate: adEndDate || null,
      startTime: adStartTime || '00:00',
      endTime: adEndTime || '23:59',
      enabled: adEnabled !== false
    }));
    if ('AdSchedule' in row && String(row.AdSchedule || '').trim()) {
      patch.AdSchedule = '';
    }

    if (venue.sheets.writeEndpointUrl) {
      await upsertRows({
        writeEndpointUrl: venue.sheets.writeEndpointUrl,
        sheetId: venue.sheets.sheetId,
        tab: venueListTab(venue),
        rows: [patch]
      });
    }

    const preview = mapUnitAdPayload({
      ...row,
      ...patch,
      Images: patch.Images != null ? patch.Images : (row.Images || ''),
      Title: row.Title || row.title || patch.ID,
    });
    const label = preview.title || patch.ID;
    await logActivity({
      req,
      type: 'unit_ad_saved',
      icon: 'megaphone',
      tone: 'orange',
      text: preview.adActive
        ? `${label} birim reklamı kaydedildi (yayında)`
        : `${label} birim reklamı kaydedildi`,
      venueId: venue._id,
      meta: { unitId: patch.ID, imageCount: preview.images?.length || 0 },
    });

    res.json({
      ok: true,
      unitId: patch.ID,
      writtenToSheet: !!venue.sheets.writeEndpointUrl,
      payload: patch,
      preview
    });
  } catch (err) {
    console.error('PUT unit ad', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
