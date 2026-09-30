/**
 * Pointr-style "walls only" geometry helpers, shared by the runtime map
 * renderer and the editor's processed map so both produce identical wall
 * bands. Pure geometry — relies on the global `turf` (loaded at runtime in
 * index.html and in the editor via the map-builder CDN loader).
 */

/* Ensure a ring is explicitly closed (first === last) — edited plans often
 * export open rings, which makes turf.polygon throw. */
function closeRing(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return ring || null;
    const a = ring[0], b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) return [...ring, [a[0], a[1]]];
    return ring;
}

function ringBbox(ring) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of ring) {
        if (c[0] < minX) minX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] > maxY) maxY = c[1];
    }
    return [minX, minY, maxX, maxY];
}

/* Real-world length (m) of a ring's shorter bbox side. Used to keep metric
 * insets/openings proportional to the unit's actual size so they degrade
 * gracefully even when the map is mis-scaled (e.g. an un-aligned SVG where
 * the default m/px is wrong). Returns null if turf metric helpers are absent. */
function ringMinSideMeters(ring) {
    if (typeof turf === 'undefined' || !turf.distance || !turf.point) return null;
    const b = ringBbox(ring);
    if (!Number.isFinite(b[0])) return null;
    try {
        const w = turf.distance(turf.point([b[0], b[1]]), turf.point([b[2], b[1]]), { units: 'meters' });
        const h = turf.distance(turf.point([b[0], b[1]]), turf.point([b[0], b[3]]), { units: 'meters' });
        return Math.min(w, h);
    } catch (_) { return null; }
}

/* Inset a single outer ring inward by `thicknessMeters` using turf's metric
 * buffer. Returns the inset ring(s) (a concave room can split into several),
 * or null when turf is unavailable / the room can't be inset even after repair.
 * Repairs applied (in order) because exported/edited plans are often invalid:
 *   close ring → cleanCoords (dedupe) → rewind (winding) → buffer at
 *   progressively thinner thickness → unkinkPolygon (split self-intersections)
 * so a unit becomes a (thin) wall band instead of collapsing to a solid block. */
export function insetRingsForOuter(outerRing, thicknessMeters) {
    if (typeof turf === 'undefined' || !turf.polygon || !turf.buffer) return null;

    let poly;
    try { poly = turf.polygon([closeRing(outerRing)]); } catch (_) { return null; }
    if (turf.cleanCoords) { try { poly = turf.cleanCoords(poly); } catch (_) { /* keep */ } }
    if (turf.rewind)      { try { poly = turf.rewind(poly); } catch (_) { /* keep */ } }

    const ringsFrom = (inset) => {
        const g = inset && inset.geometry;
        if (!g) return null;
        if (g.type === 'Polygon') return g.coordinates[0] ? [g.coordinates[0]] : null;
        if (g.type === 'MultiPolygon') {
            const rings = g.coordinates.map(p => p[0]).filter(Boolean);
            return rings.length ? rings : null;
        }
        return null;
    };

    const base = Math.abs(thicknessMeters) || 0.6;
    /* Cap the inset so it can never exceed ~30% of the unit's shortest side:
     * a negative buffer larger than the polygon collapses it and the wall band
     * fails (this is the main reason gaps/walls look broken before the map is
     * properly scaled). Falls back to `base` when the metric size is unknown. */
    const minSide = ringMinSideMeters(outerRing);
    const eff = minSide ? Math.min(base, Math.max(0.02, minSide * 0.3)) : base;
    const thicknesses = [eff, eff * 0.6, eff * 0.35, eff * 0.2, eff * 0.1];
    const tryBuffer = (p) => {
        for (const t of thicknesses) {
            let inset;
            try { inset = turf.buffer(p, -t, { units: 'meters' }); } catch (_) { inset = null; }
            const rings = ringsFrom(inset);
            if (rings) return rings;
        }
        return null;
    };

    let rings = tryBuffer(poly);
    if (rings) return rings;

    // Self-intersecting ("bowtie") ring — split into simple pieces, inset the
    // largest that works.
    if (turf.unkinkPolygon) {
        try {
            const pieces = (turf.unkinkPolygon(poly).features || [])
                .sort((a, b) => (turf.area ? turf.area(b) - turf.area(a) : 0));
            for (const piece of pieces) {
                const r = tryBuffer(piece);
                if (r) return r;
            }
        } catch (_) { /* fall through */ }
    }

    return null;
}

