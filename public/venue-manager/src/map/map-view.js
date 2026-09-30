/**
 * Harita gorunumu — editor/runtime map-renderer ile ayni yaklasim:
 * OpenFreeMap liberty + rooms-flat / rooms-extruded + pitch ile 2D/3D.
 * Bu arac yalnizca Title'i olan birimleri secer ve etiketler.
 */

import { config } from '../config.js';
import { normalizeUnitId } from '../core/ids.js';
import { categoryColor } from '../data/categories.js';
import { getUnit, isUnitDisabled } from '../data/units-repo.js';
import { readField, parseCategories } from '../data/unit-schema.js';
import { isUnitFeature, isNonInteractiveFloorUnit, normalizeRoomFeatureId, isWalkingArea, isBuildingShell } from './unit-utils.js';
import { loadVenueGeojson, writingUnitId, floorBounds } from './venue-geojson.js';
import {
    buildRoomSourceData,
    buildHeightExpr,
    buildColorExprs,
    detectShellIds,
} from './room-sources.js';

const FLAT_SOURCE = 'rooms-flat';
const EXTR_SOURCE = 'rooms-extruded';
const PLAN_SOURCE = 'rooms-plan';
const LABEL_SOURCE = 'labels';
const FLOOR_LAYER = 'rooms-floor';
const HIT_LAYER = 'rooms-fill-hit';
const EXTR_LAYER = 'rooms-3d';
const PLAN_FILL = 'rooms-plan-fill';
const PLAN_OUTLINE = 'rooms-plan-outline';
const LABEL_LAYER = 'labels';

const HIT_LAYERS_2D = [PLAN_FILL];
const HIT_LAYERS_3D = [EXTR_LAYER, HIT_LAYER];
const FLOOR_FILTERED = [
    FLOOR_LAYER, HIT_LAYER, EXTR_LAYER,
    PLAN_FILL, PLAN_OUTLINE,
    LABEL_LAYER,
];

const PLAN_FILL_OPACITY_EXPR = [
    'case',
    ['==', ['get', '__unit'], 1],
    ['case', ['==', ['get', '__hasRow'], 0], 0.55, 1],
    1,
];

const VIEW_TRANSITION_MS = 700;

const OFM_STYLE_URLS = {
    liberty: 'https://tiles.openfreemap.org/styles/liberty',
    bright: 'https://tiles.openfreemap.org/styles/bright',
    positron: 'https://tiles.openfreemap.org/styles/positron',
};

let _ofmStyleCache = null;

function cssVar(name, fallback) {
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    } catch {
        return fallback;
    }
}

function inlineOsmStyle() {
    const mapCfg = config.map;
    return {
        version: 8,
        sources: {
            'osm-tiles': {
                type: 'raster',
                tiles: [
                    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
                ],
                tileSize: 256,
                maxzoom: 19,
                attribution: '© OpenStreetMap',
            },
        },
        layers: [
            {
                id: 'osm-tiles-layer',
                type: 'raster',
                source: 'osm-tiles',
                paint: { 'raster-opacity': mapCfg.tileOpacity ?? 0.6 },
            },
            {
                id: 'white-overlay',
                type: 'background',
                paint: {
                    'background-color': cssVar('--map-mute', '#ffffff'),
                    'background-opacity': mapCfg.overlayOpacity ?? 0.35,
                },
            },
        ],
        glyphs: mapCfg.basemap?.glyphs || mapCfg.glyphs
            || 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    };
}

