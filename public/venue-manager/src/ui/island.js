/**
 * Sag ust "island" paneli.
 * ────────────────────────
 * Haritada bir birime tiklandiginda o birimin Sheets kaydini gosterir ve
 * duzenlemeye izin verir. Form alanlari `UNIT_FIELDS` semasindan uretilir;
 * yeni bir alan eklemek icin bu dosyaya dokunmak gerekmez.
 *
 * Kaydetme akisi: form durumu → units-repo.saveUnit() → Sheets liste
 * sekmesi + degisiklik gunlugu → harita yeniden boyanir.
 */

import { canWrite, floorLabel, config } from '../config.js';
import { allCategories, categoryLabel } from '../data/categories.js';
import { canEditUnitStatus, saveUnit, unitSnapshot } from '../data/units-repo.js';
import {
    getUnitFields,
    parseCategories,
    serializeCategories,
} from '../data/unit-schema.js';
import { toast } from './toast.js';

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let root = null;
let hooks = {};

/** Panelin o an gosterdigi birim: { featureId, unitId, snapshot, floor }. */
let current = null;
/** Formun duzenlenmis hali: { values, disabled, note }. */
let draft = null;

/* ──────────────────────── kurulum ──────────────────────── */

/**
 * @param {HTMLElement} element
 * @param {object} callbacks
 * @param {(unitId:string)=>void} callbacks.onSaved
 * @param {()=>void} callbacks.onClosed
 * @param {(featureId:string)=>void} callbacks.onFocusUnit
 * @param {()=>string} callbacks.editorName Gunluge yazilacak duzenleyen adi.
 */
export function initIsland(element, callbacks = {}) {
    root = element;
    hooks = callbacks;

    const island = config.ui.island;
    root.style.setProperty('--island-width', `${island.width}px`);
    root.style.setProperty('--island-margin', `${island.margin}px`);
    root.style.setProperty('--island-radius', `${island.radius}px`);
    root.classList.add('vm-island', `vm-island--${island.position}`);

    renderEmpty();
}

/** Haritada bir birim secildiginde cagrilir. */
export function showUnit({ featureId, unitId, properties }) {
    const snapshot = unitSnapshot(unitId);
    current = {
        featureId,
        unitId,
        snapshot,
        floor: properties?.floor ?? snapshot?.values.Floor,
    };

    if (!snapshot) {
        draft = null;
        renderMissing();
    } else {
        draft = { values: { ...snapshot.values }, disabled: snapshot.disabled, note: '' };
        renderEditor();
    }
    root.classList.add('is-open');
}

export function hideIsland() {
    current = null;
    draft = null;
    root.classList.remove('is-open');
    renderEmpty();
}

/** Depo tazelendiginde acik paneli yeni veriyle senkronlar. */
export function refreshIsland() {
    if (!current) return;
    showUnit({
        featureId: current.featureId,
        unitId: current.unitId,
        properties: { floor: current.floor },
    });
}

/* ──────────────────────── gorunumler ──────────────────────── */

function renderEmpty() {
    root.innerHTML = `
        <div class="vm-island__empty">
            <div class="vm-island__empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 20.5 3.5 22.5V6L9 4l6 2 5.5-2v16.5L15 22.5z"/>
                    <path d="M9 4v16.5M15 6v16.5"/>
                </svg>
            </div>
            <p class="vm-island__empty-title">Bir birim seçin</p>
            <p class="vm-island__empty-text">
                Haritadan bir birime tıklayarak bilgilerini görüntüleyebilir,
                düzenleyip değişiklik bildirebilirsiniz.
            </p>
        </div>
    `;
}

function renderMissing() {
    const id = escapeHtml(current.unitId);
    root.innerHTML = `
        ${headerHtml({ title: current.unitId, disabled: false })}
        <div class="vm-island__body">
            <div class="vm-notice vm-notice--warn">
                <strong>Sheets kaydı bulunamadı.</strong>
                Bu poligon haritada <code>${id}</code> kimliğiyle duruyor ancak liste
                sekmesinde aynı kimlikte bir satır yok. Satırı ekledikten sonra
                üst çubuktaki <em>Yenile</em> düğmesine basın.
            </div>
        </div>
    `;
    wireHeader();
}