/* Turn a room polygon into a frame (outer ring + inset ring as a hole) so
 * `fill-extrusion` raises just the perimeter wall band and leaves the
 * interior open (floor shows through). Returns null when the inset fails so
 * the caller can fall back to a solid block and the unit never disappears. */
export function buildWallBand(feature, thicknessMeters) {
    const geom = feature.geometry;
    const parts = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates
            : null;
    if (!parts) return null;
    const coords = [];
    for (const part of parts) {
        const outerRing = closeRing(part[0]);
        if (!outerRing) continue;
        const holes = insetRingsForOuter(outerRing, thicknessMeters);
        if (!holes) return null;
        coords.push([outerRing, ...holes]);
    }
    if (!coords.length) return null;
    return { ...feature, geometry: { type: 'MultiPolygon', coordinates: coords } };
}

/* Shrink a unit polygon inward by `gapMeters` (true metric inset) BEFORE its
 * wall band is built. Adjacent units share an edge, so without a gap their wall
 * bands sit back-to-back on the exact same plane — at equal heights the faces
 * z-fight and the two walls read as one fused block. Insetting each unit a hair
 * leaves a thin floor-colored groove between neighbours so every unit's wall is
 * visually distinct. Per-part fallback keeps the original ring when the inset
 * fails (tiny/edited units) so a unit never vanishes. */
export function insetFeature(feature, gapMeters) {
    if (!(gapMeters > 0)) return feature;
    const geom = feature && feature.geometry;
    const parts = geom?.type === 'Polygon' ? [geom.coordinates]
        : geom?.type === 'MultiPolygon' ? geom.coordinates : null;
    if (!parts) return feature;

    const outCoords = [];
    for (const part of parts) {
        const outerRing = closeRing(part[0]);
        if (!outerRing) { outCoords.push(part); continue; }
        const rings = insetRingsForOuter(outerRing, gapMeters);
        if (!rings || !rings.length) { outCoords.push(part); continue; }
        for (const r of rings) {
            const cr = closeRing(r);
            if (cr) outCoords.push([cr]);
        }
    }
    if (!outCoords.length) return feature;
    return { ...feature, geometry: { type: 'MultiPolygon', coordinates: outCoords } };
}

/* ====================== DOOR OPENINGS ======================
 * Doors are short `LineString`s in the nav mesh whose id encodes the unit
 * (`ID001_1_` → unit `ID001`). A door does NOT sit on the wall — it lives
 * INSIDE the unit and connects (shares an endpoint node) with a path that
 * runs out through the wall to the corridor. So the real opening is where
 * that connected path crosses the unit's wall ring — not where the door is.
 *
 * `doorOpeningsByUnit()` resolves, per unit, one cut point per door: the
 * wall-ring crossing of the door's connected path nearest to the door. In
 * walls mode the perimeter band seals the whole room, so `carveDoorways()`
 * punches a gap at each of those points. Pure turf geometry; any failure
 * leaves the band intact so a unit never disappears. */

/* Node key matching the routing graph's snapping (doors & paths that meet
 * share an identical endpoint coordinate). 7 decimals ≈ 1 cm tolerance. */
const NODE_DECIMALS = 7;
function coordKey(c) { return `${c[0].toFixed(NODE_DECIMALS)},${c[1].toFixed(NODE_DECIMALS)}`; }

function outerRingsOf(feature) {
    const g = feature && feature.geometry;
    const parts = g?.type === 'Polygon' ? [g.coordinates]
        : g?.type === 'MultiPolygon' ? g.coordinates : null;
    if (!parts) return [];
    return parts.map(p => p[0]).filter(r => Array.isArray(r) && r.length >= 4);
}

function endpoints(coords) { return [coords[0], coords[coords.length - 1]]; }

const OPENING_DEDUP_SQ = 1e-11;   // ~0.35 m (in deg²)

function bboxOfCoords(coords) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of coords) {
        if (c[0] < minX) minX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] > maxY) maxY = c[1];
    }
    return [minX, minY, maxX, maxY];
}
function bboxOverlap(a, b, m = 0) {
    return a[0] - m <= b[2] && a[2] + m >= b[0] && a[1] - m <= b[3] && a[3] + m >= b[1];
}

