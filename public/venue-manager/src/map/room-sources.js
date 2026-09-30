/**
 * Editor / runtime ile ayni oda kaynak pipeline'i.
 * Kaynak: inmapper_kiosk process-room-sync + map-renderer buildRoomSourceData.
 */

import {
    buildWallBand,
    carveDoorways,
    doorOpeningsByUnit,
    pathCrossOpeningsByUnit,
    openingsKey,
    insetFeature,
} from './wall-geometry.js';
import { normalizeRoomFeatureId, isWalkingArea } from './unit-utils.js';

function ringArea(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return Math.abs(area / 2);
}

export function featureArea(feature) {
    const g = feature.geometry;
    if (!g) return 0;
    if (g.type === 'Polygon') return g.coordinates[0] ? ringArea(g.coordinates[0]) : 0;
    if (g.type === 'MultiPolygon') {
        let total = 0;
        for (const poly of g.coordinates) {
            if (poly[0]) total += ringArea(poly[0]);
        }
        return total;
    }
    return 0;
}

/** Editor/runtime detectShellIds — buyuk bina zarfini extrusion'dan cikarir. */
export function detectShellIds(roomFeatures) {
    const shells = new Set();
    const byFloor = new Map();
    for (const f of roomFeatures) {
        const fl = f.properties?.floor || '0';
        if (!byFloor.has(fl)) byFloor.set(fl, []);
        byFloor.get(fl).push(f);
    }
    for (const [, features] of byFloor) {
        const sized = [];
        for (const f of features) {
            const sl = f.properties?.sublayer;
            if (sl === 'walking') continue;
            const a = featureArea(f);
            if (a <= 0) continue;
            sized.push({ f, sl, a });
        }
        if (!sized.length) continue;

        for (const { f, sl } of sized) {
            const fid = f.properties?.id || '';
            if (sl === 'building' && !String(fid).startsWith('ID')) {
                shells.add(fid);
            }
        }

        if (sized.length >= 2) {
            sized.sort((a, b) => b.a - a.a);
            const largest = sized[0];
            const restArea = sized.slice(1).reduce((s, x) => s + x.a, 0);
            const second = sized[1].a;
            if (largest.a > restArea && largest.a > second * 3) {
                shells.add(largest.f.properties.id);
            }
        }
    }
    return shells;
}

function tagNonInteractiveFloor(feature) {
    return {
        ...feature,
        properties: { ...feature.properties, __floor_noninteractive: 1 },
    };
}

function shrinkPolygon(feature, factor) {
    const geom = feature.geometry;
    const shrinkRing = (ring) => {
        const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        return ring.map((c) => [cx + (c[0] - cx) * factor, cy + (c[1] - cy) * factor]);
    };
    if (geom?.type === 'Polygon') {
        return { ...feature, geometry: { ...geom, coordinates: geom.coordinates.map(shrinkRing) } };
    }
    if (geom?.type === 'MultiPolygon') {
        return { ...feature, geometry: { ...geom, coordinates: geom.coordinates.map((p) => p.map(shrinkRing)) } };
    }
    return feature;
}

function isDisabledDoor(door, disabledIdSet) {
    const raw = String(door?.properties?.id || '');
    if (!raw) return false;
    const owner = raw.replace(/_\d+_?$/, '');
    return disabledIdSet.has(owner) || disabledIdSet.has(normalizeRoomFeatureId(owner));
}

function pathEntersDisabled(path, disabledPolys) {
    const c = path?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2 || typeof turf === 'undefined'
        || !turf.booleanPointInPolygon || !turf.point) return false;
    const ends = [c[0], c[c.length - 1]];
    for (const end of ends) {
        if (!Array.isArray(end) || end.length < 2) continue;
        for (const poly of disabledPolys) {
            try {
                if (turf.booleanPointInPolygon(turf.point(end), poly)) return true;
            } catch { /* ignore */ }
        }
    }
    return false;
}

/**
 * @param {object[]} roomsFeatures
 * @param {object} mapCfg  config.map (editor features.map ile ayni sekil)
 * @param {object[]} doorFeatures
 * @param {object[]} pathFeatures
 * @param {(props: object) => boolean} isDisabledFn  sheet/geojson disabled
 */
