/**
 * Birim kaydetme — venue-manager units-repo portu (sunucu tarafı).
 */

const { fetchSheetTab, pickTab } = require('./sheets-reader');
const { upsertRows, appendRows } = require('./sheets-writer');
const {
  KEY_COLUMN,
  DISABLED_COLUMN,
  diffFields,
  disabledCellValue,
  isDisabledValue,
  readField,
  unitTitle,
  resolveUnitFields,
  canEditUnitStatus,
} = require('../utils/unit-schema');

function listTab(venue) {
  return pickTab(venue.sheets, 'list', 'gid') || venue.sheets?.tabs?.list;
}

function changesTab(venue) {
  return pickTab(venue.sheets, 'changes') || venue.sheets?.tabs?.changes;
}

function categoriesTab(venue) {
  return pickTab(venue.sheets, 'categories') || venue.sheets?.tabs?.categories;
}

function timestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function findRow(rows, unitId) {
  const id = String(unitId || '').trim();
  return rows.find(r => String(r[KEY_COLUMN] || r.id || '').trim() === id);
}

async function loadUnits(venue) {
  const tab = listTab(venue);
  if (!venue.sheets?.sheetId || !tab) {
    throw new Error('Venue sheetId or list tab missing');
  }
  const rows = await fetchSheetTab(venue.sheets.sheetId, tab);
  const fields = resolveUnitFields(venue);
  const headers = new Set(Object.keys(rows[0] || {}));
  const criticalFields = fields.filter(field => field.required);
  const expected = [KEY_COLUMN, DISABLED_COLUMN, ...criticalFields.map(field => field.key)];
  const missingColumns = expected.filter(key => {
    if (headers.has(key)) return false;
    const field = criticalFields.find(item => item.key === key);
    return !field || !(field.altKeys || []).some(alt => headers.has(alt));
  });
  return {
    rows,
    fields,
    missingColumns,
    availableColumns: [...headers],
  };
}

function pickCell(row, ...names) {
  for (const name of names) {
    const value = row?.[name];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeCategoryRow(row) {
  const apiKey = pickCell(row, 'Category', 'category', 'key', 'Key', 'ID', 'id');
  if (!apiKey) return null;
  const order = Number(pickCell(row, 'Order', 'order'));
  const displayName = pickCell(row, 'DisplayName_TR', 'displayName_TR', 'Cat_TR', 'cat_tr', 'DisplayName', 'Name', 'name')
    || apiKey.charAt(0).toUpperCase() + apiKey.slice(1);
  return {
    apiKey,
    color: pickCell(row, 'Color', 'color') || '#95a5a6',
    displayName,
    displayNameEn: pickCell(row, 'DisplayName_EN', 'displayName_EN') || displayName,
    icon: pickCell(row, 'Icon', 'icon'),
    order: Number.isFinite(order) ? order : 999,
  };
}

async function loadCategories(venue) {
  const tab = categoriesTab(venue);
  if (!venue.sheets?.sheetId || !tab) return [];
  const rows = await fetchSheetTab(venue.sheets.sheetId, tab);
  return rows.map(normalizeCategoryRow).filter(Boolean);
}

function unitSnapshot(row, fallbackId, fields = []) {
  if (!row) return null;
  const values = {};
  for (const field of fields) values[field.key] = readField(row, field);
  const id = String(row[KEY_COLUMN] || '').trim();
  return {
    id,
    title: unitTitle(row, fallbackId),
    values,
    disabled: isDisabledValue(row[DISABLED_COLUMN]),
  };
}

async function appendChangeLog(venue, { key, before, changes, statusChanged, willDisable, note, editor }) {
  const tab = changesTab(venue);
  if (!tab) return 'Değişiklik günlüğü sekmesi tanımlı değil; kayıt tutulamadı.';
  if (!venue.sheets.writeEndpointUrl) return 'Yazma ucu tanımlı değil.';

  const now = timestamp();
  const title = unitTitle(before, key);
  const base = { Timestamp: now, UnitID: key, UnitTitle: title, Editor: editor || '—', Note: note || '' };

  const logRows = changes.map(change => ({
    ...base,
    Action: 'update',
    Field: change.field,
    OldValue: change.oldValue,
    NewValue: change.newValue,
  }));

  if (statusChanged) {
    logRows.push({
      ...base,
      Action: willDisable ? 'disable' : 'enable',
      Field: DISABLED_COLUMN,
      OldValue: disabledCellValue(!willDisable),
      NewValue: disabledCellValue(willDisable),
    });
  }

  if (!logRows.length) return '';

  try {
    await appendRows({
      writeEndpointUrl: venue.sheets.writeEndpointUrl,
      sheetId: venue.sheets.sheetId,
      tab,
      rows: logRows,
    });
    return '';
  } catch (err) {
    return `Değişiklik kaydedildi ancak günlüğe yazılamadı: ${err.message}`;
  }
}

async function saveUnit(
  venue,
  { id, values = {}, disabled, note = '', editor = '' },
  { allowStatusEdit = canEditUnitStatus(venue) } = {}
) {
  const { rows, fields } = await loadUnits(venue);
  const before = findRow(rows, id);
  if (!before) return { ok: false, error: `"${id}" için Sheets satırı bulunamadı.` };

  const key = String(before[KEY_COLUMN] || '').trim();
  const missingRequired = fields.find(field => {
    if (!field.required) return false;
    const value = Object.prototype.hasOwnProperty.call(values, field.key)
      ? values[field.key]
      : readField(before, field);
    return !String(value ?? '').trim();
  });
  if (missingRequired) {
    return { ok: false, error: `"${missingRequired.label}" alanı boş bırakılamaz.` };
  }
  const changes = diffFields(before, values, fields);
  const wasDisabled = isDisabledValue(before[DISABLED_COLUMN]);
  if (!allowStatusEdit
      && disabled !== undefined
      && !!disabled !== wasDisabled) {
    return { ok: false, error: 'Birim aktif/kapalı durumunu değiştirme yetkiniz yok.' };
  }
  const willDisable = disabled === undefined ? wasDisabled : !!disabled;
  const statusChanged = wasDisabled !== willDisable;

  if (!changes.length && !statusChanged) return { ok: true, noop: true, changes: [] };

  if (!venue.sheets.writeEndpointUrl) {
    return { ok: false, error: 'Venue sheets.writeEndpointUrl tanımlı değil.' };
  }

  const patch = { [KEY_COLUMN]: key };
  for (const change of changes) patch[change.field] = change.newValue;
  if (statusChanged) patch[DISABLED_COLUMN] = disabledCellValue(willDisable);

  await upsertRows({
    writeEndpointUrl: venue.sheets.writeEndpointUrl,
    sheetId: venue.sheets.sheetId,
    tab: listTab(venue),
    rows: [patch],
  });

  const logWarning = await appendChangeLog(venue, {
    key, before, changes, statusChanged, willDisable, note, editor,
  });

  return {
    ok: true,
    changes,
    disabled: willDisable,
    logWarning: logWarning || undefined,
    snapshot: unitSnapshot({ ...before, ...patch }, key, fields),
  };
}

module.exports = {
  listTab,
  loadUnits,
  loadCategories,
  unitSnapshot,
  saveUnit,
  findRow,
};
