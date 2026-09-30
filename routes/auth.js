const express = require('express');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');
const { FEATURE_LABELS, TENANT_FEATURES, normalizePermissions } = require('../constants/features');
const {
  effectivePermissions,
  resolveMemberships,
  primaryMembership,
} = require('../middleware/access');
const {
  validateMembershipsInput,
  applyMembershipsToUser,
} = require('../utils/memberships');
const { logActivity } = require('../services/activity-log');

const router = express.Router();

async function hydrateMemberships(memberships) {
  const list = Array.isArray(memberships) ? memberships : [];
  if (!list.length) return [];
  const ids = list.map(m => m.tenantId);
  const tenants = await Tenant.find({ _id: { $in: ids } }).select('name slug').lean();
  const byId = new Map(tenants.map(t => [String(t._id), t]));
  return list.map(m => {
    const tenant = byId.get(String(m.tenantId));
    return {
      tenantId: String(m.tenantId),
      tenantName: tenant?.name || null,
      tenantSlug: tenant?.slug || null,
      permissions: normalizePermissions(m.permissions),
      isActive: m.isActive !== false,
    };
  });
}

async function serializeUser(user) {
  const memberships = await hydrateMemberships(resolveMemberships(user));
  const primary = memberships[0] || null;
  return {
    id: String(user._id || user.id),
    email: user.email,
    name: user.name,
    role: user.role,
    // Geriye dönük uyumluluk
    tenantId: primary?.tenantId || null,
    tenantName: primary?.tenantName || null,
    permissions: effectivePermissions({ ...user, memberships: resolveMemberships(user) }),
    memberships,
  };
}

function serializeTenantUser(user, tenantId) {
  const memberships = resolveMemberships(user);
  const membership = memberships.find(m => m.tenantId === String(tenantId));
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    permissions: membership ? membership.permissions : [],
    membershipCount: memberships.length,
    memberships: memberships.map(m => ({
      tenantId: m.tenantId,
      permissions: m.permissions,
    })),
  };
}

/** POST /api/auth/login { email, password } */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-posta ve şifre gerekli' });
    }
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user || user.isActive === false || !(await user.checkPassword(password))) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
    }
    const token = signToken(user);
    res.json({
      token,
      user: await serializeUser(user),
      features: FEATURE_LABELS,
    });
  } catch (err) {
    console.error('POST /api/auth/login', err);
    res.status(500).json({ error: 'Giriş başarısız' });
  }
});

/** GET /api/auth/me */
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Geçersiz oturum' });
  res.json({
    user: await serializeUser(user),
    features: FEATURE_LABELS,
    tenantFeatures: TENANT_FEATURES,
  });
});

// ── Tenant + kullanıcı yönetimi (yalnız admin) ──────────────────────