async function resolveBasemapStyle() {
    const bm = config.map.basemap || {};
    if (bm.provider !== 'openfreemap') return inlineOsmStyle();

    if (!_ofmStyleCache) {
        const url = OFM_STYLE_URLS[bm.style] || OFM_STYLE_URLS.liberty;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const style = await res.json();
            if (bm.glyphs) style.glyphs = bm.glyphs;

            if (bm.removeGlobalBuildings !== false) {
                style.layers = (style.layers || []).filter((l) =>
                    !(l['source-layer'] === 'building' || /building/i.test(l.id || '')));
            }
            if (bm.removeBasemapPoiIcons !== false) {
                style.layers = (style.layers || []).filter((l) =>
                    !(l.type === 'symbol' && l.layout && l.layout['icon-image']));
            }

            const mute = bm.muteOpacity ?? 0;
            if (mute > 0) {
                style.layers.push({
                    id: 'basemap-mute',
                    type: 'background',
                    paint: {
                        'background-color': '#ffffff',
                        'background-opacity': mute,
                    },
                });
            }
            _ofmStyleCache = style;
        } catch (err) {
            console.warn('[vm-map] OpenFreeMap yüklenemedi → OSM raster', err);
            return inlineOsmStyle();
        }
    }
    return JSON.parse(JSON.stringify(_ofmStyleCache));
}

function floorFilter(floorKey) {
    return ['==', ['coalesce', ['to-string', ['get', 'floor']], '0'], String(floorKey)];
}

function highlightCases(baseColor, { skipWalls = false } = {}) {
    const hoverColor = config.map.hoverColor || '#93c5fd';
    const selectedColor = config.map.selectedColor || '#2563eb';
    const guard = (cond) => (skipWalls ? ['all', ['!=', ['get', '__wall'], 1], cond] : cond);
    return [
        'case',
        guard(['boolean', ['feature-state', 'selected'], false]), selectedColor,
        guard(['boolean', ['feature-state', 'hover'], false]), hoverColor,
        baseColor,
    ];
}

/**
 * Editor config'te labels.minZoom = { sm, md, lg } nesnesidir;
 * MapLibre layer minzoom ise düz sayi ister.
 */
function resolveLabelMinZoom(labelsCfg) {
    const mz = labelsCfg?.minZoom;
    if (typeof mz === 'number' && Number.isFinite(mz)) return mz;
    if (mz && typeof mz === 'object') {
        const n = Number(mz.sm ?? mz.md ?? mz.lg);
        if (Number.isFinite(n)) return n;
    }
    return 16;
}

function resolveLabelFont(labelsCfg) {
    if (Array.isArray(labelsCfg?.font) && labelsCfg.font.length) return labelsCfg.font;
    return ['Noto Sans Bold', 'Open Sans Bold'];
}

function resolveLabelSizeStops(labelsCfg) {
    const minz = resolveLabelMinZoom(labelsCfg);
    const scale = Number(labelsCfg?.sizeScale);
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return [
        minz, Math.round(10 * s),
        Math.max(minz + 4, 20), Math.round(14 * s),
    ];
}

/** Sheets Title alani — bos ise etiket/secim yok (editor kurali). */
function sheetDisplayTitle(unitId) {
    const row = getUnit(unitId);
    if (!row) return '';
    return String(readField(row, { key: 'Title' }) || '').trim();
}

function isSheetDisabled(props) {
    const id = normalizeUnitId(props?.id);
    if (id && getUnit(id)) return isUnitDisabled(id);
    const v = props?.disabled;
    return v === true || v === 1 || v === '1' || v === 'true';
}

