import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseAndValidateGeojson,
  isPrivateIp,
} = require('../services/venue-map-store');

function validMap() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { layer: 'rooms', floor: '0', id: 'shop-1' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]]],
        },
      },
      {
        type: 'Feature',
        properties: { layer: 'rooms', floor: '-1', id: 'shop-2' },
        geometry: {
          type: 'Polygon',
          coordinates: [[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]]],
        },
      },
    ],
  };
}

test('validates FeatureCollection and derives floor metadata', () => {
  const result = parseAndValidateGeojson(JSON.stringify(validMap()));
  assert.equal(result.metadata.featureCount, 2);
  assert.equal(result.metadata.roomCount, 2);
  assert.deepEqual(result.metadata.floors, ['0', '-1']);
  assert.equal(result.metadata.floorMap['0'], '0');
  assert.equal(result.metadata.floorMap['-1'], '-1');
});

test('rejects invalid JSON and collections without rooms', () => {
  assert.throws(() => parseAndValidateGeojson('{nope'), /geçerli JSON değil/);
  assert.throws(() => parseAndValidateGeojson({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { layer: 'writing' },
      geometry: { type: 'Point', coordinates: [29, 41] },
    }],
  }), /layer="rooms"/);
});

test('rejects invalid coordinates', () => {
  const map = validMap();
  map.features[0].geometry.coordinates = [[['not-a-number', 41]]];
  assert.throws(() => parseAndValidateGeojson(map), /geçersiz geometri/);
});

test('detects private and special network addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.1.1', '::1', 'fc00::1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false);
});