function renderEditor() {
    root.innerHTML = `
        ${headerHtml({
            title: draft.values.Title || current.snapshot.id,
            disabled: draft.disabled,
        })}
        <div class="vm-island__body">
            <div class="vm-status-card ${draft.disabled ? 'is-disabled' : ''}">
                <div class="vm-status-card__text">
                    <span class="vm-status-card__title">Birim durumu</span>
                    <span class="vm-status-card__hint">${statusHint(draft.disabled, !canEditUnitStatus())}</span>
                </div>
                ${switchHtml(
                    'vm-status',
                    !draft.disabled,
                    canEditUnitStatus() ? (draft.disabled ? 'Kapalı' : 'Aktif') : 'Salt okunur',
                    !canEditUnitStatus()
                )}
            </div>

            <form class="vm-form" novalidate>
                ${getUnitFields({ visibleOnly: true }).map(field => `
                    <div class="vm-field" data-field-wrap="${field.key}">${fieldInnerHtml(field)}</div>
                `).join('')}
                <div class="vm-field">
                    <label class="vm-field__label" for="vm-note">
                        Not <span class="vm-opt">(opsiyonel)</span>
                    </label>
                    <textarea class="vm-input" id="vm-note" rows="2"
                              placeholder="Değişikliğin gerekçesi — günlüğe kaydedilir">${escapeHtml(draft.note)}</textarea>
                </div>
            </form>
        </div>

        <div class="vm-island__footer">
            <span class="vm-island__footer-hint" data-role="dirty"></span>
            <div class="vm-island__footer-actions">
                <button type="button" class="vm-btn vm-btn--ghost" data-act="reset">Geri al</button>
                <button type="button" class="vm-btn vm-btn--primary" data-act="save" disabled>
                    Onayla ve kaydet
                </button>
            </div>
        </div>
    `;

    wireHeader();
    wireFields();
    wireStatusSwitch();
    wireFooter();
    updateDirtyState();
}

function statusHint(disabled, readOnly = false) {
    const text = disabled
        ? 'Kapalı — haritada gri gösterilir, ziyaretçiye yönlendirilmez.'
        : 'Aktif — haritada ve aramada normal görünür.';
    return readOnly ? `${text} Durum değiştirme yetkiniz yok.` : text;
}

function headerHtml({ title, disabled }) {
    return `
        <div class="vm-island__header">
            <div class="vm-island__heading">
                <span class="vm-island__eyebrow">${escapeHtml(eyebrowText())}</span>
                <h2 class="vm-island__title" data-role="title">${escapeHtml(title)}</h2>
            </div>
            <div class="vm-island__header-actions">
                <span class="vm-badge ${disabled ? 'vm-badge--off' : 'vm-badge--on'}" data-role="badge">
                    ${disabled ? 'Kapalı' : 'Aktif'}
                </span>
                <button type="button" class="vm-icon-btn" data-act="focus"
                        title="Haritada ortala" aria-label="Haritada ortala">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round">
                        <circle cx="12" cy="12" r="6.5"/>
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
                    </svg>
                </button>
                <button type="button" class="vm-icon-btn" data-act="close"
                        title="Kapat" aria-label="Kapat">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
                </button>
            </div>
        </div>
    `;
}

function eyebrowText() {
    const id = current?.unitId || '';
    const floor = current?.floor;
    const floorText = floor == null || floor === '' ? '' : ` · ${floorLabel(floor)}`;
    return `${id}${floorText}`;
}

function switchHtml(id, on, label, disabled = false) {
    return `
        <label class="vm-switch ${on ? 'is-on' : ''}" for="${id}">
            <input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span class="vm-switch__track" aria-hidden="true"><span class="vm-switch__knob"></span></span>
            <span class="vm-switch__label">${escapeHtml(label)}</span>
        </label>
    `;
}

/* ──────────────────────── alan uretimi ──────────────────────── */

function fieldInnerHtml(field) {
    const value = draft.values[field.key] ?? '';
    const inputId = `vm-f-${field.key}`;
    const label = `
        <label class="vm-field__label" for="${inputId}">
            ${escapeHtml(field.label)}${field.required ? '<span class="vm-req">*</span>' : ''}
        </label>`;
    const hint = field.hint ? `<span class="vm-field__hint">${escapeHtml(field.hint)}</span>` : '';
    const disabled = field.editable === false ? 'disabled' : '';

    let control;
    switch (field.type) {
        case 'textarea':
            control = `<textarea class="vm-input" id="${inputId}" data-field="${field.key}"
                        rows="${field.rows || 3}" ${disabled}>${escapeHtml(value)}</textarea>`;
            break;
        case 'floor':
            control = floorSelectHtml(inputId, field.key, value, disabled);
            break;
        case 'categories':
            control = categoriesHtml(field, value);
            break;
        default: {
            const inputType = ['tel', 'url', 'email', 'number'].includes(field.type) ? field.type : 'text';
            control = `<input class="vm-input" id="${inputId}" data-field="${field.key}"
                        type="${inputType}" value="${escapeHtml(value)}"
                        placeholder="${escapeHtml(field.placeholder || '')}" ${disabled} />`;
        }
    }
    return `${label}${control}${hint}`;
}