export function buildRoomSourceData(
    roomsFeatures,
    mapCfg,
    doorFeatures = [],
    pathFeatures = [],
    isDisabledFn = () => false,
) {
    const shellIds = detectShellIds(roomsFeatures);
    const shrinkFactor = mapCfg.shrinkFactor || 0.99;
    const globalMode = mapCfg.roomRenderMode || 'solid';
    const bySub = mapCfg.renderModeBySublayer || {};
    const effMode = (f) => bySub[f.properties.sublayer] || globalMode;

    const disColored = mapCfg.disabledUnits?.colored === true;
    const isDisabled = (f) => isDisabledFn(f.properties) || f.properties?.__disabled === 1;
    const tagDisabledShown = (f) => ({
        ...f,
        properties: { ...f.properties, __disabled: 1, __floor_noninteractive: 1 },
    });

    const flatBase = roomsFeatures
        .filter((f) => {
            const sl = f.properties.sublayer;
            return sl === 'walking' || shellIds.has(f.properties.id);
        })
        .map(tagNonInteractiveFloor);

    const isRenderableRoom = (f) => {
        if (isWalkingArea(f.properties)) return false;
        if (shellIds.has(f.properties.id)) return false;
        return true;
    };

    const activeRooms = roomsFeatures.filter((f) => isRenderableRoom(f) && !isDisabled(f));
    const disabledShown = disColored
        ? roomsFeatures.filter((f) => isRenderableRoom(f) && isDisabled(f)).map(tagDisabledShown)
        : [];

    const wallRooms = [
        ...activeRooms.filter((f) => effMode(f) === 'walls'),
        ...disabledShown.filter((f) => effMode(f) === 'walls'),
    ];
    const solidRooms = [
        ...activeRooms.filter((f) => effMode(f) !== 'walls'),
        ...disabledShown.filter((f) => effMode(f) !== 'walls'),
    ];

    const flatFeatures = [...flatBase];
    const extrudedFeatures = [];

    if (wallRooms.length) {
        const thickness = mapCfg.wallThickness ?? 0.6;
        const wallGap = mapCfg.wallGap ?? 0;
        const gapsOn = mapCfg.doorGaps !== false;
        const gapWidth = mapCfg.doorGapWidth ?? 1.2;
        const doorGapMode = mapCfg.doorGapMode || 'doors';

        const disabledIdSet = new Set();
        for (const f of roomsFeatures) {
            if (!isDisabled(f) || f.properties?.id == null) continue;
            disabledIdSet.add(String(f.properties.id));
            disabledIdSet.add(normalizeRoomFeatureId(String(f.properties.id)));
        }
        const disabledPolys = (doorGapMode === 'paths' && disabledIdSet.size)
            ? roomsFeatures.filter(isDisabled)
            : [];
        const gapDoors = disabledIdSet.size
            ? doorFeatures.filter((d) => !isDisabledDoor(d, disabledIdSet))
            : doorFeatures;
        const gapPaths = (doorGapMode === 'paths' && disabledPolys.length)
            ? pathFeatures.filter((p) => !pathEntersDisabled(p, disabledPolys))
            : pathFeatures;
        const openings = !gapsOn ? null
            : (doorGapMode === 'paths'
                ? pathCrossOpeningsByUnit(wallRooms, gapPaths)
                : doorOpeningsByUnit(wallRooms, gapDoors, gapPaths));

        for (const f of wallRooms) {
            const fForWall = wallGap > 0 ? insetFeature(f, wallGap) : f;
            let band = buildWallBand(fForWall, thickness) || shrinkPolygon(fForWall, shrinkFactor);
            const mids = openings ? openings.get(openingsKey(f)) : null;
            if (band && mids && mids.length) band = carveDoorways(band, mids, gapWidth, thickness);
            extrudedFeatures.push({ ...band, properties: { ...(band.properties || {}), __wall: 1 } });
            const floorProps = isDisabled(f)
                ? { ...f.properties, __disabled: 1, __floor_noninteractive: 1 }
                : { ...f.properties, __unit: 1 };
            flatFeatures.push({ ...f, properties: floorProps });
        }
    }

    for (const f of solidRooms) {
        const shrunk = shrinkPolygon(f, shrinkFactor);
        extrudedFeatures.push(isDisabled(f)
            ? { ...shrunk, properties: { ...shrunk.properties, __disabled: 1, __floor_noninteractive: 1 } }
            : shrunk);
    }

    return { flatFeatures, extrudedFeatures, shellIds };
}

export function buildHeightExpr(heights) {
    const expr = ['match', ['get', 'sublayer']];
    for (const [k, v] of Object.entries(heights || {})) expr.push(k, v);
    expr.push(5);
    return expr;
}

export function buildColorExprs(mapCfg, colorFromProps = false) {
    const disColor = mapCfg.disabledUnits?.color || '#9ca3af';
    const unitColor = colorFromProps
        ? ['case', ['==', ['get', '__disabled'], 1], disColor, ['get', '__color']]
        : (() => {
            const subExpr = ['match', ['get', 'sublayer']];
            for (const [k, v] of Object.entries(mapCfg.sublayerColors || {})) subExpr.push(k, v);
            subExpr.push(mapCfg.defaultRoomColor || '#cccccc');
            return ['case', ['==', ['get', '__disabled'], 1], disColor, subExpr];
        })();

    const extrBase = (mapCfg.wallColorMode === 'fixed' && mapCfg.wallColor)
        ? ['case', ['==', ['get', '__wall'], 1], mapCfg.wallColor, unitColor]
        : unitColor;

    return { floorColor: unitColor, extrColor: extrBase };
}
