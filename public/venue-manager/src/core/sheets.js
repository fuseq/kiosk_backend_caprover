/**
 * Google Sheets istemcisi — okuma (gviz) + yazma (Apps Script web app).
 *
 * OKUMA
 *   https://docs.google.com/spreadsheets/d/{sheetId}/gviz/tq?tqx=out:csv&sheet={Sekme}
 *   Sekme adi tamamen rakamsa `gid=` parametresi kullanilir.
 *   Sheet "baglantiyi bilen herkes" ile paylasilmis olmali; aksi halde
 *   Google HTTP 200 ile giris HTML'i dondurur — bunu tespit edip hata veriyoruz.
 *
 * YAZMA
 *   tools/apps-script/venue-manager.gs dosyasindan deploy edilen web app'e
 *   POST atar. Content-Type bilerek `text/plain` — aksi halde tarayici CORS
 *   preflight tetikler ve GoogleUserContent bunu engeller.
 *
 * Kiosk projesindeki `src/core/sheets.js` + `src/editor/sheet-writer.js`
 * dosyalarinin birlesimi.
 */

import { parseCSV, parseCsvHeaders } from './csv.js';
import { config } from '../config.js';

const GVIZ_BASE = 'https://docs.google.com/spreadsheets/d';

/* ─────────────────────────── okuma ─────────────────────────── */

export function makeSheetUrl(sheetId, tab) {
    if (!sheetId || !tab) return null;
    const tabStr = String(tab).trim();
    if (!tabStr) return null;
    if (/^\d+$/.test(tabStr)) {
        return `${GVIZ_BASE}/${sheetId}/gviz/tq?tqx=out:csv&gid=${tabStr}`;
    }
    return `${GVIZ_BASE}/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabStr)}`;
}

async function fetchSheetCsv(sheetId, tab) {
    const url = makeSheetUrl(sheetId, tab);
    if (!url) throw new Error('sheets: sheetId veya sekme adi bos');

    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`sheets: HTTP ${res.status} — "${tab}" sekmesi okunamadi`);

    const text = await res.text();
    /* Paylasim kapaliysa Google 200 ile giris sayfasi doner. */
    const head = text.slice(0, 200).trim().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html')) {
        throw new Error(
            `sheets: "${tab}" sekmesi okunamadi. Sheet'i "Baglantiyi bilen herkes → Goruntuleyen" olarak paylasin.`
        );
    }
    return text;
}

/** Bir sekmeyi baslik anahtarli nesne dizisi olarak getirir. */
export async function fetchSheetTab(sheetId, tab) {
    return parseCSV(await fetchSheetCsv(sheetId, tab));
}

/** Bir sekmenin yalnizca baslik satirini getirir (sema dogrulamasi icin). */
export async function fetchSheetHeaders(sheetId, tab) {
    return parseCsvHeaders(await fetchSheetCsv(sheetId, tab));
}

/* ─────────────────────────── yazma ─────────────────────────── */

function resolveEndpoint(explicit) {
    const url = explicit || config.venue.sheets.writeEndpointUrl;
    return String(url || '').trim();
}

async function postOp(payload, endpointUrl) {
    const url = resolveEndpoint(endpointUrl);
    if (!url) return { ok: false, error: 'Yazma ucu (writeEndpointUrl) tanimli degil' };

    const secret = String(config.venue.sheets.writeSecret || '').trim();
    const requestBody = secret ? { ...payload, secret } : payload;

    try {
        const res = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(requestBody),
        });
        const text = await res.text();

        let responseBody;
        try {
            responseBody = JSON.parse(text);
        } catch {
            return { ok: false, error: `Gecersiz yanit: ${text.slice(0, 200)}` };
        }
        if (!res.ok || responseBody?.ok === false) {
            return { ok: false, error: responseBody?.error || `HTTP ${res.status}` };
        }
        return { ok: true, ...responseBody };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
}

export const sheetWriter = {
    /**
     * Satirlari `keyColumn` uzerinden eslestirip gunceller, bulunmayanlari
     * ekler. Yalnizca gonderilen kolonlar yazilir; digerlerine dokunulmaz.
     */
    async upsertRows({ sheetId, tab, keyColumn, rows, endpointUrl }) {
        return postOp({
            op: 'upsertRows',
            sheetId,
            tab,
            keyColumn,
            rows: rows || [],
            deleteKeys: [],
        }, endpointUrl);
    },

    /**
     * Sekmenin sonuna satir ekler — degisiklik gunlugu icin. Baslikta
     * olmayan kolonlar otomatik olarak baslik satirina eklenir.
     */
    async appendRows({ sheetId, tab, rows, endpointUrl }) {
        return postOp({
            op: 'appendRows',
            sheetId,
            tab,
            rows: rows || [],
        }, endpointUrl);
    },

    /** Ucun ayakta olup olmadigini kontrol eder. */
    async ping(endpointUrl) {
        const url = resolveEndpoint(endpointUrl);
        if (!url) return { ok: false, error: 'Yazma ucu tanimli degil' };
        try {
            const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'op=ping', {
                method: 'GET',
                mode: 'cors',
            });
            const text = await res.text();
            try {
                const json = JSON.parse(text);
                return { ok: !!json?.ok, ...json };
            } catch {
                return { ok: false, error: `Gecersiz yanit: ${text.slice(0, 200)}` };
            }
        } catch (err) {
            return { ok: false, error: err?.message || String(err) };
        }
    },
};