function floorSelectHtml(inputId, key, value, disabled = '') {
    const keys = Object.keys(config.venue.floorMap || {});
    if (value && !keys.includes(String(value))) keys.push(String(value));
    keys.sort((a, b) => Number(b) - Number(a));
    const options = keys.map(k => `
        <option value="${escapeHtml(k)}" ${String(value) === k ? 'selected' : ''}>
            ${escapeHtml(floorLabel(k))}
        </option>`).join('');
    return `<select class="vm-input" id="${inputId}" data-field="${key}" ${disabled}>
        <option value="">—</option>${options}
    </select>`;
}

function categoriesHtml(field, value) {
    const key = field.key;
    const readOnly = field.editable === false;
    const selected = parseCategories(value);
    const available = allCategories().filter(c => !selected.includes(c.apiKey));
    const chips = selected.map(apiKey => `
        <span class="vm-chip">
            <span class="vm-chip__dot" style="background:${escapeHtml(colorOf(apiKey))}"></span>
            ${escapeHtml(categoryLabel(apiKey))}
            ${readOnly ? '' : `<button type="button" class="vm-chip__x" data-remove-cat="${escapeHtml(apiKey)}"
                    aria-label="Kaldır">×</button>`}
        </span>`).join('');
    const options = available.map(c =>
        `<option value="${escapeHtml(c.apiKey)}">${escapeHtml(c.displayName)}</option>`).join('');

    return `
        <div class="vm-chips">
            ${chips || '<span class="vm-chips__empty">Kategori seçilmedi</span>'}
        </div>
        ${readOnly ? '' : `<select class="vm-input vm-input--sm" data-cat-add="${key}">
            <option value="">+ Kategori ekle</option>${options}
        </select>`}
    `;
}

function colorOf(apiKey) {
    return allCategories().find(c => c.apiKey === apiKey)?.color || '#9aa1ab';
}

/* ──────────────────────── olay baglama ──────────────────────── */

function wireHeader() {
    root.querySelector('[data-act="close"]')?.addEventListener('click', () => {
        hideIsland();
        hooks.onClosed?.();
    });
    root.querySelector('[data-act="focus"]')?.addEventListener('click', () => {
        if (current?.featureId) hooks.onFocusUnit?.(current.featureId);
    });
}

/** Tum alanlari bagla. Kategori alanlari kendi icinde yeniden cizilebilir. */
function wireFields() {
    for (const field of getUnitFields({ visibleOnly: true })) {
        if (field.editable === false) continue;
        if (field.type === 'categories') wireCategoryField(field.key);
        else wireScalarField(field.key);
    }

    root.querySelector('#vm-note')?.addEventListener('input', (event) => {
        draft.note = event.target.value;
    });
}

function wireScalarField(key) {
    const input = root.querySelector(`[data-field="${key}"]`);
    if (!input) return;
    const onChange = () => {
        draft.values[key] = input.value;
        if (key === 'Title') {
            const titleEl = root.querySelector('[data-role="title"]');
            if (titleEl) titleEl.textContent = input.value || current.snapshot.id;
        }
        updateDirtyState();
    };
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange);
}

function wireCategoryField(key) {
    const wrap = root.querySelector(`[data-field-wrap="${key}"]`);
    if (!wrap) return;

    wrap.querySelector(`[data-cat-add="${key}"]`)?.addEventListener('change', (event) => {
        const apiKey = event.currentTarget.value;
        if (!apiKey) return;
        const list = parseCategories(draft.values[key]);
        if (!list.includes(apiKey)) list.push(apiKey);
        draft.values[key] = serializeCategories(list);
        redrawCategoryField(key);
    });

    wrap.querySelectorAll('[data-remove-cat]').forEach((button) => {
        button.addEventListener('click', () => {
            draft.values[key] = serializeCategories(
                parseCategories(draft.values[key]).filter(c => c !== button.dataset.removeCat)
            );
            redrawCategoryField(key);
        });
    });
}

/** Yalnizca ilgili alani yeniden cizip tekrar baglar — cift dinleyici olmaz. */
function redrawCategoryField(key) {
    const wrap = root.querySelector(`[data-field-wrap="${key}"]`);
    if (!wrap) return;
    const field = getUnitFields().find(f => f.key === key);
    wrap.innerHTML = fieldInnerHtml(field);
    wireCategoryField(key);
    updateDirtyState();
}

