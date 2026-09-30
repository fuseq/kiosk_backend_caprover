/**
 * Playback telemetry comparison helpers (sync experiment).
 */

const STALE_MS = 5000;
const DEFAULT_THRESHOLD_MS = 1000;

function mod(n, m) {
  if (!m) return 0;
  return ((n % m) + m) % m;
}

/**
 * Parse kiosk playlist signature: "slideId:5000|slideId2:8000"
 * @returns {number[]}
 */
function parsePlaylistDurations(signature) {
  if (!signature || typeof signature !== 'string') return [];
  return signature
    .split('|')
    .map((part) => {
      const idx = part.lastIndexOf(':');
      if (idx <= 0) return 0;
      return Math.max(0, Number(part.slice(idx + 1)) || 0);
    })
    .filter((dur) => dur > 0);
}

/**
 * @param {number} elapsedMs
 * @param {number[]} durations
 */
function resolvePositionFromElapsed(elapsedMs, durations) {
  if (!durations.length) {
    return { index: null, offsetMs: null, elapsedMs: null };
  }
  const totalMs = durations.reduce((sum, d) => sum + d, 0);
  const elapsed = mod(elapsedMs, totalMs);
  let cursor = 0;
  for (let i = 0; i < durations.length; i += 1) {
    const dur = durations[i];
    if (elapsed < cursor + dur || i === durations.length - 1) {
      return {
        index: i,
        offsetMs: Math.max(0, elapsed - cursor),
        elapsedMs: elapsed,
      };
    }
    cursor += dur;
  }
  return { index: 0, offsetMs: 0, elapsedMs: elapsed };
}

/**
 * Rapor anındaki pozisyonu sunucu "şimdi"sine taşır — farklı yaştaki raporlar karşılaştırılabilir olur.
 * @param {{ elapsedMs?: number|null, totalMs?: number|null, index?: number|null, offsetMs?: number|null, ageMs?: number|null, playlistSignature?: string }} row
 * @returns {{ elapsedMs: number|null, index: number|null, offsetMs: number|null, projected: boolean }}
 */
function projectPlaybackRow(row) {
  const ageMs = Number.isFinite(row.ageMs) ? Math.max(0, row.ageMs) : 0;
  const totalMs = Number(row.totalMs) || 0;
  const elapsedMs = Number(row.elapsedMs);

  if (Number.isFinite(elapsedMs) && totalMs > 0) {
    const projectedElapsed = mod(elapsedMs + ageMs, totalMs);
    const durations = parsePlaylistDurations(row.playlistSignature || '');
    if (durations.length) {
      const pos = resolvePositionFromElapsed(projectedElapsed, durations);
      return { ...pos, projected: true };
    }
    return { elapsedMs: projectedElapsed, index: row.index ?? null, offsetMs: row.offsetMs ?? null, projected: true };
  }

  if (Number.isFinite(row.offsetMs) && Number.isFinite(row.index) && ageMs > 0) {
    const durations = parsePlaylistDurations(row.playlistSignature || '');
    const dur = durations[row.index];
    if (dur > 0) {
      const localElapsed = row.offsetMs + ageMs;
      if (localElapsed < dur) {
        return {
          index: row.index,
          offsetMs: localElapsed,
          elapsedMs: null,
          projected: true,
        };
      }
    }
  }

  return {
    index: row.index ?? null,
    offsetMs: row.offsetMs ?? null,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null,
    projected: false,
  };
}

/**
 * @param {Array<object>} deviceRows - devices with optional lastPlayback
 * @param {{ thresholdMs?: number }} [opts]
 */
