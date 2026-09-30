/**
 * Kat geometrisi — backend geojson API üzerinden.
 */

import { ensureConfig, config } from '../config.js';
import { fetchGeojson } from '../core/api.js';
import { normalizeUnitId } from '../core/ids.js';

let cache = null;

function ensureFloor(feature) {
  if (!feature.properties) feature.properties = {};
  if (feature.properties.floor == null || feature.properties.floor === '') {
    feature.properties.floor = '0';
  } else {
    feature.properties.floor = String(feature.properties.floor);
  }
  return feature;
}

export async function loadVenueGeojson() {
  if (cache) return cache;

  await ensureConfig();
  const data = await fetchGeojson(config.venue.id);
  if (!data || !Array.isArray(data.features)) {
    throw new Error('Harita verisi geçersiz: features dizisi yok.');
  }

  data.features.forEach(ensureFloor);

  const rooms = data.features.filter(f => f.properties.layer === 'rooms');
  const writing = data.features.filter(f => f.properties.layer === 'writing');
  const doors = data.features.filter(f => f.properties.layer === 'doors');
  const paths = data.features.filter(f => f.properties.layer === 'paths');

  cache = {
    raw: data,
    rooms: { type: 'FeatureCollection', features: rooms },
    writing: { type: 'FeatureCollection', features: writing },
    doors: { type: 'FeatureCollection', features: doors },
    paths: { type: 'FeatureCollection', features: paths },
    bounds: computeBounds(rooms),
    floors: collectFloors(rooms),
  };
  return cache;
}

export function writingUnitId(props) {
  const first = Array.isArray(props?.lines) && props.lines.length
    ? props.lines[0]
    : String(props?.text || '').split('\n')[0];
  return normalizeUnitId(String(first || '').trim());
}

function walkCoords(coords, visit) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') {
    visit(coords[0], coords[1]);
    return;
  }
  for (const part of coords) walkCoords(part, visit);
}

function computeBounds(features) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const feature of features) {
    walkCoords(feature.geometry?.coordinates, (lng, lat) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    });
  }
  if (!Number.isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

function collectFloors(features) {
  const keys = new Set();
  for (const feature of features) keys.add(String(feature.properties.floor));
  return [...keys].sort((a, b) => Number(b) - Number(a));
}

export function floorBounds(floorKey) {
  if (!cache) return null;
  const subset = cache.rooms.features.filter(f => String(f.properties.floor) === String(floorKey));
  return computeBounds(subset.length ? subset : cache.rooms.features);
}
