/**
 * Birim kimligi normalizasyonu.
 *
 * GeoJSON'da bir birimin kapi turevleri `ID003_1_` gibi sonek tasir; Sheets
 * tarafinda ise anahtar sade `ID003`'tur. Iki tarafi eslestirmek icin soneki
 * kirpiyoruz. (Kiosk projesindeki `normalizeRoomFeatureId` ile ayni kural.)
 */
export function normalizeUnitId(id) {
    if (id == null || id === '') return '';
    return String(id).replace(/_\d+_?$/, '');
}
