/**
 * Sheets kurulum teshisi.
 * ───────────────────────
 * Araci tarayicida acmadan once yapilandirmanin dogru olup olmadigini
 * kontrol eder:
 *
 *   • yazma ucu ayakta mi, hangi surum
 *   • liste / kategori sekmeleri okunabiliyor mu
 *   • semada beklenen kolonlar var mi
 *   • degisiklik gunlugu sekmesi gercekten var mi
 *
 * Son madde onemli: gviz, olmayan bir sekme adi istendiginde hata vermez,
 * sessizce DOSYANIN ILK SEKMESINI dondurur. Bu yuzden sekme varligini
 * "icerik ilk sekmeyle ayni mi" testiyle dolayli olarak anliyoruz.
 *
 * Kullanim: npm run check:sheets
 */

import { config, sheetTab } from '../src/config.js';
import { parseCsvHeaders } from '../src/core/csv.js';
import { UNIT_FIELDS, DISABLED_COLUMN, KEY_COLUMN } from '../src/data/unit-schema.js';

const sheetId = config.venue.sheets.sheetId;
const GVIZ = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=`;

const ok = (m) => console.log(`  \u2713 ${m}`);
const bad = (m) => { console.log(`  \u2717 ${m}`); problems++; };
const warn = (m) => console.log(`  ! ${m}`);
let problems = 0;

/** Apps Script tarafinda beklenen en dusuk surum. */
const MIN_SCRIPT_VERSION = '2.2.0';

/** "2.10.0" > "2.9.0" dogru sonuclansin diye parca parca sayisal karsilastirma. */
function versionBelow(actual, minimum) {
    const a = String(actual || '0').split('.').map(Number);
    const b = minimum.split('.').map(Number);
    for (let i = 0; i < b.length; i++) {
        const x = a[i] || 0;
        if (x !== b[i]) return x < b[i];
    }
    return false;
}

async function fetchTab(tab) {
    const res = await fetch(GVIZ + encodeURIComponent(tab), { redirect: 'follow' });
    const text = await res.text();
    const head = text.slice(0, 200).trim().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html')) {
        return { ok: false, reason: 'paylaşım kapalı (HTML döndü)', status: res.status };
    }
    return { ok: true, text, status: res.status };
}

console.log(`\nSheet: ${sheetId}\n`);

/* ── 1. Yazma ucu ── */
console.log('Yazma ucu');
const endpoint = String(config.venue.sheets.writeEndpointUrl || '').trim();
if (!endpoint) {
    bad('writeEndpointUrl boş — araç salt okunur açılır');
} else {
    try {
        const res = await fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}op=ping`, { redirect: 'follow' });
        const body = JSON.parse(await res.text());
        if (!body.ok) {
            bad(`yanıt verdi ama ok:false — ${body.error}`);
        } else if (versionBelow(body.version, MIN_SCRIPT_VERSION)) {
            bad(`sürüm ${body.version} — en az ${MIN_SCRIPT_VERSION} gerekli. `
                + 'Apps Script projesini güncelleyip "Version: New version" ile yeniden yayınlayın.');
        } else {
            ok(`ayakta, sürüm ${body.version}`);
        }
    } catch (err) {
        bad(`erişilemedi — ${err.message}`);
    }
}

/* ── 2. Sekmeler ── */
console.log('\nSekmeler');
const firstTab = await fetchTab('__olmayan_sekme_testi__');
if (!firstTab.ok) {
    bad(`liste okunamadı — ${firstTab.reason}. Sheet'i "Bağlantıya sahip herkes → Görüntüleyen" yapın.`);
} else {
    const fingerprint = firstTab.text.slice(0, 400);

    for (const [name, label] of [['list', 'Liste'], ['categories', 'Kategoriler'], ['changes', 'Değişiklik günlüğü']]) {
        const tab = sheetTab(name);
        if (!tab) {
            warn(`${label}: config'de tanımlı değil`);
            continue;
        }
        const res = await fetchTab(tab);
        if (!res.ok) {
            bad(`${label} ("${tab}"): ${res.reason}`);
            continue;
        }
        /* Icerik ilk sekmeyle ayniysa gviz geri dusmus — sekme yok demektir.
         * Liste sekmesi zaten ilk sekme olabilir, onu muaf tutuyoruz. */
        if (name !== 'list' && res.text.slice(0, 400) === fingerprint) {
            bad(`${label} ("${tab}") BULUNAMADI — gviz sessizce ilk sekmeyi döndürdü. Bu adla boş bir sayfa oluşturun.`);
            continue;
        }
        /* Bos bir sayfada baslik satiri da yoktur; sayiyi negatife dusurmeyelim. */
        const lines = res.text.replace(/\r/g, '').split('\n').filter(l => l.trim()).length;
        ok(lines === 0
            ? `${label} ("${tab}"): boş — başlık satırı ilk kayıtta oluşacak`
            : `${label} ("${tab}"): ${lines - 1} satır`);

        if (name === 'list') {
            const headers = parseCsvHeaders(res.text);
            const expected = [
                KEY_COLUMN,
                DISABLED_COLUMN,
                ...UNIT_FIELDS.filter(field => field.required).map(field => field.key),
            ];
            const missing = expected.filter(k => !headers.includes(k));
            if (missing.length) bad(`  eksik kolon(lar): ${missing.join(', ')}`);
            else ok('  gerekli sistem ve zorunlu alan kolonları mevcut');
        }
    }
}

console.log(problems ? `\n${problems} sorun bulundu.\n` : '\nKurulum hazır.\n');
process.exit(problems ? 1 : 0);