export function createMapView({ container, onSelect, onDeselect }) {
    let map = null;
    let geo = null;
    let shellIds = new Set();
    let currentFloor = null;
    let selectedId = null;
    let hoveredId = null;
    let viewMode = '2d';
    let viewTransitionToken = 0;
    let viewModeOpacities = { plan: 1, outline: 1, extr: 0, floor: 0 };

    function colorForRoom(props) {
        if (!isUnitFeature(props, shellIds)) {
            return config.map.sublayerColors?.[props.sublayer]
                || config.map.shellColor
                || '#e8ebf0';
        }
        const id = normalizeUnitId(props.id);
        const row = getUnit(id);
        if (!row) {
            return config.map.sublayerColors?.[props.sublayer]
                || config.map.defaultRoomColor
                || '#d9dde3';
        }
        if (isUnitDisabled(id)) return config.map.disabledColor || '#837c7c';

        const primary = parseCategories(readField(row, { key: 'Category' }))[0];
        return categoryColor(primary)
            || config.map.sublayerColors?.[props.sublayer]
            || config.map.defaultRoomColor;
    }

    function stampRoomProps() {
        for (const feature of geo.rooms.features) {
            const props = feature.properties;
            const id = normalizeUnitId(props.id);
            const unit = isUnitFeature(props, shellIds);
            const title = unit ? sheetDisplayTitle(id) : '';
            props.__unit = unit ? 1 : 0;
            props.__selectable = unit && title ? 1 : 0;
            props.__hasRow = unit && getUnit(id) ? 1 : 0;
            props.__disabled = unit && isSheetDisabled(props) ? 1 : 0;
            props.__color = colorForRoom(props);

            if (unit && getUnit(id)) {
                const primary = parseCategories(readField(getUnit(id), { key: 'Category' }))[0];
                if (primary) props.primaryCategory = primary;
            }
        }
    }

    function buildLabelCollection() {
        const features = [];
        for (const feature of geo.writing.features) {
            const props = feature.properties || {};
            const id = writingUnitId(props);
            const title = sheetDisplayTitle(id);
            if (!title) continue;
            if (isUnitDisabled(id) && !(config.map.disabledUnits?.colored && config.map.disabledUnits?.showLabel)) {
                continue;
            }
            const room = geo.rooms.features.find((f) =>
                normalizeUnitId(f.properties?.id) === normalizeUnitId(id));
            features.push({
                ...feature,
                properties: {
                    ...props,
                    __unitId: id,
                    __text: title,
                    __disabled: isUnitDisabled(id) ? 1 : 0,
                    floor: props.floor ?? room?.properties?.floor ?? '0',
                },
            });
        }
        return { type: 'FeatureCollection', features };
    }

    function rebuildSources() {
        shellIds = detectShellIds(geo.rooms.features);
        stampRoomProps();

        const { flatFeatures, extrudedFeatures } = buildRoomSourceData(
            geo.rooms.features,
            config.map,
            geo.doors?.features || [],
            geo.paths?.features || [],
            isSheetDisabled,
        );

        const mergeStamp = (f) => {
            const src = geo.rooms.features.find((r) =>
                String(r.properties?.id) === String(f.properties?.id)
                || normalizeRoomFeatureId(r.properties?.id) === normalizeRoomFeatureId(f.properties?.id));
            if (!src) return f;
            return {
                ...f,
                properties: {
                    ...f.properties,
                    __color: src.properties.__color,
                    __selectable: src.properties.__selectable,
                    __unit: f.properties.__unit ?? src.properties.__unit,
                    __disabled: f.properties.__disabled ?? src.properties.__disabled,
                },
            };
        };

        return {
            flat: { type: 'FeatureCollection', features: flatFeatures.map(mergeStamp) },
            extruded: { type: 'FeatureCollection', features: extrudedFeatures.map(mergeStamp) },
            plan: { type: 'FeatureCollection', features: geo.rooms.features },
            labels: buildLabelCollection(),
        };
    }

    function repaint() {
        if (!map || !geo) return;
        const { flat, extruded, plan, labels } = rebuildSources();
        map.getSource(FLAT_SOURCE)?.setData(flat);
        map.getSource(EXTR_SOURCE)?.setData(extruded);
        map.getSource(PLAN_SOURCE)?.setData(plan);
        map.getSource(LABEL_SOURCE)?.setData(labels);
        applyPaintExprs();
    }

    function applyPaintExprs() {
        if (!map) return;
        const { floorColor, extrColor } = buildColorExprs(config.map, true);
        if (map.getLayer(FLOOR_LAYER)) {
            map.setPaintProperty(FLOOR_LAYER, 'fill-color', highlightCases(floorColor));
        }
        if (map.getLayer(PLAN_FILL)) {
            map.setPaintProperty(PLAN_FILL, 'fill-color', highlightCases(['get', '__color']));
        }
        if (map.getLayer(EXTR_LAYER)) {
            map.setPaintProperty(EXTR_LAYER, 'fill-extrusion-color', highlightCases(extrColor, { skipWalls: true }));
            map.setPaintProperty(EXTR_LAYER, 'fill-extrusion-height', buildHeightExpr(config.map.sublayerHeights));
        }
    }

    function addLayers(initial) {
        map.addSource(FLAT_SOURCE, { type: 'geojson', data: initial.flat, promoteId: 'id' });
        map.addSource(EXTR_SOURCE, { type: 'geojson', data: initial.extruded, promoteId: 'id' });
        map.addSource(PLAN_SOURCE, { type: 'geojson', data: initial.plan, promoteId: 'id' });
        map.addSource(LABEL_SOURCE, { type: 'geojson', data: initial.labels });

        const { floorColor, extrColor } = buildColorExprs(config.map, true);

        map.addLayer({
            id: PLAN_FILL,
            type: 'fill',
            source: PLAN_SOURCE,
            paint: {
                'fill-color': highlightCases(['get', '__color']),
                'fill-opacity': PLAN_FILL_OPACITY_EXPR,
            },
        });
        map.addLayer({
            id: PLAN_OUTLINE,
            type: 'line',
            source: PLAN_SOURCE,
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], config.map.selectedColor || '#2563eb',
                    ['==', ['get', '__unit'], 1], config.map.outlineColor || '#ffffff',
                    cssVar('--map-outline-base', '#d5dae1'),
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false], 2.5,
                    ['==', ['get', '__unit'], 1], 1.2,
                    1,
                ],
                'line-opacity': 1,
            },
        });

        /* 3D: walking/shell + walls zemin — başlangıçta görünmez (opacity 0). */
        map.addLayer({
            id: FLOOR_LAYER,
            type: 'fill',
            source: FLAT_SOURCE,
            paint: {
                'fill-color': highlightCases(floorColor),
                'fill-opacity': 0,
            },
        });

        map.addLayer({
            id: HIT_LAYER,
            type: 'fill',
            source: FLAT_SOURCE,
            filter: ['==', ['get', '__unit'], 1],
            paint: {
                'fill-color': '#000000',
                'fill-opacity': 0.01,
            },
        });

        map.addLayer({
            id: EXTR_LAYER,
            type: 'fill-extrusion',
            source: EXTR_SOURCE,
            paint: {
                'fill-extrusion-color': highlightCases(extrColor, { skipWalls: true }),
                'fill-extrusion-height': buildHeightExpr(config.map.sublayerHeights),
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0,
                'fill-extrusion-vertical-gradient': true,
            },
        });

        if (config.map.labels?.enabled !== false) {
            const labelsCfg = config.map.labels || {};
            const minz = resolveLabelMinZoom(labelsCfg);
            const sizeStops = resolveLabelSizeStops(labelsCfg);
            map.addLayer({
                id: LABEL_LAYER,
                type: 'symbol',
                source: LABEL_SOURCE,
                minzoom: minz,
                layout: {
                    'text-field': ['get', '__text'],
                    'text-font': resolveLabelFont(labelsCfg),
                    'text-size': [
                        'interpolate', ['linear'], ['zoom'],
                        sizeStops[0], sizeStops[1],
                        sizeStops[2], sizeStops[3],
                    ],
                    'text-max-width': 9,
                    'text-allow-overlap': labelsCfg.collisionEnabled === false,
                    'text-ignore-placement': labelsCfg.collisionEnabled === false,
                    'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'room_area'], 0]],
                    'text-pitch-alignment': labelsCfg.pitchAlignment === 'map' ? 'map' : 'viewport',
                },
                paint: {
                    'text-color': [
                        'case',
                        ['==', ['get', '__disabled'], 1],
                        cssVar('--map-label-disabled', '#6b7280'),
                        labelsCfg.textColor || cssVar('--map-label', '#1f2937'),
                    ],
                    'text-halo-color': labelsCfg.haloColor || cssVar('--map-label-halo', '#ffffff'),
                    'text-halo-width': 1.6,
                    'text-halo-blur': Number(labelsCfg.haloBlur) || 0,
                },
            });
        }

        applyViewMode({ animate: false });
    }

    function easeOutQuad(t) {
        return t * (2 - t);
    }

    function readOpacity(layerId, prop, fallback) {
        if (!map.getLayer(layerId)) return fallback;
        const value = map.getPaintProperty(layerId, prop);
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    }

    /**
     * 2D ↔ 3D: pitch + opacity crossfade (visibility snap yok → refresh hissi yok).
     */
    function applyViewMode({ animate = true } = {}) {
        if (!map) return;
        const is3d = viewMode === '3d';
        const duration = animate ? VIEW_TRANSITION_MS : 0;
        const token = ++viewTransitionToken;

        map.dragRotate[is3d ? 'enable' : 'disable']();
        map.touchPitch?.[is3d ? 'enable' : 'disable']?.();

        const from = {
            extr: readOpacity(EXTR_LAYER, 'fill-extrusion-opacity', is3d ? 0 : 0.92),
            floor: readOpacity(FLOOR_LAYER, 'fill-opacity', is3d ? 0 : 0.9),
            plan: viewModeOpacities.plan,
            outline: viewModeOpacities.outline,
        };
        const to = {
            extr: is3d ? 0.92 : 0,
            floor: is3d ? 0.9 : 0,
            plan: is3d ? 0 : 1,
            outline: is3d ? 0 : 1,
        };

        const pitchTarget = is3d ? (config.map.pitch3d ?? config.map.introPitch ?? 60) : 0;
        if (duration > 0) {
            map.easeTo({
                pitch: pitchTarget,
                duration,
                easing: easeOutQuad,
            });
        } else {
            map.jumpTo({ pitch: pitchTarget });
        }

        const finish = () => {
            if (token !== viewTransitionToken) return;
            viewModeOpacities = { ...to };
            if (map.getLayer(EXTR_LAYER)) {
                map.setPaintProperty(EXTR_LAYER, 'fill-extrusion-opacity', to.extr);
            }
            if (map.getLayer(FLOOR_LAYER)) {
                map.setPaintProperty(FLOOR_LAYER, 'fill-opacity', to.floor);
            }
            if (map.getLayer(PLAN_FILL)) {
                map.setPaintProperty(
                    PLAN_FILL,
                    'fill-opacity',
                    is3d ? 0 : PLAN_FILL_OPACITY_EXPR,
                );
            }
            if (map.getLayer(PLAN_OUTLINE)) {
                map.setPaintProperty(PLAN_OUTLINE, 'line-opacity', to.outline);
            }
        };

        if (duration <= 0) {
            finish();
            return;
        }

        const t0 = performance.now();
        const tick = (now) => {
            if (token !== viewTransitionToken) return;
            const t = Math.min(1, (now - t0) / duration);
            const e = easeOutQuad(t);
            const lerp = (a, b) => a + (b - a) * e;
            if (map.getLayer(EXTR_LAYER)) {
                map.setPaintProperty(EXTR_LAYER, 'fill-extrusion-opacity', lerp(from.extr, to.extr));
            }
            if (map.getLayer(FLOOR_LAYER)) {
                map.setPaintProperty(FLOOR_LAYER, 'fill-opacity', lerp(from.floor, to.floor));
            }
            if (map.getLayer(PLAN_FILL)) {
                map.setPaintProperty(PLAN_FILL, 'fill-opacity', lerp(from.plan, to.plan));
            }
            if (map.getLayer(PLAN_OUTLINE)) {
                map.setPaintProperty(PLAN_OUTLINE, 'line-opacity', lerp(from.outline, to.outline));
            }
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                finish();
            }
        };
        requestAnimationFrame(tick);
    }

    function setViewMode(mode) {
        const next = mode === '3d' ? '3d' : '2d';
        if (next === viewMode) return viewMode;
        viewMode = next;
        applyViewMode({ animate: true });
        return viewMode;
    }

    function getViewMode() {
        return viewMode;
    }

    function applyThemePaint() {
        if (!map) return;
        const muteColor = cssVar('--map-mute', '#ffffff');
        const muteOpacity = Number(cssVar('--map-mute-opacity', ''))
            || config.map.basemap?.muteOpacity
            || config.map.overlayOpacity
            || 0.15;
        if (map.getLayer('basemap-mute')) {
            map.setPaintProperty('basemap-mute', 'background-color', muteColor);
            map.setPaintProperty('basemap-mute', 'background-opacity', muteOpacity);
        }
        if (map.getLayer('white-overlay')) {
            map.setPaintProperty('white-overlay', 'background-color', muteColor);
        }
        if (map.getLayer(LABEL_LAYER)) {
            map.setPaintProperty(LABEL_LAYER, 'text-color', [
                'case',
                ['==', ['get', '__disabled'], 1],
                cssVar('--map-label-disabled', '#6b7280'),
                cssVar('--map-label', '#1f2937'),
            ]);
            map.setPaintProperty(LABEL_LAYER, 'text-halo-color', cssVar('--map-label-halo', '#ffffff'));
        }
    }

    function setFeatureState(id, state) {
        if (!id) return;
        try {
            map.setFeatureState({ source: FLAT_SOURCE, id }, state);
            map.setFeatureState({ source: EXTR_SOURCE, id }, state);
            map.setFeatureState({ source: PLAN_SOURCE, id }, state);
        } catch { /* ignore */ }
    }

    function setHover(id) {
        if (hoveredId === id) return;
        if (hoveredId) setFeatureState(hoveredId, { hover: false });
        hoveredId = id;
        if (hoveredId) setFeatureState(hoveredId, { hover: true });
    }

    function select(featureId) {
        if (selectedId) setFeatureState(selectedId, { selected: false });
        selectedId = featureId || null;
        if (selectedId) setFeatureState(selectedId, { selected: true });
    }

    function hitLayers() {
        return (viewMode === '3d' ? HIT_LAYERS_3D : HIT_LAYERS_2D)
            .filter((id) => map.getLayer(id));
    }

    function pickUnit(event) {
        const layers = hitLayers();
        if (!layers.length) return null;
        const hits = map.queryRenderedFeatures(event.point, { layers });
        for (const feature of hits) {
            const props = feature.properties || {};
            const isDisabledUnit = props.__disabled === 1
                || props.__disabled === '1'
                || props.__disabled === true;
            /* Shell/walking: secilemez. Disabled birimler Birim Yönetimi'nde
             * yeniden açılabilsin diye tıklanabilir kalır (kiosk runtime'dan fark). */
            if (!isDisabledUnit) {
                if (props.__floor_noninteractive === 1 || props.__floor_noninteractive === true) continue;
                if (isNonInteractiveFloorUnit(props, shellIds)) continue;
            } else if (isWalkingArea(props) || isBuildingShell(props, shellIds)) {
                continue;
            }
            if (props.__unit !== 1 && props.__unit !== '1' && !isDisabledUnit) continue;
            const featureId = String(props.id || feature.id || '');
            const unitId = normalizeUnitId(featureId);
            if (!sheetDisplayTitle(unitId)) continue;
            if (props.__selectable === 0 || props.__selectable === '0') continue;
            return feature;
        }
        return null;
    }

    function wireInteractions() {
        const onMove = (event) => {
            const feature = pickUnit(event);
            map.getCanvas().style.cursor = feature ? 'pointer' : '';
            setHover(feature?.id ?? feature?.properties?.id ?? null);
        };

        for (const layerId of [...HIT_LAYERS_2D, ...HIT_LAYERS_3D]) {
            map.on('mousemove', layerId, onMove);
            map.on('mouseleave', layerId, () => {
                map.getCanvas().style.cursor = '';
                setHover(null);
            });
        }

        map.on('click', (event) => {
            const feature = pickUnit(event);
            if (!feature) {
                select(null);
                onDeselect?.();
                return;
            }
            const featureId = String(feature.properties?.id || '');
            select(featureId);
            onSelect?.({
                featureId,
                unitId: normalizeUnitId(featureId),
                properties: feature.properties,
            });
        });
    }

    function setFloor(floorKey, { fit = false } = {}) {
        currentFloor = String(floorKey);
        const filter = floorFilter(currentFloor);
        for (const layerId of FLOOR_FILTERED) {
            if (!map.getLayer(layerId)) continue;
            if (layerId === HIT_LAYER) {
                map.setFilter(layerId, ['all', filter, ['==', ['get', '__unit'], 1]]);
            } else {
                map.setFilter(layerId, filter);
            }
        }
        if (fit) {
            const bounds = floorBounds(currentFloor);
            if (bounds) map.fitBounds(bounds, { padding: 80, duration: 600 });
        }
    }

    function getFloor() {
        return currentFloor;
    }

    function findFeatureIdByUnitId(unitId) {
        const target = normalizeUnitId(unitId);
        if (!target || !sheetDisplayTitle(target)) return null;
        const feature = geo?.rooms.features.find((f) =>
            isUnitFeature(f.properties, shellIds)
            && normalizeUnitId(f.properties.id) === target);
        return feature ? String(feature.properties.id) : null;
    }

    function focusUnit(featureId) {
        const feature = geo.rooms.features.find((f) => String(f.properties.id) === String(featureId));
        if (!feature) return null;
        const floor = String(feature.properties.floor);
        if (floor !== currentFloor) setFloor(floor);
        const bounds = boundsOfFeature(feature);
        if (bounds) {
            map.fitBounds(bounds, {
                padding: 220,
                duration: 600,
                maxZoom: 20,
                pitch: viewMode === '3d' ? (config.map.pitch3d ?? 60) : 0,
            });
        }
        return { featureId: String(feature.properties.id), floor, properties: feature.properties };
    }

    function boundsOfFeature(feature) {
        let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity;
        const visit = (coords) => {
            if (!Array.isArray(coords)) return;
            if (typeof coords[0] === 'number') {
                minLng = Math.min(minLng, coords[0]);
                maxLng = Math.max(maxLng, coords[0]);
                minLat = Math.min(minLat, coords[1]);
                maxLat = Math.max(maxLat, coords[1]);
                return;
            }
            coords.forEach(visit);
        };
        visit(feature.geometry?.coordinates);
        return Number.isFinite(minLng) ? [[minLng, minLat], [maxLng, maxLat]] : null;
    }

    async function init() {
        geo = await loadVenueGeojson();
        const initial = rebuildSources();

        const center = config.map.center
            || (geo.bounds
                ? [(geo.bounds[0][0] + geo.bounds[1][0]) / 2, (geo.bounds[0][1] + geo.bounds[1][1]) / 2]
                : [0, 0]);

        const style = await resolveBasemapStyle();

        map = new maplibregl.Map({
            container,
            style,
            center,
            zoom: config.map.zoom ?? 17,
            pitch: 0,
            bearing: config.map.bearing ?? -20,
            minZoom: config.map.minZoom ?? 14,
            maxZoom: config.map.maxZoom ?? 23,
            attributionControl: false,
            antialias: true,
            dragRotate: false,
            pitchWithRotate: true,
        });

        map.addControl(
            new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
            'bottom-left',
        );

        await new Promise((resolve) => map.once('load', resolve));

        addLayers(initial);
        wireInteractions();
        applyThemePaint();

        const initialFloor = geo.floors.includes('0') ? '0' : geo.floors[0];
        setFloor(initialFloor);
        if (geo.bounds) map.fitBounds(geo.bounds, { padding: 80, duration: 0, pitch: 0 });

        return { floors: geo.floors, floor: initialFloor };
    }

    return {
        init,
        get map() { return map; },
        get floors() { return geo?.floors || []; },
        setFloor,
        getFloor,
        select,
        repaint,
        focusUnit,
        findFeatureIdByUnitId,
        setViewMode,
        getViewMode,
        applyThemePaint,
    };
}
