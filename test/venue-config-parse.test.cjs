const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEditorConfigSource,
  sheetsConfigComplete,
  applyVenueSheetsFromConfig,
} = require('../services/venue-config-parse');

test('parses export const config.js and extracts features.map', () => {
  const source = `
export const config = {
  venue: { floorMap: { '0': 'Zemin' } },
  features: {
    map: {
      basemap: { provider: 'openfreemap', style: 'liberty', muteOpacity: 0.15 },
      roomRenderMode: 'walls',
      wallThickness: 0.2,
      sublayerHeights: { shop: 1, walking: 0, building: 0 },
      introAnimation: { pitch: 60 },
    },
  },
};
`;
  const parsed = parseEditorConfigSource(source, 'config.js');
  assert.equal(parsed.map.basemap.provider, 'openfreemap');
  assert.equal(parsed.map.roomRenderMode, 'walls');
  assert.equal(parsed.map.sublayerHeights.shop, 1);
  assert.equal(parsed.floorMap['0'], 'Zemin');
});

test('parses Math.PI expressions in config object', () => {
  const source = `export const config = {
    features: { map: { bearing: Math.PI / 2, roomRenderMode: 'solid' } }
  };`;
  const parsed = parseEditorConfigSource(source, 'config.js');
  assert.ok(Math.abs(parsed.map.bearing - Math.PI / 2) < 1e-9);
  assert.equal(parsed.map.roomRenderMode, 'solid');
});

test('parses JSON config with features.map', () => {
  const source = JSON.stringify({
    features: { map: { roomRenderMode: 'walls', basemap: { provider: 'openfreemap' } } },
  });
  const parsed = parseEditorConfigSource(source, 'config.json');
  assert.equal(parsed.map.basemap.provider, 'openfreemap');
});

test('rejects config without features.map', () => {
  assert.throws(
    () => parseEditorConfigSource('export const config = { venue: {} };', 'config.js'),
    /features\.map/,
  );
});

test('applyVenueSheetsFromConfig: dolu editor sheets Venue.sheets’i günceller', () => {
  const venue = {
    sheets: {
      sheetId: 'OLD_SHEET',
      tabs: {
        list: 'Old_List',
        categories: 'Old_Cats',
        info: 'Info',
        changes: 'IFM_Changes',
      },
      writeEndpointUrl: 'https://old.example/exec',
      gid: '',
    },
  };
  const applied = applyVenueSheetsFromConfig(venue, {
    venue: {
      sheets: {
        sheetId: 'NEW_SHEET',
        tabs: { list: 'IFM_List', categories: 'IFM_Categories', info: 'Info' },
        writeEndpointUrl: 'https://new.example/exec',
        gid: '',
      },
    },
  });
  assert.equal(applied, true);
  assert.equal(venue.sheets.sheetId, 'NEW_SHEET');
  assert.equal(venue.sheets.tabs.list, 'IFM_List');
  assert.equal(venue.sheets.tabs.categories, 'IFM_Categories');
  assert.equal(venue.sheets.writeEndpointUrl, 'https://new.example/exec');
  assert.equal(venue.sheets.tabs.changes, 'IFM_Changes', 'editör formu changes taşımıyorsa mevcut sekme korunur');
});

test('applyVenueSheetsFromConfig: eksik sheets eski kaydı silmez', () => {
  const venue = {
    sheets: { sheetId: 'OLD_SHEET', tabs: { list: 'Old_List', changes: 'Ch' } },
  };
  assert.equal(sheetsConfigComplete({ sheetId: '', tabs: { list: 'IFM_List' } }), false);
  assert.equal(applyVenueSheetsFromConfig(venue, { venue: { sheets: { sheetId: '', tabs: { list: 'IFM_List' } } } }), false);
  assert.equal(applyVenueSheetsFromConfig(venue, { venue: {} }), false);
  assert.equal(venue.sheets.sheetId, 'OLD_SHEET');
  assert.equal(venue.sheets.tabs.list, 'Old_List');
});

test('parseEditorConfigSource: full config sheets’i korur', () => {
  const source = `
export const config = {
  venue: {
    sheets: {
      sheetId: '1NEWSheetIdxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      tabs: { list: 'IFM_List', categories: 'IFM_Categories', info: 'Info' },
      writeEndpointUrl: '',
      gid: '',
    },
    floorMap: { '0': 'Zemin' },
  },
  features: { map: { roomRenderMode: 'walls' } },
};
`;
  const parsed = parseEditorConfigSource(source, 'config.js');
  assert.equal(parsed.full.venue.sheets.sheetId, '1NEWSheetIdxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(parsed.full.venue.sheets.tabs.list, 'IFM_List');
});
