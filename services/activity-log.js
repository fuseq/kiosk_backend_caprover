/**
 * Aktivite yazma yardımcısı — istek başarısını bozmaz.
 */

const Activity = require('../models/Activity');

function actorFromReq(req) {
  const user = req?.user;
  if (!user) return { actorId: null, actorEmail: '' };
  return {
    actorId: user.id || user._id ? String(user.id || user._id) : null,
    actorEmail: user.email || user.name || '',
  };
}

/**
 * @param {object} input
 * @param {string} input.type
 * @param {string} input.text
 * @param {string} [input.icon]
 * @param {string} [input.tone]
 * @param {string|import('mongoose').Types.ObjectId|null} [input.venueId]
 * @param {string|import('mongoose').Types.ObjectId|null} [input.tenantId]
 * @param {import('express').Request} [input.req]
 * @param {object} [input.meta]
 */
async function logActivity(input = {}) {
  try {
    const text = String(input.text || '').trim();
    if (!text) return null;

    const actor = input.req ? actorFromReq(input.req) : {
      actorId: input.actorId || null,
      actorEmail: input.actorEmail || '',
    };

    const doc = await Activity.create({
      type: String(input.type || 'event'),
      icon: String(input.icon || 'pulse'),
      tone: String(input.tone || 'blue'),
      text,
      venueId: input.venueId || null,
      tenantId: input.tenantId || null,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    });
    return doc;
  } catch (err) {
    console.warn('logActivity failed:', err.message);
    return null;
  }
}

/** Fire-and-forget wrapper */
function logActivityAsync(input) {
  setImmediate(() => {
    logActivity(input).catch(() => {});
  });
}

/**
 * Venue kapsamına göre son aktiviteler.
 * @param {{ venueIds?: string[], includeGlobal?: boolean, limit?: number }} opts
 */
async function listRecentActivities({ venueIds = [], includeGlobal = false, limit = 20 } = {}) {
  const ids = (venueIds || []).map(String).filter(Boolean);
  const filter = {};

  if (ids.length && includeGlobal) {
    filter.$or = [
      { venueId: { $in: ids } },
      { venueId: null },
    ];
  } else if (ids.length) {
    filter.venueId = { $in: ids };
  } else if (!includeGlobal) {
    return [];
  }

  const rows = await Activity.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(50, limit)))
    .lean();

  return rows.map((row) => ({
    type: row.type,
    icon: row.icon || 'pulse',
    tone: row.tone || 'blue',
    text: row.text,
    at: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    actorEmail: row.actorEmail || '',
    venueId: row.venueId ? String(row.venueId) : null,
  }));
}

module.exports = {
  logActivity,
  logActivityAsync,
  listRecentActivities,
  actorFromReq,
};