function compareDeviceRows(deviceRows, opts = {}) {
  const thresholdMs = Number(opts.thresholdMs) || DEFAULT_THRESHOLD_MS;
  const now = Date.now();

  const devices = (deviceRows || [])
    .map((d) => {
      const id = String(d._id || d.deviceId);
      const pb = d.lastPlayback || null;
      if (!pb || !pb.receivedAt) {
        return {
          deviceId: id,
          displayId: d.displayId || null,
          name: d.name || '',
          hasReport: false,
          ageMs: null,
          stale: true,
        };
      }
      const receivedAt = new Date(pb.receivedAt).getTime();
      const ageMs = Number.isFinite(receivedAt) ? now - receivedAt : null;
      const base = {
        deviceId: id,
        displayId: d.displayId || null,
        name: d.name || '',
        hasReport: true,
        ageMs,
        stale: ageMs == null || ageMs > STALE_MS,
        landingPageId: pb.landingPageId || null,
        playlistSignature: pb.playlistSignature || '',
        syncEnabled: Boolean(pb.syncEnabled),
        epochAt: pb.epochAt || null,
        index: pb.index,
        offsetMs: pb.offsetMs,
        totalMs: pb.totalMs,
        elapsedMs: pb.elapsedMs,
        videoCurrentSec: pb.videoCurrentSec,
        clockOffsetMs: pb.clockOffsetMs,
        mediaType: pb.mediaType || 'image',
        slideId: pb.slideId || null,
        clientReportedAt: pb.clientReportedAt || null,
        receivedAt: pb.receivedAt,
      };

      const projected = projectPlaybackRow(base);
      return {
        ...base,
        projectedIndex: projected.index,
        projectedOffsetMs: projected.offsetMs,
        projectedElapsedMs: projected.elapsedMs,
        positionProjected: projected.projected,
      };
    })
    .sort((a, b) => String(a.displayId || a.deviceId).localeCompare(String(b.displayId || b.deviceId)));

  const fresh = devices.filter((d) => d.hasReport && !d.stale && d.syncEnabled !== false);
  const withPos = fresh.filter((d) => Number.isFinite(d.projectedIndex) && Number.isFinite(d.projectedOffsetMs));
  const withElapsed = fresh.filter((d) => Number.isFinite(d.projectedElapsedMs));

  const signatures = [...new Set(withPos.map((d) => d.playlistSignature || ''))];
  const indexes = [...new Set(withPos.map((d) => d.projectedIndex))];
  const rawOffsets = fresh
    .filter((d) => Number.isFinite(d.index) && Number.isFinite(d.offsetMs))
    .map((d) => d.offsetMs);
  const projectedOffsets = withPos.map((d) => d.projectedOffsetMs);
  const projectedElapsed = withElapsed.map((d) => d.projectedElapsedMs);
  const videos = withPos
    .map((d) => d.videoCurrentSec)
    .filter((n) => Number.isFinite(n));

  const offsetSpreadMs = rawOffsets.length
    ? Math.round(Math.max(...rawOffsets) - Math.min(...rawOffsets))
    : null;
  const projectedOffsetSpreadMs = projectedOffsets.length
    ? Math.round(Math.max(...projectedOffsets) - Math.min(...projectedOffsets))
    : null;
  const projectedElapsedSpreadMs = projectedElapsed.length
    ? Math.round(Math.max(...projectedElapsed) - Math.min(...projectedElapsed))
    : null;
  const videoSpreadMs = videos.length
    ? Math.round((Math.max(...videos) - Math.min(...videos)) * 1000)
    : null;

  const spreadMs = projectedElapsedSpreadMs ?? projectedOffsetSpreadMs;
  const samePlaylist = signatures.length <= 1;
  const sameIndex = indexes.length <= 1;
  const spreadOk = spreadMs == null || spreadMs <= thresholdMs;

  let verdict = 'NO_DATA';
  if (withPos.length === 0) {
    verdict = devices.some((d) => d.hasReport) ? 'STALE' : 'NO_DATA';
  } else if (!samePlaylist) {
    verdict = 'DIFFERENT_PLAYLIST';
  } else if (!sameIndex) {
    verdict = 'DIFFERENT_SLIDE';
  } else if (!spreadOk) {
    verdict = 'DRIFT';
  } else if (withPos.length < 2) {
    verdict = 'SINGLE_DEVICE';
  } else {
    verdict = 'IN_SYNC';
  }

  return {
    serverNow: new Date(now).toISOString(),
    thresholdMs,
    staleAfterMs: STALE_MS,
    devices,
    comparison: {
      reported: devices.filter((d) => d.hasReport).length,
      fresh: fresh.length,
      compared: withPos.length,
      samePlaylist,
      sameIndex,
      playlistSignatures: signatures,
      indexes,
      offsetSpreadMs,
      projectedOffsetSpreadMs,
      projectedElapsedSpreadMs,
      spreadMs,
      videoSpreadMs,
      inSync: verdict === 'IN_SYNC',
      verdict,
      normalized: true,
    },
  };
}

module.exports = {
  compareDeviceRows,
  projectPlaybackRow,
  parsePlaylistDurations,
  resolvePositionFromElapsed,
  STALE_MS,
  DEFAULT_THRESHOLD_MS,
};
