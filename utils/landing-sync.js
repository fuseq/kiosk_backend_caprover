/**
 * Landing page clock-sync helpers (server-side epoch + playlist shaping).
 */

/**
 * UTC ms for local midnight on the calendar day of `now` in `timeZone`.
 */
function startOfDayInTimeZone(now, timeZone) {
  const tz = timeZone || 'Europe/Istanbul';
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const utcGuess = Date.parse(`${datePart}T00:00:00.000Z`);
  if (!Number.isFinite(utcGuess)) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  // Find offset (hours) such that wall clock at candidate is datePart 00:00
  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const candidate = utcGuess - offsetMin * 60 * 1000;
    const wallDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(candidate));
    const wallTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(candidate));
    if (wallDate === datePart && wallTime === '00:00:00') return candidate;
  }

  // Istanbul-style fixed +3 fallback for datePart
  return utcGuess - 3 * 3600 * 1000;
}

function resolveSyncEpochMs(sync, landingPage, timezone = 'Europe/Istanbul', now = new Date()) {
  const mode = sync?.epochMode || 'midnight';

  if (mode === 'absolute' && sync?.epochAt) {
    const t = new Date(sync.epochAt).getTime();
    if (Number.isFinite(t)) return t;
  }

  if (mode === 'campaignStart') {
    const start = landingPage?.schedule?.startDate || landingPage?.createdAt;
    if (start) {
      const t = new Date(start).getTime();
      if (Number.isFinite(t)) return t;
    }
  }

  return startOfDayInTimeZone(now, timezone || 'Europe/Istanbul');
}

function playlistSignature(slides) {
  if (!Array.isArray(slides) || !slides.length) return '';
  return slides
    .map((s) => `${s.id || s.imageUrl || ''}:${Number(s.durationMs) || 0}`)
    .join('|');
}

function mapSyncSlides(rawSlides, transitionDuration, { deviceAspect, groupIds, now }) {
  const fallbackDuration = Math.max(1000, Number(transitionDuration) || 8000);
  const gids = (groupIds || []).map(String);
  const at = now instanceof Date ? now : new Date();

  return (rawSlides || [])
    .filter((slide) => {
      if (slide.isActive === false) return false;
      const sStart = slide.schedule?.startDate;
      const sEnd = slide.schedule?.endDate;
      if (sStart && at < new Date(sStart)) return false;
      if (sEnd && at > new Date(sEnd)) return false;
      if (deviceAspect && slide.aspectRatio && slide.aspectRatio !== deviceAspect) return false;
      const tg = slide.targetGroupIds || [];
      if (tg.length && !tg.some((id) => gids.includes(String(id)))) return false;
      return true;
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((slide, index) => {
      const mediaType = slide.mediaType === 'video' ? 'video' : 'image';
      const own = Number(slide.durationMs);
      const durationMs = Number.isFinite(own) && own >= 1000
        ? Math.min(600000, Math.round(own))
        : fallbackDuration;
      return {
        id: String(slide._id || slide.id || `slide-${index}`),
        imageUrl: slide.imageUrl,
        mediaType,
        title: slide.title || '',
        description: slide.description || '',
        aspectRatio: slide.aspectRatio || '',
        order: slide.order != null ? slide.order : index,
        durationMs,
        schedule: {
          startDate: slide.schedule?.startDate || null,
          endDate: slide.schedule?.endDate || null,
        },
      };
    });
}

function buildSyncPayload(landingPage, slides, timezone) {
  const sync = landingPage.sync || {};
  if (!sync.enabled) {
    return { enabled: false };
  }
  const epochMs = resolveSyncEpochMs(sync, landingPage, timezone);
  return {
    enabled: true,
    epochMode: sync.epochMode || 'midnight',
    epochAt: new Date(epochMs).toISOString(),
    tickMs: Math.min(2000, Math.max(100, Number(sync.tickMs) || 250)),
    playlistSignature: playlistSignature(slides),
    timezone: timezone || 'Europe/Istanbul',
  };
}

function normalizeSyncInput(bodySync) {
  if (!bodySync || typeof bodySync !== 'object') {
    return { enabled: false, epochMode: 'midnight', epochAt: null, tickMs: 250 };
  }
  const epochMode = ['midnight', 'campaignStart', 'absolute'].includes(bodySync.epochMode)
    ? bodySync.epochMode
    : 'midnight';
  return {
    enabled: Boolean(bodySync.enabled),
    epochMode,
    epochAt: bodySync.epochAt ? new Date(bodySync.epochAt) : null,
    tickMs: Math.min(2000, Math.max(100, Number(bodySync.tickMs) || 250)),
  };
}

/** Sync + per-slide targetGroupIds is unsupported (different playlists). */
function assertSyncCompatibleSlides(sync, slides) {
  if (!sync?.enabled) return null;
  const blocked = (slides || []).some((s) => Array.isArray(s.targetGroupIds) && s.targetGroupIds.length);
  if (blocked) {
    return 'Senkron açıkken slide bazlı hedef grup kullanılamaz — tüm cihazlar aynı playlist’i oynamalı.';
  }
  return null;
}

module.exports = {
  startOfDayInTimeZone,
  resolveSyncEpochMs,
  playlistSignature,
  mapSyncSlides,
  buildSyncPayload,
  normalizeSyncInput,
  assertSyncCompatibleSlides,
};
