import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MAX_MAP_HISTORY,
  stableStringify,
  contentFingerprint,
  planHistoryPush,
  captureMapSnapshot,
  commitMapSnapshot,
  readHistoryEntry,
  findHistoryEntry,
  historySummary,
} = require('../services/venue-map-history');

function memoryDeps({ failPut = false } = {}) {
  const files = new Map();
  return {
    files,
    objectStore: {
      async put(key, buffer) {
        if (failPut) throw new Error('disk dolu');
        files.set(key, Buffer.from(buffer));
      },
      async get(key) {
        if (!files.has(key)) throw new Error(`yok: ${key}`);
        return files.get(key);
      },
      async remove(key) { files.delete(key); },
    },
    async readStoredVenueMap(key) {
      if (!files.has(key)) throw new Error(`yok: ${key}`);
      return files.get(key).toString('utf8');
    },
  };
}

function venueWith(deps, { geo = '{"v":1}', checksum = 'c1', floorMap = { 0: 'Zemin' }, theme = 'a' } = {}) {
  deps.files.set('venue-maps/v1/venue.geojson', Buffer.from(geo));
  return {
    _id: 'v1',
    geojson: {
      storageKey: 'venue-maps/v1/venue.geojson',
      checksum,
      featureCount: 10,
      roomCount: 4,
      floors: Object.keys(floorMap),
      updatedAt: new Date('2026-09-20T10:00:00Z'),
      updatedBy: 'ayse@x.com',
    },
    kioskConfig: { config: { theme }, updatedAt: new Date() },
    mapConfig: { map: { zoom: 17 } },
    floorMap,
    mapHistory: [],
  };
}

test('stableStringify is independent of key order', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});

test('fingerprint ignores timestamps but sees map and config changes', () => {
  const deps = memoryDeps();
  const v = venueWith(deps);
  const base = contentFingerprint(v);
  v.kioskConfig.updatedAt = new Date(0);
  v.geojson.updatedBy = 'baska';
  assert.equal(contentFingerprint(v), base);
  v.floorMap = { 0: 'Zemin Kat' };
  assert.notEqual(contentFingerprint(v), base);
});

test('planHistoryPush keeps the newest MAX entries', () => {
  const { kept, dropped } = planHistoryPush([{ id: 'b' }, { id: 'c' }, { id: 'd' }], { id: 'a' });
  assert.equal(MAX_MAP_HISTORY, 3);
  assert.deepEqual(kept.map(e => e.id), ['a', 'b', 'c']);
  assert.deepEqual(dropped.map(e => e.id), ['d']);
});

test('changed content is archived with the previous map and config', async () => {
  const deps = memoryDeps();
  const v = venueWith(deps, { geo: '{"old":true}' });
  const snap = await captureMapSnapshot(v, deps);
  v.geojson = { ...v.geojson, checksum: 'c2' };
  const dropped = await commitMapSnapshot(v, snap, { reason: 'save', archivedBy: 'me' }, deps);

  assert.deepEqual(dropped, []);
  assert.equal(v.mapHistory.length, 1);
  const entry = v.mapHistory[0];
  assert.equal(entry.checksum, 'c1');
  assert.equal(entry.reason, 'save');
  assert.equal(entry.savedBy, 'ayse@x.com');
  assert.deepEqual(entry.floors, ['0']);

  const back = await readHistoryEntry(entry, deps);
  assert.equal(back.geojsonText, '{"old":true}');
  assert.deepEqual(back.content.floorMap, { 0: 'Zemin' });
  assert.deepEqual(back.content.kioskConfig.config, { theme: 'a' });
  assert.equal(findHistoryEntry(v, entry.id), entry);
  assert.equal(historySummary(entry).geojsonKey, undefined);
});

test('re-saving identical content does not create a version', async () => {
  const deps = memoryDeps();
  const v = venueWith(deps);
  const snap = await captureMapSnapshot(v, deps);
  v.kioskConfig.updatedAt = new Date();
  assert.deepEqual(await commitMapSnapshot(v, snap, {}, deps), []);
  assert.equal(v.mapHistory.length, 0);
});

test('a version identical to the newest entry is not duplicated', async () => {
  const deps = memoryDeps();
  const v = venueWith(deps);
  v.mapHistory = [{ id: 'x', checksum: 'c1', configChecksum: (await captureMapSnapshot(v, deps)).meta.configChecksum }];
  const snap = await captureMapSnapshot(v, deps);
  v.geojson = { ...v.geojson, checksum: 'c2' };
  await commitMapSnapshot(v, snap, {}, deps);
  assert.deepEqual(v.mapHistory.map(e => e.id), ['x']);
});

test('fourth change drops the oldest version', async () => {
  const deps = memoryDeps();
  const v = venueWith(deps);
  const allDropped = [];
  for (let i = 2; i <= 5; i++) {
    const snap = await captureMapSnapshot(v, deps);
    v.geojson = { ...v.geojson, checksum: `c${i}` };
    allDropped.push(...await commitMapSnapshot(v, snap, {}, deps));
  }
  assert.equal(v.mapHistory.length, 3);
  assert.deepEqual(v.mapHistory.map(e => e.checksum), ['c4', 'c3', 'c2']);
  assert.deepEqual(allDropped.map(e => e.checksum), ['c1']);
});

test('archive failure aborts the write', async () => {
  const deps = memoryDeps();
  const v = venueWith(deps);
  const snap = await captureMapSnapshot(v, deps);
  v.geojson = { ...v.geojson, checksum: 'c2' };
  const failing = { ...deps, objectStore: { ...deps.objectStore, put: async () => { throw new Error('boom'); } } };
  await assert.rejects(commitMapSnapshot(v, snap, {}, failing), (err) => err.status === 503);
  assert.equal(v.mapHistory.length, 0);
});

test('no managed map means nothing to archive', async () => {
  const deps = memoryDeps();
  assert.equal(await captureMapSnapshot({ geojson: {} }, deps), null);
  assert.deepEqual(await commitMapSnapshot({}, null, {}, deps), []);
});
