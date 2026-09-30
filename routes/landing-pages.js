const express = require('express');
const LandingPage = require('../models/LandingPage');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, FEATURES } = require('../middleware/access');
const { computeAspectRatio } = require('../utils/aspect');
const { landingChromePayload, applyLandingChromeFields } = require('../utils/landing-chrome');
const { normalizeSchedule, mapSlides, venueScopeFilter, resolveVenueIdForWrite, validateDevicesForVenue, validateGroupsForVenue } = require('./helpers');
const { logActivity } = require('../services/activity-log');
const { normalizeSyncInput, assertSyncCompatibleSlides } = require('../utils/landing-sync');

const router = express.Router();

function serializeLandingPage(lp) {
  const chrome = landingChromePayload(lp);
  return {
    id: lp._id,
    venueId: lp.venueId ? String(lp.venueId) : null,
    name: lp.name,
    description: lp.description,
    slides: lp.slides,
    transitionDuration: lp.transitionDuration,
    deviceIds: lp.deviceIds || [],
    groupIds: lp.groupIds || [],
    schedule: lp.schedule,
    sync: {
      enabled: Boolean(lp.sync?.enabled),
      epochMode: lp.sync?.epochMode || 'midnight',
      epochAt: lp.sync?.epochAt || null,
      tickMs: lp.sync?.tickMs || 250,
    },
    showNavbar: chrome.showNavbar,
    showSidePanel: chrome.showSidePanel,
    displayMode: chrome.displayMode,
    letterboxColor: chrome.letterboxColor,
    deviceCount: lp.deviceCount,
    slideCount: lp.slideCount,
    isDefault: lp.isDefault,
    createdAt: lp.createdAt,
    updatedAt: lp.updatedAt
  };
}

router.get('/', requireAuth, requirePermission(FEATURES.LANDING_CAMPAIGNS), async (req, res) => {
  try {
    const scope = await venueScopeFilter(req.user, req.query.venueId, { feature: FEATURES.LANDING_CAMPAIGNS });
    const landingPages = await LandingPage.find({ isActive: true, ...scope }).sort({ createdAt: -1 });
    res.json({ landingPages: landingPages.map(serializeLandingPage) });
  } catch (error) {
    console.error('Error loading landing pages:', error);
    res.status(500).json({ error: 'Failed to load landing pages' });
  }
});

router.get('/:id', requireAuth, requirePermission(FEATURES.LANDING_CAMPAIGNS), async (req, res) => {
  try {
    const landingPage = await LandingPage.findById(req.params.id);
    if (!landingPage) return res.status(404).json({ error: 'Landing page not found' });

    const scope = await venueScopeFilter(req.user, landingPage.venueId ? String(landingPage.venueId) : null, { feature: FEATURES.LANDING_CAMPAIGNS });
    if (scope._id === null) return res.status(403).json({ error: 'Bu kampanya için yetkiniz yok' });

    res.json({ landingPage: serializeLandingPage(landingPage) });
  } catch (error) {
    console.error('Error loading landing page:', error);
    res.status(500).json({ error: 'Failed to load landing page' });
  }
});

router.post('/', requireAuth, requirePermission(FEATURES.LANDING_CAMPAIGNS), async (req, res) => {
  try {
    const { name, description, slides, transitionDuration, isDefault, deviceIds, groupIds, schedule, displayMode, showNavbar, showSidePanel, venueId, sync, letterboxColor } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const resolved = await resolveVenueIdForWrite(req.user, venueId, { feature: FEATURES.LANDING_CAMPAIGNS });
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });

    const mappedSlides = mapSlides(slides, computeAspectRatio);
    const syncNorm = normalizeSyncInput(sync);
    const syncErr = assertSyncCompatibleSlides(syncNorm, mappedSlides);
    if (syncErr) return res.status(400).json({ error: syncErr });

    const devIds = Array.isArray(deviceIds) ? deviceIds : [];
    const grpIds = Array.isArray(groupIds) ? groupIds : [];
    const devCheck = await validateDevicesForVenue(resolved.venueId, devIds);
    if (!devCheck.ok) return res.status(400).json({ error: devCheck.error });
    const grpCheck = await validateGroupsForVenue(resolved.venueId, grpIds);
    if (!grpCheck.ok) return res.status(400).json({ error: grpCheck.error });

    const landingPage = new LandingPage({
      venueId: resolved.venueId,
      name: name.trim(),
      description,
      slides: mappedSlides,
      transitionDuration: transitionDuration || 8000,
      isDefault: isDefault || false,
      deviceIds: devIds,
      groupIds: grpIds,
      schedule: normalizeSchedule(schedule),
      sync: syncNorm,
    });
    applyLandingChromeFields(landingPage, { displayMode, showNavbar, showSidePanel, letterboxColor });

    await landingPage.save();

    await logActivity({
      req,
      type: 'landing_created',
      icon: 'presentation-chart',
      tone: 'purple',
      text: `"${landingPage.name}" landing page oluşturuldu`,
      venueId: landingPage.venueId,
      meta: { landingPageId: String(landingPage._id) },
    });

    res.status(201).json({ landingPage: { id: landingPage._id, ...landingPage.toObject() } });
  } catch (error) {
    console.error('Error creating landing page:', error);
    res.status(500).json({ error: 'Failed to create landing page' });
  }
});

