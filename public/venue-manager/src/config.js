/**
 * Venue Manager · yapılandırma (backend gömülü sürüm)
 * Runtime: URL ?venue=slug|id&token=JWT veya sessionStorage.
 *
 * map.* alanlari editor/runtime `features.map` ile ayni varsayilanlari tasir.
 */

import { bootstrapRuntime, fetchVenueConfig, getToken } from './core/api.js';

export const config = {
  venue: {
    id: '',
    name: '',
    geojsonPath: '',
    sheets: { tabs: {}, writeEndpointUrl: 'backend' },
    floorMap: {},
  },
  map: {
    center: null,
    zoom: 17,
    pitch: 0,
    bearing: -20,
    pitch3d: 60,
    introPitch: 60,
    minZoom: 14,
    maxZoom: 23,
    tileOpacity: 0.6,
    overlayOpacity: 0.35,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    basemap: {
      provider: 'openfreemap',
      style: 'liberty',
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      removeGlobalBuildings: true,
      removeBasemapPoiIcons: true,
      muteOpacity: 0.15,
    },
    sublayerColors: {
      walking: '#f5f5f5',
      building: '#e6e6e6',
      stand: '#d9d3d2',
      service: '#e9dad0',
      food: '#d1bbbc',
      water: '#cfe2f3',
      other: '#e9dad0',
      shop: '#d9d3d2',
      green: '#a8d08d',
      medical: '#ff9999',
      commercial: '#ffe0b2',
      social: '#c5cae9',
      structure: '#d0d0d0',
    },
    sublayerHeights: {
      walking: 0,
      building: 0,
      stand: 8,
      service: 6,
      food: 1,
      water: 1,
      other: 1,
      shop: 1,
      green: 1,
      medical: 6,
      commercial: 7,
      social: 5,
      structure: 1,
      layer6: 3,
      layer7: 1,
      layer9: 3,
      layer10: 1,
      layer11: 3,
    },
    shrinkFactor: 0.99,
    roomRenderMode: 'walls',
    renderModeBySublayer: {
      layer10: 'solid',
      layer7: 'solid',
      layer6: 'walls',
      layer11: 'walls',
    },
    wallThickness: 0.2,
    wallColorMode: 'fixed',
    wallColor: '#6a6868',
    doorGaps: true,
    doorGapWidth: 1.2,
    doorGapMode: 'doors',
    disabledUnits: {
      colored: true,
      color: '#837c7c',
      showLabel: true,
    },
    defaultRoomColor: '#d9d3d2',
    walkingColor: '#f5f5f5',
    shellColor: '#e6e6e6',
    hoverColor: '#93c5fd',
    selectedColor: '#2563eb',
    disabledColor: '#837c7c',
    outlineColor: '#ffffff',
    labels: {
      enabled: true,
      font: ['Noto Sans Bold', 'Open Sans Bold'],
      minZoom: 16,
      haloColor: '#ffffff',
    },
  },
  ui: {
    island: { position: 'top-right', width: 420, margin: 20, radius: 18 },
    editorName: '',
  },
};

let bootstrapped = false;

function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) {
    return overlay === undefined ? base : overlay;
  }
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [key, value] of Object.entries(overlay)) {
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && out[key]
      && typeof out[key] === 'object'
      && !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Editor features.map → Venue Manager config.map */
function applyEditorMapConfig(editorMap) {
  if (!editorMap || typeof editorMap !== 'object') return;
  config.map = deepMerge(config.map, editorMap);
  if (editorMap.introAnimation?.pitch != null) {
    config.map.pitch3d = Number(editorMap.introAnimation.pitch) || config.map.pitch3d;
    config.map.introPitch = config.map.pitch3d;
  }
  if (editorMap.pitch != null && editorMap.introAnimation?.pitch == null) {
    /* 2D başlangıç pitch’i editor’de genelde 0; 3D için introAnimation kullanılır */
  }
  if (editorMap.bearing != null) config.map.bearing = editorMap.bearing;
  if (editorMap.zoom != null) config.map.zoom = editorMap.zoom;
  if (editorMap.center) config.map.center = editorMap.center;
  if (editorMap.cameraLimits?.minZoom != null) config.map.minZoom = editorMap.cameraLimits.minZoom;
  if (editorMap.cameraLimits?.maxZoom != null) config.map.maxZoom = editorMap.cameraLimits.maxZoom;
  if (editorMap.basemap?.glyphs) config.map.glyphs = editorMap.basemap.glyphs;
}

export async function ensureConfig() {
  if (bootstrapped) return config;
  const { venueId } = bootstrapRuntime();
  if (!venueId) throw new Error('Venue kimliği gerekli (?venue=slug)');

  const venue = await fetchVenueConfig(venueId);
  config.venue.id = String(venue._id);
  config.venue.name = venue.name;
  config.venue.geojsonPath = `/api/venues/${encodeURIComponent(config.venue.id)}/geojson`;
  config.venue.sheets.tabs = venue.sheets?.tabs || {};
  config.venue.floorMap = venue.floorMap && Object.keys(venue.floorMap).length
    ? venue.floorMap
    : { '-1': '-1. Kat', '0': 'Zemin Kat', '1': '1. Kat', '2': '2. Kat', '3': '3. Kat' };

  applyEditorMapConfig(venue.mapConfig?.map);

  bootstrapped = true;
  return config;
}

export function sheetTab(name) {
  const tabs = config.venue.sheets.tabs || {};
  const value = tabs[name];
  return value ? String(value).trim() : '';
}

export function canWrite() {
  return config.venue.sheets.writeEndpointUrl === 'backend';
}

export function switchVenue(venueId) {
  const url = new URL(window.location.href);
  url.searchParams.set('venue', venueId);
  const token = getToken();
  if (token) url.searchParams.set('token', token);
  sessionStorage.setItem('vm-venue-id', venueId);
  window.location.href = url.toString();
}

export function floorLabel(floorKey) {
  const key = floorKey == null ? '0' : String(floorKey);
  return config.venue.floorMap?.[key] || key;
}