/* Resolve every unit's wall openings.
 *
 * RULE: an opening goes where a door's CONNECTED PATH crosses a wall — not
 * where the door sits (doors are inside-unit markers). Critically, a path may
 * cross SEVERAL walls on its way in: reaching a nested/back unit means piercing
 * the unit(s) in front of it too. So we open EVERY wall the connected path
 * crosses, attributed to whichever unit owns that wall — that's why an adjacent
 * unit (ID039 sitting in front of ID039C) no longer leaves a wall blocking the
 * passage. Door lines themselves are ignored for cutting. Paths run in walkable
 * space and only cross a wall at a real doorway, so this doesn't over-cut.
 *
 * Everything is scoped PER FLOOR: a door/path on one floor can only open walls
 * on that same floor. Stacked multi-floor venues share lng/lat, so without this
 * a floor-1 path would phantom-cut the floor-0 unit beneath it (and vice
 * versa). Returns Map<unitId, [lng,lat][]>. */
export function doorOpeningsByUnit(roomFeatures, doorFeatures, pathFeatures) {
    const result = new Map();
    if (typeof turf === 'undefined' || !turf.lineIntersect || !turf.lineString) return result;

    const floorOf = (f) => String(f?.properties?.floor ?? '0');

    // Rooms grouped by floor (with ring line(s) + bbox for spatial pre-filter).
    const roomsByFloor = new Map();
    const roomByFloorId = new Map();
    for (const r of (roomFeatures || [])) {
        const id = r?.properties?.id;
        if (id == null) continue;
        const ringsCoords = outerRingsOf(r);
        if (!ringsCoords.length) continue;
        let bbox = [Infinity, Infinity, -Infinity, -Infinity];
        for (const rc of ringsCoords) {
            const b = bboxOfCoords(rc);
            bbox = [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]), Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])];
        }
        const floor = floorOf(r);
        const entry = { id: String(id), floor, ringLines: ringsCoords.map(rc => turf.lineString(rc)), bbox };
        if (!roomsByFloor.has(floor)) roomsByFloor.set(floor, []);
        roomsByFloor.get(floor).push(entry);
        roomByFloorId.set(`${floor}|${entry.id}`, entry);
    }

    // Paths indexed by floor + endpoint node key (doors/paths that meet share a
    // node; the floor prefix stops stacked floors from cross-linking).
    const pathsByNode = new Map();
    for (const p of (pathFeatures || [])) {
        const c = p?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const floor = floorOf(p);
        for (const end of endpoints(c)) {
            const k = `${floor}|${coordKey(end)}`;
            if (!pathsByNode.has(k)) pathsByNode.set(k, []);
            pathsByNode.get(k).push(p);
        }
    }

    const addPoint = (unitId, pt) => {
        if (!result.has(unitId)) result.set(unitId, []);
        const arr = result.get(unitId);
        if (!arr.some(q => (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2 < OPENING_DEDUP_SQ)) arr.push(pt);
    };

    for (const door of (doorFeatures || [])) {
        const c = door?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const ownerId = String(door.properties?.id || '').replace(/_\d+_$/, '');
        if (!ownerId) continue;

        const doorFloor = floorOf(door);
        const floorRooms = roomsByFloor.get(doorFloor) || [];
        const [ds, de] = endpoints(c);
        const doorMid = [(ds[0] + de[0]) / 2, (ds[1] + de[1]) / 2];

        // Same-floor paths sharing a node with either door endpoint.
        const connPaths = [];
        for (const end of endpoints(c)) {
            const conn = pathsByNode.get(`${doorFloor}|${coordKey(end)}`);
            if (conn) for (const p of conn) if (!connPaths.includes(p)) connPaths.push(p);
        }

        // Open every wall the connected path(s) pierce ON THIS FLOOR (the unit
        // itself plus any unit sitting in front of it on the way in).
        let ownerCrossed = false;
        for (const line of connPaths) {
            const lbbox = bboxOfCoords(line.geometry.coordinates);
            for (const room of floorRooms) {
                if (!bboxOverlap(lbbox, room.bbox, 1e-5)) continue;
                for (const ring of room.ringLines) {
                    let inter;
                    try { inter = turf.lineIntersect(line, ring); } catch (_) { continue; }
                    for (const pt of (inter.features || [])) {
                        addPoint(`${room.floor}|${room.id}`, pt.geometry.coordinates);
                        if (room.id === ownerId) ownerCrossed = true;
                    }
                }
            }
        }

        // Fallback: the door's own unit got no crossing (its connected path
        // doesn't reach its wall) — snap the door midpoint to its wall so it
        // still opens.
        if (!ownerCrossed && turf.nearestPointOnLine && turf.point) {
            const ownerRoom = roomByFloorId.get(`${doorFloor}|${ownerId}`);
            if (ownerRoom) {
                let best = null, bestD = Infinity;
                for (const ring of ownerRoom.ringLines) {
                    try {
                        const s = turf.nearestPointOnLine(ring, turf.point(doorMid), { units: 'meters' });
                        if (s.properties.dist < bestD) { bestD = s.properties.dist; best = s.geometry.coordinates; }
                    } catch (_) { /* ignore */ }
                }
                if (best) addPoint(`${doorFloor}|${ownerId}`, best);
            }
        }
    }

    return result;
}

