/**
 * Venue Manager · uygulama girisi
 * ───────────────────────────────
 * Katmanlari birbirine bagladigi tek yer. Veri (Sheets) → harita → panel
 * akisini kurar; her katman digerini yalnizca burada tanimlanan geri
 * cagirmalar uzerinden gorur.
 */

import { canWrite, config, ensureConfig, sheetTab } from './config.js';
import { fetchCurrentUser } from './core/api.js';
import { loadCategories } from './data/categories.js';
import { getMissingColumns, loadUnits } from './data/units-repo.js';
import { DISABLED_COLUMN } from './data/unit-schema.js';
import { createMapView } from './map/map-view.js';
import { hideIsland, initIsland, refreshIsland, showUnit } from './ui/island.js';
import { editorName, initTopbar, setActiveFloor, setFloors, setStatus, setVenueName, setViewMode } from './ui/topbar.js';
import { toast } from './ui/toast.js';

const $ = (id) => document.getElementById(id);

let mapView = null;

function readThemeHint() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('theme');
    if (fromUrl === 'dark' || fromUrl === 'light') return fromUrl;
    try {
        const saved = localStorage.getItem('inmapper-theme');
        if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* ignore */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('inmapper-theme', next); } catch { /* ignore */ }
    mapView?.applyThemePaint?.();
}

function wireThemeBridge() {
    applyTheme(readThemeHint());
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.type !== 'inmapper-theme') return;
        applyTheme(data.theme);
    });
}

async function boot() {
    wireThemeBridge();

    const loader = $('vmLoader');
    const loaderText = $('vmLoaderText');

    if (typeof maplibregl === 'undefined') {
        fail('MapLibre yüklenemedi. İnternet bağlantınızı kontrol edin.');
        return;
    }

    try {
        loaderText.textContent = 'Venue yapılandırması…';
        await ensureConfig();
        const currentUser = await fetchCurrentUser();

        loaderText.textContent = 'Kategoriler alınıyor…';
        const categories = await loadCategories();

        loaderText.textContent = 'Birim listesi alınıyor…';
        const units = await loadUnits();

        loaderText.textContent = 'Harita hazırlanıyor…';
        mapView = createMapView({
            container: 'vmMap',
            onSelect: handleSelect,
            onDeselect: handleDeselect,
        });
        const { floors, floor } = await mapView.init();
        mapView.applyThemePaint();

        initTopbar($('vmTopbar'), {
            onFloorChange: (key) => {
                mapView.setFloor(key);
                hideIsland();
                mapView.select(null);
            },
            onRefresh: refreshData,
            onPickUnit: focusUnitById,
            onViewModeChange: (mode) => mapView.setViewMode(mode),
        }, currentUser.email);
        setVenueName(config.venue.name);
        setFloors(floors, floor);
        setViewMode(mapView.getViewMode());

        initIsland($('vmIsland'), {
            onSaved: () => mapView.repaint(),
            onClosed: () => mapView.select(null),
            onFocusUnit: (featureId) => mapView.focusUnit(featureId),
            editorName,
        });

        loader.classList.add('is-hidden');
        reportHealth({ units, categories });
    } catch (err) {
        console.error(err);
        fail(err.message || String(err));
    }
}

function fail(message) {
    const loader = $('vmLoader');
    loader.classList.add('is-error');
    $('vmLoaderText').textContent = message;
}

/* ──────────────────────── secim akisi ──────────────────────── */

function handleSelect({ featureId, unitId, properties }) {
    showUnit({ featureId, unitId, properties });
}

function handleDeselect() {
    hideIsland();
}

/** Aramadan gelen birim kimligini haritada bulup secer. */
function focusUnitById(unitId) {
    const featureId = mapView.findFeatureIdByUnitId(unitId);
    if (!featureId) {
        toast(
            `"${unitId}" haritada seçilemedi — Title eşleşmesi veya poligon olmayabilir.`,
            'warn',
            7000,
        );
        return;
    }
    const focused = mapView.focusUnit(featureId);
    setActiveFloor(mapView.getFloor());
    mapView.select(featureId);
    showUnit({ featureId, unitId, properties: focused?.properties });
}

/* ──────────────────────── tazeleme ──────────────────────── */

async function refreshData() {
    setStatus('Yenileniyor…', 'busy');
    try {
        await loadCategories();
        const units = await loadUnits();
        mapView.repaint();
        refreshIsland();
        setStatus('', 'ok');
        toast(`${units.count} birim yenilendi.`, 'success');
        warnMissingColumns();
    } catch (err) {
        setStatus('Yenilenemedi', 'error');
        toast(err.message || String(err), 'error', 9000);
    }
}

/* ──────────────────────── saglik kontrolu ──────────────────────── */

function reportHealth({ units, categories }) {
    if (categories.warning) toast(categories.warning, 'warn', 8000);

    if (!canWrite()) {
        setStatus('Salt okunur', 'warn');
    } else if (!sheetTab('changes')) {
        setStatus('Günlük kapalı', 'warn');
        toast(
            'Değişiklik günlüğü sekmesi tanımlı değil. Düzenlemeler kaydedilir '
            + 'ancak geçmiş tutulmaz. Admin, Müşteriler → Birim Alanları bölümünden tanımlayabilir.',
            'warn', 10000
        );
    } else {
        setStatus(`${units.count} birim`, 'ok');
    }

    warnMissingColumns();
}

function warnMissingColumns() {
    const missing = getMissingColumns();
    if (!missing.length) return;

    const hasDisabled = !missing.includes(DISABLED_COLUMN);
    const message = `Liste sekmesinde gerekli kolon(lar) eksik: ${missing.join(', ')}.`
        + (hasDisabled ? '' : ` "${DISABLED_COLUMN}" kolonu olmadan birim aktif/kapalı durumu takip edilemez.`);
    toast(message, 'warn', 12000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