function wireStatusSwitch() {
    if (!canEditUnitStatus()) return;
    const input = root.querySelector('#vm-status');
    input?.addEventListener('change', () => {
        draft.disabled = !input.checked;
        refreshStatusCard();
        updateDirtyState();
    });
}

function wireFooter() {
    root.querySelector('[data-act="reset"]')?.addEventListener('click', () => {
        draft = {
            values: { ...current.snapshot.values },
            disabled: current.snapshot.disabled,
            note: '',
        };
        renderEditor();
    });
    root.querySelector('[data-act="save"]')?.addEventListener('click', handleSave);
}

function refreshStatusCard() {
    root.querySelector('.vm-status-card')?.classList.toggle('is-disabled', draft.disabled);
    root.querySelector('.vm-switch')?.classList.toggle('is-on', !draft.disabled);

    const switchLabel = root.querySelector('.vm-switch__label');
    if (switchLabel) switchLabel.textContent = draft.disabled ? 'Kapalı' : 'Aktif';

    const hint = root.querySelector('.vm-status-card__hint');
    if (hint) hint.textContent = statusHint(draft.disabled, !canEditUnitStatus());

    const badge = root.querySelector('[data-role="badge"]');
    if (badge) {
        badge.textContent = draft.disabled ? 'Kapalı' : 'Aktif';
        badge.classList.toggle('vm-badge--off', draft.disabled);
        badge.classList.toggle('vm-badge--on', !draft.disabled);
    }
}

/* ──────────────────────── kaydetme ──────────────────────── */

/** Kaydedilmeyi bekleyen degisikliklerin etiketleri. */
function pendingChanges() {
    if (!draft || !current?.snapshot) return [];
    const labels = [];
    for (const field of getUnitFields({ visibleOnly: true })) {
        if (field.editable === false) continue;
        const before = current.snapshot.values[field.key] ?? '';
        const after = String(draft.values[field.key] ?? '').trim();
        if (before !== after) labels.push(field.label);
    }
    if (canEditUnitStatus() && draft.disabled !== current.snapshot.disabled) labels.push('Durum');
    return labels;
}

function updateDirtyState() {
    const button = root.querySelector('[data-act="save"]');
    if (!button) return;

    const changes = pendingChanges();
    const readOnly = !canWrite();

    button.disabled = changes.length === 0 || readOnly;
    button.textContent = changes.length
        ? `Onayla ve kaydet (${changes.length})`
        : 'Onayla ve kaydet';

    const hint = root.querySelector('[data-role="dirty"]');
    if (hint) {
        hint.textContent = readOnly
            ? 'Salt okunur: yazma ucu tanımlı değil'
            : changes.length
                ? changes.join(', ')
                : 'Kaydedilmemiş değişiklik yok';
        hint.classList.toggle('is-warn', readOnly);
    }
}

async function handleSave() {
    const missing = getUnitFields({ visibleOnly: true })
        .find(f => f.required && f.editable !== false && !String(draft.values[f.key] || '').trim());
    if (missing) {
        toast(`"${missing.label}" alanı boş bırakılamaz.`, 'error');
        root.querySelector(`[data-field="${missing.key}"]`)?.focus();
        return;
    }

    const button = root.querySelector('[data-act="save"]');
    const changeCount = pendingChanges().length;
    button.disabled = true;
    button.textContent = 'Kaydediliyor…';

    const result = await saveUnit({
        id: current.snapshot.id,
        values: draft.values,
        disabled: draft.disabled,
        note: draft.note,
        editor: hooks.editorName?.() || '',
    });

    if (!result.ok) {
        toast(result.error || 'Kaydedilemedi.', 'error', 9000);
        updateDirtyState();
        return;
    }
    if (result.noop) {
        toast('Kaydedilecek değişiklik yok.', 'info');
        updateDirtyState();
        return;
    }

    toast(`${changeCount} değişiklik Sheets'e kaydedildi.`, 'success');
    if (result.logWarning) toast(result.logWarning, 'warn', 10000);

    /* Depo yerinde guncellendi — panel ve harita yeni degerlerle tazelenir. */
    const fresh = unitSnapshot(current.snapshot.id);
    current.snapshot = fresh;
    draft = { values: { ...fresh.values }, disabled: fresh.disabled, note: '' };
    renderEditor();
    hooks.onSaved?.(current.snapshot.id);
}
