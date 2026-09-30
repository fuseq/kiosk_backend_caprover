import test from 'node:test';
import assert from 'node:assert/strict';
import { venueContentSignature } from '../utils/venue-content-signature.js';

/** Kiosk'un gördüğü tipik venue dokümanı (lean). */
function venueFixture(overrides = {}) {
  return {
    slug: 'ifm',
    geojsonPath: 'venues/ifm/map.geojson',
    geojson: { checksum: 'a0910918901c', updatedAt: new Date('2026-08-29T10:24:00Z') },
    kioskConfig: { updatedAt: new Date('2026-08-29T10:56:00Z') },
    mapConfig: { updatedAt: new Date('2026-08-20T08:00:00Z') },
    media: { logo: { checksum: '39d4be8fec0c' } },
    updatedAt: new Date('2026-08-29T10:56:00Z'),
    ...overrides,
  };
}

test('aynı içerik aynı imzayı üretir', () => {
  assert.equal(venueContentSignature(venueFixture()), venueContentSignature(venueFixture()));
});

test('imza 12 karakterlik hex', () => {
  assert.match(venueContentSignature(venueFixture()), /^[0-9a-f]{12}$/);
});

test('venue yoksa boş döner', () => {
  assert.equal(venueContentSignature(null), '');
  assert.equal(venueContentSignature(undefined), '');
});

/* Kiosk yalnızca imzanın DEĞİŞMESİNE bakıyor; içeriği etkileyen her alanın
 * imzayı oynatması şart, aksi hâlde o değişiklik ekranda hiç duyulmaz. */
test('içeriği etkileyen her alan imzayı değiştirir', () => {
  const base = venueContentSignature(venueFixture());

  const variants = {
    'harita checksum': { geojson: { checksum: 'YENI', updatedAt: new Date('2026-08-29T10:24:00Z') } },
    'harita zamanı': { geojson: { checksum: 'a0910918901c', updatedAt: new Date('2026-08-29T11:00:00Z') } },
    'harita yolu': { geojsonPath: 'venues/ifm/other.geojson' },
    'kiosk config': { kioskConfig: { updatedAt: new Date('2026-08-29T12:00:00Z') } },
    'map config': { mapConfig: { updatedAt: new Date('2026-08-21T08:00:00Z') } },
    logo: { media: { logo: { checksum: 'DEGISTI' } } },
    'venue kaydı': { updatedAt: new Date('2026-08-29T13:00:00Z') },
  };

  for (const [label, override] of Object.entries(variants)) {
    assert.notEqual(
      venueContentSignature(venueFixture(override)),
      base,
      `${label} değişince imza da değişmeli`,
    );
  }
});

/* Kiosk ardışık yoklamalarda farklı sunucu örneklerine düşebiliyor. Tarih
 * biçimlendirmesi yerel saat dilimine bağlı olsaydı, içerik hiç değişmese bile
 * imza örnekler arasında oynayıp her turda sahte tetikleme yaratırdı. */
test('imza tarih gösterimine ve saat dilimine bağlı değil', () => {
  const iso = venueContentSignature(venueFixture({
    geojson: { checksum: 'a0910918901c', updatedAt: '2026-08-29T10:24:00.000Z' },
  }));
  const date = venueContentSignature(venueFixture({
    geojson: { checksum: 'a0910918901c', updatedAt: new Date('2026-08-29T10:24:00.000Z') },
  }));
  const epoch = venueContentSignature(venueFixture({
    geojson: { checksum: 'a0910918901c', updatedAt: new Date(Date.UTC(2026, 7, 29, 10, 24)) },
  }));

  assert.equal(iso, date);
  assert.equal(date, epoch);
});

test('eksik alanlar çökmeye yol açmaz', () => {
  assert.match(venueContentSignature({ slug: 'bos' }), /^[0-9a-f]{12}$/);
  assert.match(venueContentSignature({ geojson: null, media: null }), /^[0-9a-f]{12}$/);
});
