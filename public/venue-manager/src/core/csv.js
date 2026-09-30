/**
 * RFC-tarzi CSV ayristirici.
 *
 * Kiosk projesindeki `src/core/utils.js` icinden birebir tasindi — Google
 * Sheets'in gviz CSV cikisi tirnak icinde satir sonu barindirabildigi icin
 * naif `split('\n')` kullanilamaz.
 */

/** Tek bir CSV satirini alanlara boler; "" kacisini destekler. */
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current);
    return result;
}

/* Tirnak farkindali satir bolucu: \n yalnizca tirnak DISINDA satir sonu
 * sayilir. Aksi halde cok paragrafli bir Description kolonu her paragrafi
 * yeni bir birim gibi gosterir. */
function splitCsvRows(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') {
                current += '""';
                i++;
            } else {
                inQuotes = !inQuotes;
                current += ch;
            }
        } else if (ch === '\n' && !inQuotes) {
            rows.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.length > 0) rows.push(current);
    return rows;
}

/**
 * CSV metnini nesne dizisine cevirir. Ilk satir baslik kabul edilir ve
 * anahtarlar olarak kullanilir (bosluklar kirpilir).
 */
export function parseCSV(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = splitCsvRows(normalized);
    if (rows.length === 0) return [];
    const headers = parseCsvLine(rows[0]);
    return rows.slice(1)
        .filter(line => line.trim())
        .map(line => {
            const values = parseCsvLine(line);
            const obj = {};
            headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
            return obj;
        });
}

/** Basliklari ayri dondurur — sekme semasini dogrulamak icin. */
export function parseCsvHeaders(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = splitCsvRows(normalized);
    if (!rows.length) return [];
    return parseCsvLine(rows[0]).map(h => h.trim());
}