/* Alternative opening rule: open EVERY wall that ANY path crosses, regardless
 * of doors. Use this mode for venues whose doors aren't modelled (or whenever
 * you want a doorway wherever a walkable path pierces a wall). Same per-floor
 * scoping, bbox pre-filter and dedup as `doorOpeningsByUnit`; the only
 * difference is there is no door/owner requirement — every path×wall crossing
 * becomes an opening. Returns Map<"floor|unitId", [lng,lat][]>. */
export function pathCrossOpeningsByUnit(roomFeatures, pathFeatures) {
    const result = new Map();
    if (typeof turf === 'undefined' || !turf.lineIntersect || !turf.lineString) return result;

    const floorOf = (f) => String(f?.properties?.floor ?? '0');

    const roomsByFloor = new Map();
    for (const r of (roomFeatures || [])) {
        const id = r?.properties?.id;
        if (id == null) continue;
        const ringsCoords = outerRingsOf(r);
        if (!ringsCoords.length) continue;
        let bbox = [Infinity, Infinity, -Infinity, -Infinity];
        for (const rc of ringsCoords) {
            const b = bboxOfCoords(rc);
            bbox = [Math.min(bbox[0], b[0]), Math.min(bbox[1], b[1]), Math.max(bbox[2], b[2]), Math.max(bbox[3], b[3])];
        }
        const floor = floorOf(r);
        const entry = { id: String(id), floor, ringLines: ringsCoords.map(rc => turf.lineString(rc)), bbox };
        if (!roomsByFloor.has(floor)) roomsByFloor.set(floor, []);
        roomsByFloor.get(floor).push(entry);
    }

    const addPoint = (unitId, pt) => {
        if (!result.has(unitId)) result.set(unitId, []);
        const arr = result.get(unitId);
        if (!arr.some(q => (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2 < OPENING_DEDUP_SQ)) arr.push(pt);
    };

    for (const p of (pathFeatures || [])) {
        const c = p?.geometry?.coordinates;
        if (!Array.isArray(c) || c.length < 2) continue;
        const floor = floorOf(p);
        const floorRooms = roomsByFloor.get(floor) || [];
        if (!floorRooms.length) continue;
        let line;
        try { line = turf.lineString(c); } catch (_) { continue; }
        const lbbox = bboxOfCoords(c);
        for (const room of floorRooms) {
            if (!bboxOverlap(lbbox, room.bbox, 1e-5)) continue;
            for (const ring of room.ringLines) {
                let inter;
                try { inter = turf.lineIntersect(line, ring); } catch (_) { continue; }
                for (const pt of (inter.features || [])) {
                    addPoint(`${room.floor}|${room.id}`, pt.geometry.coordinates);
                }
            }
        }
    }

    return result;
}

/* Key used by `doorOpeningsByUnit`'s result map — floor-scoped so a unit id
 * that's reused across floors can't share openings. Consumers must look up
 * each room feature's openings with this exact key. */
export function openingsKey(feature) {
    return `${String(feature?.properties?.floor ?? '0')}|${feature?.properties?.id}`;
}

/* Squared distance (lon/lat units) from P to segment ab — good enough to pick
 * which wall edge a crossing point lies on. */
function segDistSq(P, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const wx = P[0] - a[0], wy = P[1] - a[1];
    const len2 = vx * vx + vy * vy;
    let t = len2 ? (wx * vx + wy * vy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = a[0] + t * vx - P[0], dy = a[1] + t * vy - P[1];
    return dx * dx + dy * dy;
}

/* Closest wall edge [a, b] to point P. Scans every ring segment for the
 * genuinely closest one (nearestPointOnLine can jump to the adjacent edge at a
 * corner) and skips zero-length (duplicate-vertex) segments. Using the wrong
 * segment's bearing was the bug behind "no opening": it rotated the cutter
 * ~90°, so its through-wall reach collapsed and it only dented the outer face. */
function closestWallSegment(rings, P) {
    let best = null, bestD = Infinity;
    for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i], b = ring[i + 1];
            if (a[0] === b[0] && a[1] === b[1]) continue;
            const d = segDistSq(P, a, b);
            if (d < bestD) { bestD = d; best = [a, b]; }
        }
    }
    return best;
}