router.put('/:id', requireAuth, requirePermission(FEATURES.LANDING_CAMPAIGNS), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, slides, transitionDuration, isDefault, deviceIds, groupIds, schedule, displayMode, showNavbar, showSidePanel, sync, letterboxColor } = req.body;

    const landingPage = await LandingPage.findById(id);
    if (!landingPage) return res.status(404).json({ error: 'Landing page not found' });

    const scope = await venueScopeFilter(req.user, landingPage.venueId ? String(landingPage.venueId) : null, { feature: FEATURES.LANDING_CAMPAIGNS });
    if (scope._id === null) return res.status(403).json({ error: 'Bu kampanya için yetkiniz yok' });

    if (name !== undefined) landingPage.name = name.trim();
    if (description !== undefined) landingPage.description = description;
    if (transitionDuration !== undefined) landingPage.transitionDuration = transitionDuration;
    if (isDefault !== undefined) landingPage.isDefault = isDefault;

    if (slides !== undefined && Array.isArray(slides)) {
      landingPage.slides = mapSlides(slides, computeAspectRatio);
    }
    if (sync !== undefined) {
      landingPage.sync = normalizeSyncInput(sync);
    }
    const syncErr = assertSyncCompatibleSlides(landingPage.sync, landingPage.slides);
    if (syncErr) return res.status(400).json({ error: syncErr });

    if (deviceIds !== undefined) {
      const devIds = Array.isArray(deviceIds) ? deviceIds : [];
      const devCheck = await validateDevicesForVenue(landingPage.venueId, devIds);
      if (!devCheck.ok) return res.status(400).json({ error: devCheck.error });
      landingPage.deviceIds = devIds;
    }
    if (groupIds !== undefined) {
      const grpIds = Array.isArray(groupIds) ? groupIds : [];
      const grpCheck = await validateGroupsForVenue(landingPage.venueId, grpIds);
      if (!grpCheck.ok) return res.status(400).json({ error: grpCheck.error });
      landingPage.groupIds = grpIds;
    }
    if (schedule !== undefined) landingPage.schedule = normalizeSchedule(schedule);
    applyLandingChromeFields(landingPage, { displayMode, showNavbar, showSidePanel, letterboxColor });

    await landingPage.save();

    await logActivity({
      req,
      type: 'landing_updated',
      icon: 'presentation-chart',
      tone: 'purple',
      text: `"${landingPage.name}" landing page güncellendi`,
      venueId: landingPage.venueId,
      meta: { landingPageId: String(landingPage._id) },
    });

    res.json({ landingPage: serializeLandingPage(landingPage) });
  } catch (error) {
    console.error('Error updating landing page:', error);
    res.status(500).json({ error: 'Failed to update landing page', details: error.message });
  }
});

router.delete('/:id', requireAuth, requirePermission(FEATURES.LANDING_CAMPAIGNS), async (req, res) => {
  try {
    const landingPage = await LandingPage.findById(req.params.id);
    if (!landingPage) return res.status(404).json({ error: 'Landing page not found' });

    const scope = await venueScopeFilter(req.user, landingPage.venueId ? String(landingPage.venueId) : null, { feature: FEATURES.LANDING_CAMPAIGNS });
    if (scope._id === null) return res.status(403).json({ error: 'Bu kampanya için yetkiniz yok' });

    landingPage.isActive = false;
    await landingPage.save();

    await logActivity({
      req,
      type: 'landing_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `"${landingPage.name}" landing page silindi`,
      venueId: landingPage.venueId,
      meta: { landingPageId: String(landingPage._id) },
    });

    res.json({ message: 'Landing page deleted successfully' });
  } catch (error) {
    console.error('Error deleting landing page:', error);
    res.status(500).json({ error: 'Failed to delete landing page' });
  }
});

router.post('/:id/assign-devices', requireAuth, requirePermission(FEATURES.LANDING_CAMPAIGNS), async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceIds } = req.body;

    if (!Array.isArray(deviceIds)) {
      return res.status(400).json({ error: 'deviceIds must be an array' });
    }

    const existing = await LandingPage.findById(id);
    if (!existing) return res.status(404).json({ error: 'Landing page not found' });

    const scope = await venueScopeFilter(req.user, existing.venueId ? String(existing.venueId) : null, { feature: FEATURES.LANDING_CAMPAIGNS });
    if (scope._id === null) return res.status(403).json({ error: 'Bu kampanya için yetkiniz yok' });

    const devCheck = await validateDevicesForVenue(existing.venueId, deviceIds);
    if (!devCheck.ok) return res.status(400).json({ error: devCheck.error });

    const landingPage = await LandingPage.assignDevices(id, deviceIds, existing.venueId);

    await logActivity({
      req,
      type: 'landing_devices',
      icon: 'devices',
      tone: 'purple',
      text: `"${landingPage.name}" cihaz ataması güncellendi (${deviceIds.length})`,
      venueId: existing.venueId,
      meta: { landingPageId: String(landingPage._id), deviceCount: deviceIds.length },
    });

    res.json({
      landingPage: {
        id: landingPage._id,
        name: landingPage.name,
        deviceIds: landingPage.deviceIds,
        slides: landingPage.slides,
        transitionDuration: landingPage.transitionDuration
      }
    });
  } catch (error) {
    console.error('Error assigning devices:', error);
    res.status(500).json({ error: 'Failed to assign devices' });
  }
});

module.exports = router;
