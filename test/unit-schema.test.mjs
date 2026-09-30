import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  UNIT_FIELDS,
  validateUnitFields,
  resolveUnitFields,
  diffFields,
  canEditUnitStatus,
} = require('../utils/unit-schema');

test('uses backwards-compatible defaults when venue has no field configuration', () => {
  const fields = resolveUnitFields({ unitAttributes: [] });
  assert.equal(fields.length, UNIT_FIELDS.length);
  assert.equal(fields[0].key, 'Title');
  assert.equal(fields[0].required, true);
});

test('accepts custom venue fields and preserves visibility/editability', () => {
  const result = validateUnitFields([
    { key: 'Title', label: 'Mağaza', type: 'text', required: true },
    { key: 'InstagramUrl', label: 'Instagram', type: 'url', visible: true, editable: false },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.fields[1].key, 'InstagramUrl');
  assert.equal(result.fields[1].editable, false);
});

test('rejects reserved, duplicate and unsafe column keys', () => {
  assert.equal(validateUnitFields([{ key: 'ID', label: 'Kimlik' }]).ok, false);
  assert.equal(validateUnitFields([
    { key: 'Custom', label: 'A' },
    { key: 'Custom', label: 'B' },
  ]).ok, false);
  assert.equal(validateUnitFields([{ key: 'Bad Key', label: 'A' }]).ok, false);
});

test('required fields must be visible and editable', () => {
  const result = validateUnitFields([
    { key: 'Title', label: 'Başlık', required: true, visible: true, editable: false },
  ]);
  assert.equal(result.ok, false);
});

test('diff ignores readonly fields even if client sends a changed value', () => {
  const changes = diffFields(
    { Title: 'Eski', Secret: 'koru' },
    { Title: 'Yeni', Secret: 'değiştir' },
    [
      { key: 'Title', label: 'Başlık', editable: true },
      { key: 'Secret', label: 'Gizli', editable: false },
    ]
  );
  assert.deepEqual(changes, [
    { field: 'Title', label: 'Başlık', oldValue: 'Eski', newValue: 'Yeni' },
  ]);
});

test('unit status editing can be disabled for customers without restricting admins', () => {
  const venue = { unitStatusEditable: false };
  assert.equal(canEditUnitStatus(venue), false);
  assert.equal(canEditUnitStatus(venue, { isAdmin: true }), true);
  assert.equal(canEditUnitStatus({}), true);
});