/* Oriented rectangular cutter centred on the crossing `point`: `gapWidth` wide
 * ALONG the wall and deep enough to span the full band, so subtracting it cuts
 * a real opening (corridor → interior), not just a dent. The width is clamped
 * to the wall segment's length so a too-wide gap (e.g. on a mis-scaled / small
 * unit) can't spill past the corners and blow the whole wall away. */
function doorwayCutter(rings, point, gapWidth, thicknessMeters) {
    const seg = closestWallSegment(rings, point);
    if (!seg) return null;
    const wallBearing = turf.bearing(turf.point(seg[0]), turf.point(seg[1]));
    const normal = wallBearing + 90;
    let segLen = Infinity;
    try { segLen = turf.distance(turf.point(seg[0]), turf.point(seg[1]), { units: 'meters' }); } catch (_) { /* keep Infinity */ }
    const maxHalfW = Number.isFinite(segLen) ? Math.max(0.1, segLen * 0.45) : Infinity;
    const halfW = Math.min(Math.max(0.2, gapWidth / 2), maxHalfW);
    // Always exceed the wall thickness so the cut reaches the inner hole.
    const halfD = Math.max(Math.abs(thicknessMeters) * 1.5, Math.abs(thicknessMeters) + 0.6);
    const opts = { units: 'meters' };

    const C = turf.point(point);
    const A = turf.destination(C, halfW, wallBearing, opts);
    const B = turf.destination(C, halfW, wallBearing + 180, opts);
    const Ao = turf.destination(A, halfD, normal, opts).geometry.coordinates;
    const Ai = turf.destination(A, halfD, normal + 180, opts).geometry.coordinates;
    const Bi = turf.destination(B, halfD, normal + 180, opts).geometry.coordinates;
    const Bo = turf.destination(B, halfD, normal, opts).geometry.coordinates;
    return turf.polygon([[Ao, Ai, Bi, Bo, Ao]]);
}

/* Subtract a doorway opening from `wallFeature` for every door midpoint. The
 * outer rings are sampled once up front so each cut snaps to the true wall
 * line (not a previously-notched edge). Returns the (possibly) carved feature;
 * the original is returned untouched if turf is missing or a cut fails. */
export function carveDoorways(wallFeature, doorMidpoints, gapWidth, thicknessMeters) {
    if (!wallFeature || !Array.isArray(doorMidpoints) || !doorMidpoints.length) return wallFeature;
    if (typeof turf === 'undefined' || !turf.difference
        || !turf.destination || !turf.bearing || !turf.point || !turf.polygon) {
        return wallFeature;
    }
    const geom = wallFeature.geometry;
    const parts = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates : null;
    if (!parts) return wallFeature;
    const outerLines = parts.map(p => p[0]).filter(r => Array.isArray(r) && r.length >= 2);
    if (!outerLines.length) return wallFeature;

    let current = wallFeature;
    for (const mid of doorMidpoints) {
        if (!Array.isArray(mid) || mid.length < 2) continue;
        let cutter;
        try { cutter = doorwayCutter(outerLines, mid, gapWidth, thicknessMeters); }
        catch (_) { cutter = null; }
        if (!cutter) continue;

        let diff = null;
        try {
            diff = turf.difference(turf.featureCollection([current, cutter]));
        } catch (_) {
            // turf < 7 fallback signature.
            try { diff = turf.difference(current, cutter); } catch (_) { diff = null; }
        }
        if (diff && diff.geometry) current = { ...current, geometry: diff.geometry };
    }
    return current;
}