/** GET /api/auth/tenants — tenant listesi + kullanıcıları + venue sayısı */
router.get('/tenants', requireAuth, requireAdmin, async (req, res) => {
  try {
    const Venue = require('../models/Venue');
    const tenants = await Tenant.find().sort({ name: 1 }).lean();
    const users = await User.find({ role: 'tenant' }).select('-passwordHash').lean();
    const venues = await Venue.find().select('name slug tenantId').lean();

    res.json({
      tenants: tenants.map(t => {
        const tid = String(t._id);
        const tenantUsers = users
          .filter(u => resolveMemberships(u).some(m => m.tenantId === tid))
          .map(u => serializeTenantUser(u, tid));
        return {
          ...t,
          users: tenantUsers,
          venues: venues.filter(v => String(v.tenantId) === tid),
        };
      }),
      unassignedVenues: venues.filter(v => !v.tenantId),
      users: users.map(u => ({
        id: String(u._id),
        email: u.email,
        name: u.name,
        isActive: u.isActive !== false,
        memberships: resolveMemberships(u),
      })),
    });
  } catch (err) {
    console.error('GET /api/auth/tenants', err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/auth/tenants { name, slug } */
router.post('/tenants', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, slug } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name ve slug gerekli' });
    const tenant = await Tenant.create({ name: name.trim(), slug: slug.trim().toLowerCase() });

    await logActivity({
      req,
      type: 'tenant_created',
      icon: 'buildings',
      tone: 'teal',
      text: `${tenant.name} müşterisi oluşturuldu`,
      tenantId: tenant._id,
    });

    res.status(201).json(tenant);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Bu slug zaten var' });
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/auth/tenants/:id */
router.delete('/tenants/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const Venue = require('../models/Venue');
    const tenantId = req.params.id;

    const existing = await Tenant.findById(tenantId).select('name').lean();
    await Tenant.findByIdAndDelete(tenantId);
    await Venue.updateMany({ tenantId }, { $set: { tenantId: null } });

    // Ortak kullanıcıları silme — yalnızca ilgili üyeliği kaldır
    const users = await User.find({
      role: 'tenant',
      $or: [
        { tenantId },
        { 'memberships.tenantId': tenantId },
      ],
    });

    for (const user of users) {
      const remaining = resolveMemberships(user).filter(m => m.tenantId !== String(tenantId));
      if (!remaining.length) {
        user.isActive = false;
        user.memberships = [];
        user.tenantId = null;
        user.permissions = [];
      } else {
        applyMembershipsToUser(user, remaining);
      }
      await user.save();
    }

    await logActivity({
      req,
      type: 'tenant_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `${existing?.name || 'Müşteri'} silindi`,
      tenantId,
      meta: { tenantId: String(tenantId) },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/users
 * Yeni kullanıcı veya mevcut e-postaya üyelik ekleme.
 * Body: { email, password?, name, tenantId?, permissions?, memberships? }
 */
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, name, tenantId, permissions, memberships: membershipsInput } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email gerekli' });

    let validated;
    if (Array.isArray(membershipsInput) && membershipsInput.length) {
      validated = validateMembershipsInput(membershipsInput);
    } else if (tenantId) {
      validated = validateMembershipsInput([{
        tenantId,
        permissions: permissions || undefined,
      }]);
    } else {
      return res.status(400).json({ error: 'tenantId veya memberships gerekli' });
    }
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const tenantIds = validated.memberships.map(m => m.tenantId);
    const tenants = await Tenant.find({ _id: { $in: tenantIds } }).select('_id').lean();
    if (tenants.length !== tenantIds.length) {
      return res.status(400).json({ error: 'Geçersiz müşteri kimliği' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      return res.status(409).json({
        error: user.role === 'admin'
          ? 'Bu e-posta bir admin hesabına ait'
          : 'Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var. Mevcut kullanıcılar listesinden atama yapın.',
        code: 'USER_EMAIL_EXISTS',
        userId: String(user._id),
      });
    }

    if (!password) return res.status(400).json({ error: 'Yeni kullanıcı için şifre gerekli' });
    const passwordHash = await User.hashPassword(password);
    user = new User({
      email: normalizedEmail,
      name: name || '',
      passwordHash,
      role: 'tenant',
      isActive: true,
    });
    applyMembershipsToUser(user, validated.memberships);
    await user.save();

    await logActivity({
      req,
      type: 'user_created',
      icon: 'user-plus',
      tone: 'blue',
      text: `${user.email} kullanıcısı oluşturuldu`,
      tenantId: validated.memberships[0]?.tenantId || null,
      meta: { userId: String(user._id) },
    });

    res.status(201).json(await serializeUser(user));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
    console.error('POST /api/auth/users', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/auth/users/:id
 * Atomik güncelleme: name, email, password?, memberships[]
 */
router.patch('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'tenant') {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const { name, email, password, memberships: membershipsInput } = req.body || {};

    if (email !== undefined) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail) return res.status(400).json({ error: 'E-posta gerekli' });
      const clash = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (clash) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
      user.email = normalizedEmail;
    }
    if (name !== undefined) user.name = String(name || '').trim();
    if (password) user.passwordHash = await User.hashPassword(password);

    if (membershipsInput !== undefined) {
      const validated = validateMembershipsInput(membershipsInput);
      if (!validated.ok) return res.status(400).json({ error: validated.error });
      const tenantIds = validated.memberships.map(m => m.tenantId);
      const tenants = await Tenant.find({ _id: { $in: tenantIds } }).select('_id').lean();
      if (tenants.length !== tenantIds.length) {
        return res.status(400).json({ error: 'Geçersiz müşteri kimliği' });
      }
      applyMembershipsToUser(user, validated.memberships);
      user.isActive = true;
    }

    await user.save();

    await logActivity({
      req,
      type: 'user_updated',
      icon: 'user',
      tone: 'blue',
      text: `${user.email} kullanıcısı güncellendi`,
      meta: { userId: String(user._id) },
    });

    res.json(await serializeUser(user));
  } catch (err) {
    console.error('PATCH /api/auth/users', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/auth/users/:id/memberships/:tenantId
 * Yalnızca ilgili müşteri erişimini kaldırır.
 */
router.delete('/users/:id/memberships/:tenantId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'tenant') {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const tenantId = String(req.params.tenantId);
    const remaining = resolveMemberships(user).filter(m => m.tenantId !== tenantId);
    if (remaining.length === resolveMemberships(user).length) {
      return res.status(404).json({ error: 'Bu müşteri için üyelik bulunamadı' });
    }

    if (!remaining.length) {
      user.isActive = false;
      user.memberships = [];
      user.tenantId = null;
      user.permissions = [];
    } else {
      applyMembershipsToUser(user, remaining);
    }
    await user.save();

    await logActivity({
      req,
      type: 'user_membership_removed',
      icon: 'user-minus',
      tone: 'orange',
      text: `${user.email} müşteri erişimi kaldırıldı`,
      tenantId,
      meta: { userId: String(user._id), tenantId },
    });

    res.json({ ok: true, user: await serializeUser(user) });
  } catch (err) {
    console.error('DELETE membership', err);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/auth/users/:id — hesabı tamamen sil */
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'tenant') {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    const email = user.email;
    await User.findByIdAndDelete(req.params.id);

    await logActivity({
      req,
      type: 'user_deleted',
      icon: 'trash',
      tone: 'orange',
      text: `${email} kullanıcısı silindi`,
      meta: { userId: String(req.params.id) },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/auth/venues/:venueId/tenant { tenantId|null } — venue'yu tenant'a ata */
router.put('/venues/:venueId/tenant', requireAuth, requireAdmin, async (req, res) => {
  try {
    const Venue = require('../models/Venue');
    const { tenantId } = req.body || {};
    const venue = await Venue.findByIdAndUpdate(
      req.params.venueId,
      { $set: { tenantId: tenantId || null } },
      { new: true }
    );
    if (!venue) return res.status(404).json({ error: 'Venue bulunamadı' });

    await logActivity({
      req,
      type: 'venue_tenant_assigned',
      icon: 'link',
      tone: 'teal',
      text: tenantId
        ? `${venue.name} müşteriye atandı`
        : `${venue.name} müşteri ataması kaldırıldı`,
      venueId: venue._id,
      tenantId: tenantId || null,
    });

    res.json(venue);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
