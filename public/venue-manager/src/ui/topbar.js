/**
 * Ust cubuk: mekan adi, kat secici, birim arama, yenileme ve oturum kimligi.
 */

import { config, floorLabel } from '../config.js';
import { allUnits } from '../data/units-repo.js';
import { KEY_COLUMN, DISABLED_COLUMN, isDisabledValue, readField } from '../data/unit-schema.js';

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let root = null;
let hooks = {};
let currentEditorEmail = '';

export function initTopbar(element, callbacks = {}, editorEmail = '') {
    root = element;
    hooks = callbacks;
    currentEditorEmail = String(editorEmail || '').trim();

    root.innerHTML = `
        <div class="vm-topbar__brand">
            <span class="vm-topbar__mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                     stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/>
                    <path d="M9 21v-6h6v6"/>
                </svg>
            </span>
            <span class="vm-topbar__titles">
                <strong data-role="venue-name">${escapeHtml(config.venue.name || '—')}</strong>
                <small>Birim Yönetimi</small>
            </span>
        </div>

        <div class="vm-search" role="search">
            <svg class="vm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>
            </svg>
            <input class="vm-search__input" type="search" placeholder="Birim adı veya kimliği ara…"
                   autocomplete="off" aria-label="Birim ara" />
            <div class="vm-search__results" role="listbox" hidden></div>
        </div>

        <div class="vm-floors" role="group" aria-label="Kat seçimi"></div>

        <div class="vm-topbar__right">
            <div class="vm-view-mode" role="group" aria-label="Harita görünümü">
                <button type="button" class="vm-view-mode__btn is-active" data-view="2d" aria-pressed="true">2D</button>
                <button type="button" class="vm-view-mode__btn" data-view="3d" aria-pressed="false">3D</button>
            </div>
            <span class="vm-editor" title="${escapeHtml(currentEditorEmail)}">
                <span class="vm-editor__label">Düzenleyen</span>
                <span class="vm-editor__identity">${escapeHtml(currentEditorEmail || '—')}</span>
            </span>
            <span class="vm-status" data-role="status"></span>
            <button type="button" class="vm-btn vm-btn--ghost" data-act="refresh">Yenile</button>
        </div>
    `;

    wireSearch();
    wireViewMode();
    root.querySelector('[data-act="refresh"]').addEventListener('click', () => hooks.onRefresh?.());
}

function wireViewMode() {
    root.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', () => {
            setViewMode(button.dataset.view);
            hooks.onViewModeChange?.(button.dataset.view);
        });
    });
}

export function setViewMode(mode) {
    const next = mode === '3d' ? '3d' : '2d';
    root?.querySelectorAll('[data-view]').forEach((button) => {
        const active = button.dataset.view === next;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

export function setVenueName(name) {
    const el = root?.querySelector('[data-role="venue-name"]');
    if (el) el.textContent = name || '—';
}

/* ──────────────────────── kat secici ──────────────────────── */

export function setFloors(floors, activeFloor) {
    const host = root.querySelector('.vm-floors');
    host.innerHTML = floors.map(key => `
        <button type="button" class="vm-floor ${String(key) === String(activeFloor) ? 'is-active' : ''}"
                data-floor="${escapeHtml(key)}" aria-pressed="${String(key) === String(activeFloor)}">
            ${escapeHtml(floorLabel(key))}
        </button>
    `).join('');

    host.querySelectorAll('[data-floor]').forEach((button) => {
        button.addEventListener('click', () => {
            setActiveFloor(button.dataset.floor);
            hooks.onFloorChange?.(button.dataset.floor);
        });
    });
}

export function setActiveFloor(activeFloor) {
    root.querySelectorAll('[data-floor]').forEach((button) => {
        const active = button.dataset.floor === String(activeFloor);
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

/* ──────────────────────── durum gostergesi ──────────────────────── */

/** @param {'ok'|'warn'|'error'|'busy'} kind */
export function setStatus(text, kind = 'ok') {
    const el = root.querySelector('[data-role="status"]');
    el.textContent = text;
    el.className = `vm-status vm-status--${kind}`;
    el.hidden = !text;
}

/* ──────────────────────── arama ──────────────────────── */

function wireSearch() {
    const input = root.querySelector('.vm-search__input');
    const results = root.querySelector('.vm-search__results');

    const close = () => { results.hidden = true; results.innerHTML = ''; };

    input.addEventListener('input', () => {
        const query = input.value.trim().toLocaleLowerCase('tr');
        if (query.length < 2) return close();

        const matches = allUnits()
            .map(row => ({
                id: String(row[KEY_COLUMN] || '').trim(),
                title: readField(row, { key: 'Title' }),
                floor: readField(row, { key: 'Floor' }),
                disabled: isDisabledValue(row[DISABLED_COLUMN]),
            }))
            .filter(unit => unit.id
                && (unit.title.toLocaleLowerCase('tr').includes(query)
                    || unit.id.toLocaleLowerCase('tr').includes(query)))
            .slice(0, 12);

        if (!matches.length) {
            results.innerHTML = '<div class="vm-search__empty">Sonuç yok</div>';
            results.hidden = false;
            return;
        }

        results.innerHTML = matches.map(unit => `
            <button type="button" class="vm-search__item" role="option" data-unit="${escapeHtml(unit.id)}">
                <span class="vm-search__item-name">${escapeHtml(unit.title || unit.id)}</span>
                <span class="vm-search__item-meta">
                    ${escapeHtml(unit.id)}${unit.floor ? ` · ${escapeHtml(floorLabel(unit.floor))}` : ''}
                    ${unit.disabled ? '<span class="vm-search__off">Kapalı</span>' : ''}
                </span>
            </button>
        `).join('');
        results.hidden = false;

        results.querySelectorAll('[data-unit]').forEach((button) => {
            button.addEventListener('click', () => {
                hooks.onPickUnit?.(button.dataset.unit);
                input.value = '';
                close();
            });
        });
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { input.value = ''; close(); }
    });

    document.addEventListener('click', (event) => {
        if (!root.querySelector('.vm-search').contains(event.target)) close();
    });
}

/** Değişiklik günlüğünde gösterilecek giriş e-postası. */
export function editorName() {
    return currentEditorEmail;
}
