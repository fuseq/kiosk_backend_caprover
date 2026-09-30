/**
 * Birim deposu — backend API üzerinden.
 */

import { ensureConfig, config } from '../config.js';
import { fetchUnits, saveUnit as apiSaveUnit } from '../core/api.js';
import { eventBus } from '../core/event-bus.js';
import { normalizeUnitId } from '../core/ids.js';
import {
  KEY_COLUMN, DISABLED_COLUMN, getUnitFields, setUnitFields,
  diffFields, disabledCellValue, isDisabledValue, readField, unitTitle,
} from './unit-schema.js';

let rows = [];
let index = new Map();
let missingColumns = [];
let statusEditable = true;
let loadedAt = 0;

function indexRows(list) {
  const map = new Map();
  for (const row of list) {
    const id = String(row?.[KEY_COLUMN] || row?.id || '').trim();
    if (!id) continue;
    map.set(id, row);
    const base = normalizeUnitId(id);
    if (base && !map.has(base)) map.set(base, row);
  }
  return map;
}

function snapshotToRow(snap) {
  const row = { [KEY_COLUMN]: snap.id };
  for (const field of getUnitFields()) {
    row[field.key] = snap.values?.[field.key] ?? '';
  }
  row[DISABLED_COLUMN] = disabledCellValue(!!snap.disabled);
  return row;
}

export async function loadUnits() {
  await ensureConfig();
  const data = await fetchUnits(config.venue.id);
  setUnitFields(data.schema);
  rows = (data.units || []).map(snap => snapshotToRow(snap));
  index = indexRows(rows);
  loadedAt = Date.now();
  missingColumns = data.missingColumns || [];
  statusEditable = data.statusEditable !== false;
  eventBus.emit('units:loaded', { count: index.size });
  return {
    count: rows.length,
    missingColumns: [...missingColumns],
    schema: getUnitFields(),
    availableColumns: data.availableColumns || [],
  };
}

export function isLoaded() { return loadedAt > 0; }
export function getMissingColumns() { return [...missingColumns]; }
export function canEditUnitStatus() { return statusEditable; }

export function getUnit(id) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  return index.get(raw) || index.get(normalizeUnitId(raw)) || null;
}

export function hasUnit(id) { return !!getUnit(id); }
export function allUnits() { return rows; }

export function isUnitDisabled(id) {
  const row = getUnit(id);
  return row ? isDisabledValue(row[DISABLED_COLUMN]) : false;
}

export async function saveUnit({ id, values = {}, disabled, note = '', editor = '' }) {
  await ensureConfig();
  const before = getUnit(id);
  if (!before) return { ok: false, error: `"${id}" için satır bulunamadı.` };

  const key = String(before[KEY_COLUMN] || '').trim();
  const changes = diffFields(before, values, getUnitFields());
  const wasDisabled = isDisabledValue(before[DISABLED_COLUMN]);
  if (!statusEditable && disabled !== undefined && !!disabled !== wasDisabled) {
    return { ok: false, error: 'Birim aktif/kapalı durumunu değiştirme yetkiniz yok.' };
  }
  const willDisable = disabled === undefined ? wasDisabled : !!disabled;
  const statusChanged = wasDisabled !== willDisable;
  if (!changes.length && !statusChanged) return { ok: true, noop: true, changes: [] };

  const result = await apiSaveUnit(config.venue.id, key, {
    values, disabled: willDisable, note, editor,
  });

  if (result.snapshot) {
    Object.assign(before, snapshotToRow(result.snapshot));
  }

  eventBus.emit('unit:updated', { id: key, disabled: willDisable, changes: result.changes || changes });
  return {
    ok: true,
    changes: result.changes || changes,
    disabled: willDisable,
    logWarning: result.logWarning,
  };
}

export function unitSnapshot(id) {
  const row = getUnit(id);
  if (!row) return null;
  const values = {};
  for (const field of getUnitFields()) values[field.key] = readField(row, field);
  return {
    id: String(row[KEY_COLUMN] || '').trim(),
    title: unitTitle(row, id),
    values,
    disabled: isDisabledValue(row[DISABLED_COLUMN]),
  };
}
