const express = require('express');
const DeviceGroup = require('../models/DeviceGroup');
const Device = require('../models/Device');
const LandingPage = require('../models/LandingPage');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, FEATURES } = require('../middleware/access');
const { venueScopeFilter, resolveVenueIdForWrite, validateDevicesForVenue } = require('./helpers');
const { logActivity } = require('../services/activity-log');

const router = express.Router();

const CONTENT_ALIGN = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const KIOSK_SHELL_MODES = ['both', 'landing', 'map'];

function normalizeContentAlign(value) {
  const next = String(value || '').trim();
  return CONTENT_ALIGN.includes(next) ? next : '';
}

function normalizeKioskShellMode(value) {
  const next = String(value || '').trim().toLowerCase();
  return KIOSK_SHELL_MODES.includes(next) ? next : '';
}

/** Grup kaydındaki yerleşim ve ekran düzenini üye cihazlara yazar. */
async function applyGroupLayout(deviceIds, { contentAlign, kioskShellMode }) {
  const ids = Array.isArray(deviceIds) ? deviceIds.filter(Boolean) : [];
  if (!ids.length) return 0;
  const update = {};
  if (contentAlign) update.contentAlign = contentAlign;
  if (kioskShellMode) update.kioskShellMode = kioskShellMode;
  if (!Object.keys(update).length) return 0;
  const result = await Device.updateMany({ _id: { $in: ids } }, { $set: update });
  return result.modifiedCount || 0;
}

function groupPayload(g) {
  return {
    id: g._id,
    venueId: g.venueId ? String(g.venueId) : null,
    name: g.name,
    description: g.description,
    contentAlign: g.contentAlign || '',
    kioskShellMode: g.kioskShellMode || '',
    deviceIds: g.deviceIds || [],
    deviceCount: g.deviceCount,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt
  };
}

router.get('/', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const scope = await venueScopeFilter(req.user, req.query.venueId, { feature: FEATURES.DEVICES });
    const groups = await DeviceGroup.find({ isActive: true, ...scope }).sort({ createdAt: -1 });
    const data = groups.map(groupPayload);
    res.json({ groups: data });
  } catch (error) {
    console.error('Error loading device groups:', error);
    res.status(500).json({ error: 'Failed to load device groups' });
  }
});

router.post('/', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const { name, description, deviceIds, venueId, contentAlign, kioskShellMode } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const resolved = await resolveVenueIdForWrite(req.user, venueId, { feature: FEATURES.DEVICES });
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });

    const devIds = Array.isArray(deviceIds) ? deviceIds : [];
    const devCheck = await validateDevicesForVenue(resolved.venueId, devIds);
    if (!devCheck.ok) return res.status(400).json({ error: devCheck.error });

    const align = normalizeContentAlign(contentAlign) || 'center';
    const shell = normalizeKioskShellMode(kioskShellMode) || 'both';
    const group = new DeviceGroup({
      venueId: resolved.venueId,
      name: name.trim(),
      description: description || '',
      deviceIds: devIds,
      contentAlign: align,
      kioskShellMode: shell,
    });
    await group.save();
    await applyGroupLayout(devIds, { contentAlign: align, kioskShellMode: shell });

    await logActivity({
      req,
      type: 'group_created',
      icon: 'users-three',
      tone: 'blue',
      text: `"${group.name}" cihaz grubu oluşturuldu`,
      venueId: group.venueId,
      meta: { groupId: String(group._id) },
    });

    res.status(201).json({ group: { id: group._id, ...group.toObject() } });
  } catch (error) {
    console.error('Error creating device group:', error);
    res.status(500).json({ error: 'Failed to create device group' });
  }
});

router.put('/:id', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, deviceIds, contentAlign, kioskShellMode } = req.body;

    const group = await DeviceGroup.findById(id);
    if (!group) return res.status(404).json({ error: 'Device group not found' });

    const scope = await venueScopeFilter(req.user, group.venueId ? String(group.venueId) : null, { feature: FEATURES.DEVICES });
    if (scope._id === null) return res.status(403).json({ error: 'Bu grup için yetkiniz yok' });

    if (name !== undefined) group.name = name.trim();
    if (description !== undefined) group.description = description;
    if (deviceIds !== undefined) {
      const devIds = Array.isArray(deviceIds) ? deviceIds : [];
      const devCheck = await validateDevicesForVenue(group.venueId, devIds);
      if (!devCheck.ok) return res.status(400).json({ error: devCheck.error });
      group.deviceIds = devIds;
    }
    const align = contentAlign !== undefined ? normalizeContentAlign(contentAlign) : '';
    const shell = kioskShellMode !== undefined ? normalizeKioskShellMode(kioskShellMode) : '';
    if (align) group.contentAlign = align;
    if (shell) group.kioskShellMode = shell;
    await group.save();
    if (align || shell) {
      await applyGroupLayout(group.deviceIds, { contentAlign: align, kioskShellMode: shell });
    }

    await logActivity({
      req,
      type: 'group_updated',
      icon: 'users-three',
      tone: 'blue',
      text: `"${group.name}" cihaz grubu güncellendi`,
      venueId: group.venueId,
      meta: { groupId: String(group._id) },
    });

    res.json({ group: { id: group._id, ...group.toObject() } });
  } catch (error) {
    console.error('Error updating device group:', error);
    res.status(500).json({ error: 'Failed to update device group' });
  }
});

router.delete('/:id', requireAuth, requirePermission(FEATURES.DEVICES), async (req, res) => {
  try {
    const { id } = req.params;
    const group = await DeviceGroup.findById(id);
    if (!group) return res.status(404).json({ error: 'Device group not found' });

    const scope = await venueScopeFilter(req.user, group.venueId ? String(group.venueId) : null, { feature: FEATURES.DEVICES });
    if (scope._id === null) return res.status(403).json({ error: 'Bu grup için yetkiniz yok' });

    await LandingPage.updateMany({ groupIds: id }, { $pull: { groupIds: id } });
    await LandingPage.updateMany(
      { 'slides.targetGroupIds': id },
      { $pull: { 'slides.$[].targetGroupIds': id } }
    );
    await DeviceGroup.deleteOne({ _id: id });

    await logActivity({
      req,
      type: 'group_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `"${group.name}" cihaz grubu silindi`,
      venueId: group.venueId,
      meta: { groupId: String(group._id) },
    });

    res.json({ message: 'Device group deleted successfully' });
  } catch (error) {
    console.error('Error deleting device group:', error);
    res.status(500).json({ error: 'Failed to delete device group' });
  }
});

module.exports = router;
