/**
 * Birim alan şeması — venue-manager portu.
 */

const UNIT_FIELDS = [
  { key: 'Title', label: 'Başlık', type: 'text', required: true, visible: true, editable: true },
  { key: 'Subtitle', label: 'Alt başlık', type: 'text', visible: true, editable: true },
  { key: 'Category', label: 'Kategori', type: 'categories', visible: true, editable: true },
  { key: 'Floor', label: 'Kat', type: 'floor', visible: true, editable: true },
  { key: 'Telephone', label: 'Telefon', type: 'tel', altKeys: ['Phone'], visible: true, editable: true },
  { key: 'Web', label: 'Web sitesi', type: 'url', placeholder: 'https://', visible: true, editable: true },
  {
    key: 'Hours', label: 'Çalışma saatleri', type: 'textarea', rows: 3,
    hint: 'Örn: Pzt-Cum 10:00-22:00', visible: true, editable: true,
  },
  { key: 'Description', label: 'Açıklama', type: 'textarea', rows: 4, visible: true, editable: true },
  { key: 'Logo', label: 'Logo bağlantısı', type: 'url', placeholder: 'https://', visible: true, editable: true },
];

const DISABLED_COLUMN = 'Disabled';
const KEY_COLUMN = 'ID';
const FIELD_TYPES = new Set(['text', 'textarea', 'tel', 'url', 'email', 'number', 'floor', 'categories']);
const RESERVED_COLUMNS = new Set([
  KEY_COLUMN, DISABLED_COLUMN,
  'Images', 'AdStart', 'AdEnd', 'AdStartTime', 'AdEndTime', 'AdEnabled', 'AdActive', 'AdSchedule',
]);

const TRUTHY = new Set(['true', 'evet', 'yes', '1', 'x', 'kapali', 'kapalı', 'disabled']);

function isDisabledValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  return TRUTHY.has(String(value).trim().toLowerCase());
}

function disabledCellValue(disabled) {
  return disabled ? 'TRUE' : 'FALSE';
}

function readField(row, field) {
  if (!row) return '';
  const direct = row[field.key];
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  for (const alt of field.altKeys || []) {
    const value = row[alt];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function diffFields(before, after, fields = UNIT_FIELDS) {
  const changes = [];
  for (const field of fields) {
    if (field.editable === false) continue;
    if (!(field.key in after)) continue;
    const oldValue = readField(before, field);
    const newValue = String(after[field.key] ?? '').trim();
    if (oldValue === newValue) continue;
    changes.push({ field: field.key, label: field.label, oldValue, newValue });
  }
  return changes;
}

function normalizeUnitField(field, index = 0) {
  const key = String(field?.key || '').trim();
  const label = String(field?.label || key).trim();
  const type = FIELD_TYPES.has(field?.type) ? field.type : 'text';
  const visible = field?.visible !== false;
  return {
    key,
    label,
    type,
    required: field?.required === true,
    visible,
    editable: visible && field?.editable !== false,
    order: Number.isFinite(Number(field?.order)) ? Number(field.order) : index,
    placeholder: String(field?.placeholder || '').slice(0, 160),
    hint: String(field?.hint || '').slice(0, 240),
    rows: Math.max(2, Math.min(8, Number(field?.rows) || 3)),
    altKeys: Array.isArray(field?.altKeys)
      ? field.altKeys.map(value => String(value).trim()).filter(Boolean).slice(0, 8)
      : [],
    custom: field?.custom === true,
  };
}

function validateUnitFields(input) {
  if (!Array.isArray(input) || !input.length) {
    return { ok: false, error: 'En az bir birim alanı tanımlanmalı' };
  }
  if (input.length > 40) {
    return { ok: false, error: 'En fazla 40 birim alanı tanımlanabilir' };
  }

  const fields = input.map(normalizeUnitField);
  const keys = new Set();
  for (const field of fields) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.key)) {
      return { ok: false, error: `"${field.key}" geçersiz kolon anahtarı` };
    }
    if (!field.label) return { ok: false, error: `"${field.key}" için görünen ad gerekli` };
    if (RESERVED_COLUMNS.has(field.key)) {
      return { ok: false, error: `"${field.key}" sistem tarafından ayrılmış bir kolondur` };
    }
    if (keys.has(field.key)) return { ok: false, error: `"${field.key}" birden fazla tanımlanmış` };
    if (field.required && (!field.visible || !field.editable)) {
      return { ok: false, error: `"${field.label}" zorunluysa görünür ve düzenlenebilir olmalı` };
    }
    keys.add(field.key);
  }
  return { ok: true, fields };
}

function resolveUnitFields(venue) {
  const configured = venue?.unitAttributes;
  if (!Array.isArray(configured) || !configured.length) {
    return UNIT_FIELDS.map((field, index) => normalizeUnitField(field, index));
  }
  const validated = validateUnitFields(configured);
  return validated.ok
    ? validated.fields.sort((a, b) => a.order - b.order)
    : UNIT_FIELDS.map((field, index) => normalizeUnitField(field, index));
}

function canEditUnitStatus(venue, { isAdmin = false } = {}) {
  return isAdmin || venue?.unitStatusEditable !== false;
}

function unitTitle(row, fallbackId) {
  const title = readField(row || {}, { key: 'Title' });
  return title || fallbackId || 'İsimsiz birim';
}

module.exports = {
  UNIT_FIELDS,
  DISABLED_COLUMN,
  KEY_COLUMN,
  isDisabledValue,
  disabledCellValue,
  readField,
  diffFields,
  unitTitle,
  FIELD_TYPES,
  RESERVED_COLUMNS,
  normalizeUnitField,
  validateUnitFields,
  resolveUnitFields,
  canEditUnitStatus,
};
