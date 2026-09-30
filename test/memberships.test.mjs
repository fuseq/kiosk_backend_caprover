import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveMemberships,
  membershipForTenant,
  membershipTenantIds,
  validateMembershipsInput,
  applyMembershipsToUser,
} = require('../utils/memberships');
const {
  hasPermission,
  canAccessVenue,
  effectivePermissions,
  venueFilterForUser,
} = require('../middleware/access');
const { FEATURES } = require('../constants/features');

test('legacy tenantId user resolves to a single membership', () => {
  const user = {
    role: 'tenant',
    tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    permissions: ['unit_ads', 'devices'],
    memberships: [],
  };
  const memberships = resolveMemberships(user);
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].tenantId, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(memberships[0].permissions, ['unit_ads', 'devices']);
});

test('memberships take precedence over legacy fields', () => {
  const user = {
    role: 'tenant',
    tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    permissions: ['unit_ads'],
    memberships: [
      { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', permissions: ['devices'], isActive: true },
      { tenantId: 'cccccccccccccccccccccccc', permissions: ['venue_manager'], isActive: true },
    ],
  };
  const ids = membershipTenantIds(user);
  assert.deepEqual(ids, ['bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc']);
});

test('permission checks are tenant-scoped and do not union-escalate', () => {
  const user = {
    role: 'tenant',
    memberships: [
      { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'], isActive: true },
      { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', permissions: ['unit_ads'], isActive: true },
    ],
  };

  assert.equal(hasPermission(user, FEATURES.DEVICES, { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }), true);
  assert.equal(hasPermission(user, FEATURES.DEVICES, { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }), false);
  assert.equal(hasPermission(user, FEATURES.UNIT_ADS, { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }), true);

  const venueA = { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
  const venueB = { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb' };
  assert.equal(canAccessVenue(user, venueA), true);
  assert.equal(canAccessVenue(user, venueB), true);
  assert.equal(hasPermission(user, FEATURES.DEVICES, { venue: venueB }), false);
});

test('venue filter includes all membership tenants', () => {
  const user = {
    role: 'tenant',
    memberships: [
      { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'], isActive: true },
      { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', permissions: ['unit_ads'], isActive: true },
    ],
  };
  const filter = venueFilterForUser(user);
  assert.deepEqual(filter.tenantId.$in, [
    'aaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbb',
  ]);
});

test('validateMembershipsInput rejects duplicates and empty lists', () => {
  assert.equal(validateMembershipsInput([]).ok, false);
  assert.equal(validateMembershipsInput([
    { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'] },
    { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['unit_ads'] },
  ]).ok, false);

  const ok = validateMembershipsInput([
    { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'] },
    { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', permissions: ['unit_ads', 'bogus'] },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.memberships[1].permissions.includes('bogus'), false);
});

test('applyMembershipsToUser syncs legacy primary fields', () => {
  const user = {};
  applyMembershipsToUser(user, [
    { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'] },
    { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', permissions: ['unit_ads'] },
  ]);
  assert.equal(String(user.tenantId), 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(user.permissions, ['devices']);
  assert.equal(user.memberships.length, 2);
});

test('unscoped effectivePermissions unions memberships for menu visibility', () => {
  const user = {
    role: 'tenant',
    memberships: [
      { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'], isActive: true },
      { tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', permissions: ['unit_ads'], isActive: true },
    ],
  };
  const perms = effectivePermissions(user);
  assert.ok(perms.includes('devices'));
  assert.ok(perms.includes('unit_ads'));
});

test('membershipForTenant returns null for unknown tenant', () => {
  const user = {
    role: 'tenant',
    memberships: [
      { tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', permissions: ['devices'], isActive: true },
    ],
  };
  assert.equal(membershipForTenant(user, 'bbbbbbbbbbbbbbbbbbbbbbbb'), null);
});

