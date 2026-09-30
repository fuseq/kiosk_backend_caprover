/**
 * Birim alan semasi.
 * ──────────────────
 * Duzenlenebilir alanlar VERI olarak burada tanimlanir; form arayuzu bu
 * listeden uretilir. Yeni bir alan eklemek icin listeye bir satir eklemek
 * yeterli — form, dogrulama, degisiklik gunlugu ve Sheets yazimi otomatik
 * olarak kapsar.
 *
 * `key`      Sheets baslik satirindaki kolon adi (BUYUK/kucuk harf duyarli).
 * `label`    Arayuzde gorunen ad.
 * `type`     text | textarea | tel | url | floor | categories
 * `altKeys`  Okumada denenecek alternatif kolon adlari (yazim eski sheet'lerde
 *            farkli olabilir). Yazma her zaman `key` ile yapilir.
 */

export const UNIT_FIELDS = [
    { key: 'Title', label: 'Başlık', type: 'text', required: true, visible: true, editable: true },
    { key: 'Subtitle', label: 'Alt başlık', type: 'text', visible: true, editable: true },
    { key: 'Category', label: 'Kategori', type: 'categories', visible: true, editable: true },
    { key: 'Floor', label: 'Kat', type: 'floor', visible: true, editable: true },
    { key: 'Telephone', label: 'Telefon', type: 'tel', altKeys: ['Phone'], visible: true, editable: true },
    { key: 'Web', label: 'Web sitesi', type: 'url', placeholder: 'https://', visible: true, editable: true },
    {
        key: 'Hours', label: 'Çalışma saatleri', type: 'textarea', rows: 3,
        hint: 'Örn: Pzt-Cum 10:00-22:00', visible: true, editable: true,
    },
    { key: 'Description', label: 'Açıklama', type: 'textarea', rows: 4, visible: true, editable: true },
    { key: 'Logo', label: 'Logo bağlantısı', type: 'url', placeholder: 'https://', visible: true, editable: true },
];

let activeFields = UNIT_FIELDS.map(field => ({ ...field }));

export function setUnitFields(fields) {
    activeFields = Array.isArray(fields) && fields.length
        ? fields.map((field, index) => ({
            ...field,
            visible: field.visible !== false,
            editable: field.visible !== false && field.editable !== false,
            order: Number.isFinite(Number(field.order)) ? Number(field.order) : index,
        })).sort((a, b) => a.order - b.order)
        : UNIT_FIELDS.map(field => ({ ...field }));
}

export function getUnitFields({ visibleOnly = false } = {}) {
    return activeFields
        .filter(field => !visibleOnly || field.visible !== false)
        .map(field => ({ ...field }));
}

/** Birimin acik/kapali durumunu tutan kolon. Sheets'te olusturulmali. */
export const DISABLED_COLUMN = 'Disabled';

/** Sheets satirlarini eslestiren birincil anahtar kolonu. */
export const KEY_COLUMN = 'ID';

const TRUTHY = new Set(['true', 'evet', 'yes', '1', 'x', 'kapali', 'kapalı', 'disabled']);

/** `Disabled` hucresini boolean'a cevirir. Bos hucre = aktif. */
export function isDisabledValue(value) {
    if (value === true) return true;
    if (value === false || value == null) return false;
    return TRUTHY.has(String(value).trim().toLowerCase());
}

/** Sheets'e yazilacak kanonik gosterim. */
export function disabledCellValue(disabled) {
    return disabled ? 'TRUE' : 'FALSE';
}

/**
 * Bir alanin satirdaki degerini okur; `key` bos ise `altKeys` denenir.
 * Her zaman string doner.
 */
export function readField(row, field) {
    if (!row) return '';
    const direct = row[field.key];
    if (direct != null && String(direct).trim() !== '') return String(direct).trim();
    for (const alt of field.altKeys || []) {
        const value = row[alt];
        if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return '';
}

/** Kategori hucresini diziye cevirir ("shop, food" → ['shop','food']). */
export function parseCategories(value) {
    return String(value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
}

/** Diziyi kanonik kategori hucresine cevirir. */
export function serializeCategories(list) {
    return (list || []).map(c => String(c).trim()).filter(Boolean).join(',');
}

/**
 * Iki satir arasindaki degisiklikleri alan alan cikarir.
 * Donen her kayit degisiklik gunlugunde bir satira karsilik gelir.
 */
export function diffFields(before, after, fields = activeFields) {
    const changes = [];
    for (const field of fields) {
        if (field.editable === false) continue;
        if (!(field.key in after)) continue;
        const oldValue = readField(before, field);
        const newValue = String(after[field.key] ?? '').trim();
        if (oldValue === newValue) continue;
        changes.push({ field: field.key, label: field.label, oldValue, newValue });
    }
    return changes;
}

/** Birim basligini kullaniciya gosterilecek sekilde cozer. */
export function unitTitle(row, fallbackId) {
    const title = readField(row || {}, { key: 'Title' });
    return title || fallbackId || 'İsimsiz birim';
}
