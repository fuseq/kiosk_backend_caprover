const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  effectivePermissions,
  resolveMemberships,
  primaryMembership,
} = require('../middleware/access');

/**
 * Production'da zayıf bir varsayılan sır, üretilmiş tüm token'ların taklit
 * edilebilmesi anlamına gelir; bu yüzden env yoksa boot'u durdur.
 */
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

const JWT_SECRET = process.env.JWT_SECRET || 'inmapper-kiosk-dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';

function signToken(user) {
  const primary = primaryMembership(user);
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      // Uyumluluk alanları — yetkilendirme DB'den yapılır
      tenantId: primary?.tenantId || (user.tenantId ? String(user.tenantId) : null),
      permissions: effectivePermissions(user),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/** Bearer token doğrula, req.user doldur (üyelikler DB'den). */
async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Oturum gerekli' });

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub).lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ error: 'Geçersiz oturum' });
    }

    const memberships = resolveMemberships(user);
    const primary = memberships[0] || null;
    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: primary?.tenantId || null,
      permissions: effectivePermissions(user),
      memberships,
      // Ham alanlar access yardımcıları için
      _raw: user,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Oturum süresi doldu veya geçersiz' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekli' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireAdmin, JWT_SECRET };
