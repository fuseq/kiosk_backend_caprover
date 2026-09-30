/**
 * Oda ozelliklerinden birim sinifi — editor unit-utils ile hizali.
 */

export function isWalkingArea(props) {
    return props?.sublayer === 'walking';
}

export function isBuildingShell(props, shellIds) {
    if (!props) return false;
    const id = props.id != null ? String(props.id) : '';
    if (shellIds?.has?.(id)) return true;
    return props.sublayer === 'building' && id && !id.startsWith('ID');
}

export function normalizeRoomFeatureId(id) {
    if (id == null || id === '') return '';
    return String(id).replace(/_\d+_?$/, '');
}

/** Yurume / bina zarfi — secilemez. */
export function isNonInteractiveFloorUnit(props, shellIds) {
    if (!props) return false;
    if (props.__floor_noninteractive === 1 || props.__floor_noninteractive === true) return true;
    if (isWalkingArea(props)) return true;
    return isBuildingShell(props, shellIds);
}

/**
 * Bina zarfi: SVG'den gelen govde poligonlari. Bunlarin kimligi `ID` ile
 * baslamaz (orn "path3341") — secilebilir birim degildirler.
 */
export function isBuildingShellLegacy(props) {
    if (!props) return false;
    const id = props.id != null ? String(props.id) : '';
    return !id.startsWith('ID');
}

/** Yalnizca `ID*` kimligine sahip, koridor olmayan poligonlar birimdir. */
export function isUnitFeature(props, shellIds) {
    if (!props) return false;
    if (isWalkingArea(props)) return false;
    if (shellIds) return !isNonInteractiveFloorUnit(props, shellIds);
    return !isBuildingShellLegacy(props);
}
