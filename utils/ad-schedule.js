/**
 * Birim reklam zamanlaması — kiosk frontend ile aynı kurallar.
 *
 * Sheet kolonları (yeni model):
 *   AdStart  : "2026-07-01 10:00" (saat opsiyonel) — yayın başlangıcı
 *   AdEnd    : "2026-07-31 22:00" (saat opsiyonel) — yayın bitişi
 *   AdActive : TRUE/FALSE (boş = aktif) — geçici durdurma, tarihler korunur
 *
 * Geriye dönük uyumluluk: eski tek hücre `AdSchedule`
 * ("2026-07-01 10:00 -> 2026-07-31 22:00", "off ..." öneki) ve daha eski
 * AdStartDate/AdEndDate/AdStartTime/AdEndTime/AdEnabled kolonları da okunur.
 */

const DEFAULT_TZ = 'Europe/Istanbul';

function parseSheetDate(str) {
  if (str == null || str === '') return null;
  const s = String(str).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parseTimePart(str) {
  const m = String(str ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function timeToMinutes(hm) {
  const [h, m] = String(hm).split(':').map(n => parseInt(n, 10));
  return h * 60 + m;
}

function parseDateTimePart(str) {
  const s = String(str ?? '').trim();
  if (!s) return null;
  const date = parseSheetDate(s);
  if (!date) return null;
  return { date, time: parseTimePart(s) };
}

/** "TRUE"/"FALSE"/"EVET"/"HAYIR"/"1"/"0"... → bool; boş/tanınmayan → null. */
function parseBoolCell(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(false|0|no|hayır|hayir|off|kapalı|kapali|pasif)$/.test(s)) return false;
  if (/^(true|1|yes|evet|on|açık|acik|aktif)$/.test(s)) return true;
  return null;
}

function parseImages(str) {
  if (!str || typeof str !== 'string') return [];
  const s = String(str).trim();
  if (!s) return [];

  let parts = s.split(/[|\n\r]+/).map(x => x.trim()).filter(Boolean);
  if (parts.length <= 1 && s.includes(',')) {
    const comma = s.split(',').map(x => x.trim()).filter(Boolean);
    if (comma.length > 1) parts = comma;
  }
  if (parts.length === 1) {
    const blob = parts[0];
    const multi = blob.split(/(?=https?:\/\/)/i).map(x => x.trim()).filter(Boolean);
    if (multi.length > 1) parts = multi;
    else {
      const matches = blob.match(/https?:\/\/[^\s]+/gi);
      if (matches && matches.length > 1) parts = matches;
    }
  }
  return parts;
}

/** Eski tek hücre "2026-07-01 10:00 -> 2026-07-31 22:00" formatı (compat). */
function parseAdScheduleString(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;

  let enabled = true;
  const offMatch = s.match(/^off[:\s]+/i);
  if (offMatch) {
    enabled = false;
    s = s.slice(offMatch[0].length).trim();
  }
  if (!s) return null;

  const parts = s.split(/\s*(?:->|→)\s*/);
  const start = parseDateTimePart(parts[0]);
  const end = parts.length > 1 ? parseDateTimePart(parts[1]) : null;
  if (!start && !end) return null;

  return {
    startDate: start?.date || end?.date,
    endDate: end?.date || start?.date,
    startTime: start?.time || '00:00',
    endTime: end?.time || '23:59',
    enabled,
    timezone: DEFAULT_TZ
  };
}

/**
 * Satırdan zamanlama üret. Öncelik:
 *   1. AdStart/AdEnd (+AdActive)  — yeni model
 *   2. AdSchedule tek hücre       — eski model
 *   3. AdStartDate/... kolonları  — en eski model
 */
function parseAdSchedule(row = {}) {
  const start = parseDateTimePart(row.AdStart ?? row.adStart);
  const end = parseDateTimePart(row.AdEnd ?? row.adEnd);
  if (start || end) {
    const active = parseBoolCell(row.AdActive ?? row.adActive);
    return {
      startDate: start?.date || end?.date,
      endDate: end?.date || start?.date,
      startTime: start?.time || '00:00',
      endTime: end?.time || '23:59',
      enabled: active !== false,
      timezone: DEFAULT_TZ
    };
  }

  const single = parseAdScheduleString(row.AdSchedule ?? row.adSchedule);
  if (single) return single;

  const startDate = parseSheetDate(row.AdStartDate ?? row.adStartDate);
  const endDate = parseSheetDate(row.AdEndDate ?? row.adEndDate);
  if (!startDate && !endDate) return null;
  return {
    startDate: startDate || endDate,
    endDate: endDate || startDate,
    startTime: parseTimePart(row.AdStartTime ?? row.adStartTime) || '00:00',
    endTime: parseTimePart(row.AdEndTime ?? row.adEndTime) || '23:59',
    enabled: parseBoolCell(row.AdEnabled ?? row.adEnabled) !== false,
    timezone: DEFAULT_TZ
  };
}

/** Zamanlama → sheet hücreleri. Tarih varsa saat de yazılır. */
function formatAdCells(sched) {
  if (!sched?.startDate && !sched?.endDate) {
    return { AdStart: '', AdEnd: '', AdActive: '' };
  }
  const cell = (date, time, fallback) => {
    if (!date) return '';
    const t = time || fallback;
    return t ? `${date} ${t}` : date;
  };
  return {
    AdStart: cell(sched.startDate, sched.startTime, '00:00'),
    AdEnd: cell(sched.endDate, sched.endTime, '23:59'),
    AdActive: sched.enabled === false ? 'FALSE' : 'TRUE'
  };
}

function istanbulNowParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date)
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, p.value])
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10)
  };
}

/* Saatler kesintisiz aralığın sınırları: startTime ilk gün, endTime son gün uygulanır. */
function isUnitAdActive(row, now = new Date()) {
  const images = parseImages(row.Images || row.images);
  const sched = parseAdSchedule(row);
  if (!sched || sched.enabled === false || !images.length) return false;
  const { ymd, minutes } = istanbulNowParts(now);
  if (sched.startDate && ymd < sched.startDate) return false;
  if (sched.endDate && ymd > sched.endDate) return false;
  if (sched.startDate && ymd === sched.startDate
    && minutes < timeToMinutes(sched.startTime || '00:00')) return false;
  if (sched.endDate && ymd === sched.endDate
    && minutes > timeToMinutes(sched.endTime || '23:59')) return false;
  return true;
}

function mapUnitAdPayload(row) {
  const images = parseImages(row.Images || row.images);
  const adSchedule = parseAdSchedule(row);
  return {
    id: (row.ID || row.id || '').trim(),
    title: row.Title || row.title || '',
    images,
    adSchedule,
    adActive: isUnitAdActive(row),
    logo: row.Logo || null
  };
}

module.exports = {
  DEFAULT_TZ,
  parseImages,
  parseAdSchedule,
  parseAdScheduleString,
  formatAdCells,
  isUnitAdActive,
  mapUnitAdPayload,
  istanbulNowParts
};
