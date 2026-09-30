/**
 * Inmapper · Apps Script Sheet Writer (ortak)
 * ───────────────────────────────────────────
 *
 * Bu script TEK bir uçtan iki aracı birden besler:
 *
 *   • Kiosk editörü (Birimler / Kategoriler sekmeleri)
 *       → upsertRows (deleteKeys dahil), updateRow
 *   • Venue Manager (birim yönetimi aracı)
 *       → upsertRows + appendRows (değişiklik günlüğü)
 *
 * Kiosk editörünün v1.0.0 yazıcısının ÜST KÜMESİDİR: eski işlemlerin
 * hiçbiri kaldırılmadı, davranışları değişmedi. Elinizde v1.0.0 kuruluysa
 * bu dosyayı üzerine yapıştırıp yeni sürüm olarak yayınlamanız yeterli;
 * editör tarafında hiçbir şey bozulmaz.
 *
 * KURULUM
 * -------
 *   1. Sheet'i açın → Uzantılar → Apps Script (ya da script.google.com).
 *   2. Bu dosyanın TÜM içeriğini Code.gs içine yapıştırın.
 *   3. Deploy → New deployment → Web app
 *        - Execute as     : Me
 *        - Who has access : Anyone      ("Anyone with Google account" DEĞİL)
 *      Deploy → /exec ile biten adresi kopyalayın.
 *   4. Adresi şu iki yere (kullandığınıza) yazın:
 *        - Kiosk editörü → Ayarlar → "Sheets Yazma Endpoint"
 *        - Venue Manager → src/config.js → venue.sheets.writeEndpointUrl
 *
 *   Kodu her değiştirdiğinizde: Deploy → Manage deployments → kalem →
 *   Version: "New version" → Deploy. Sadece kaydetmek YETMEZ.
 *
 * DESTEKLENEN İŞLEMLER
 * --------------------
 *   GET  ?op=ping
 *     → { ok: true, version: "..." }
 *
 *   POST { op: "upsertRows", sheetId, tab, keyColumn, rows[], deleteKeys[] }
 *     - keyColumn ile satırları bul → yalnızca gönderilen kolonları yaz.
 *     - Bulunamayan anahtarlar yeni satır olarak eklenir.
 *     - deleteKeys: bu anahtarlara sahip satırları siler.
 *
 *   POST { op: "updateRow", sheetId, tab, keyColumn, key, values }
 *     - Tek satır kısayolu; upsertRows'a devreder.
 *
 *   POST { op: "appendRows", sheetId, tab, rows[] }
 *     - Sekmenin sonuna satır ekler (değişiklik günlüğü).
 *     - Sayfa boşsa başlık satırını gelen anahtarlardan oluşturur.
 *
 * GÜVENLİK
 * --------
 * "Who has access: Anyone", adresi bilen herkesin yazabileceği anlamına
 * gelir. İki katman:
 *   1. ALLOWED_SHEET_IDS — hangi dosyalara yazılabileceğini sınırlar.
 *   2. SHARED_SECRET     — doldurursanız istemci her istekte aynı değeri
 *                          `secret` alanında göndermek zorundadır.
 *                          (Venue Manager: config.js → writeSecret)
 */

const VERSION = '2.2.0';

/* Allowlist — boş bırakırsanız TÜM sheet'ler yazılabilir. */
const ALLOWED_SHEET_IDS = [
  '1LmrgPFPTt5mjXs0rMKVVP8_wibGuPGZevzGRwnWgyE4',
];

/* Boş bırakılırsa doğrulama yapılmaz. */
const SHARED_SECRET = '';

function doGet(e) {
  const op = (e && e.parameter && e.parameter.op || '').toLowerCase();
  if (op === 'ping') return jsonOut({ ok: true, version: VERSION });
  return jsonOut({ ok: false, error: 'Unsupported GET. Use POST.' });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut({ ok: false, error: 'Geçersiz JSON' });
  }

  if (SHARED_SECRET && String(body.secret || '') !== SHARED_SECRET) {
    return jsonOut({ ok: false, error: 'Yetkisiz istek' });
  }

  const op = String(body.op || '').trim();
  if (op === 'ping') return jsonOut({ ok: true, version: VERSION });

  /* İki yönetici aynı anda kaydettiğinde satırların birbirini ezmesini
   * engeller. Günlük sekmesine eşzamanlı ekleme için de gerekli. */
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return jsonOut({ ok: false, error: 'Sheet meşgul, lütfen tekrar deneyin' });
  }

  try {
    switch (op) {
      case 'upsertRows': return handleUpsertRows(body);
      case 'updateRow':  return handleUpdateRow(body);
      case 'appendRows': return handleAppendRows(body);
      default:           return jsonOut({ ok: false, error: 'Unknown op: ' + op });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ──────────────────────── handlers ─────────────────────────────── */

function handleUpsertRows(body) {
  const sheetId = body.sheetId;
  const tab = body.tab;
  const keyColumn = body.keyColumn;
  const rows = body.rows || [];
  const deleteKeys = body.deleteKeys || [];

  guardSheetId(sheetId);
  if (!tab) throw new Error('tab boş');
  if (!keyColumn) throw new Error('keyColumn boş');

  const sheet = openTab(sheetId, tab);
  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error('Sayfa boş — header bulunamadı');

  const header = values[0].map(String);
  const keyIdx = header.indexOf(keyColumn);
  if (keyIdx < 0) throw new Error('keyColumn "' + keyColumn + '" header\'da yok');

  /* Gelen satırlarda başlıkta olmayan kolon varsa (örn. Disabled) başlığı
   * genişlet — sheet'i elle düzenlemeye gerek kalmasın. */
  extendHeader(sheet, header, rows);

  /* Silinecek anahtarları raporlayabilmek için silmeden önce indeksle. */
  const existedBefore = {};
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][keyIdx] || '').trim();
    if (key) existedBefore[key] = true;
  }

  /* ── 1. Silmeler ──────────────────────────────────────────────
   * Satır silindiğinde alttakiler yukarı kayar; bu yüzden aşağıdan
   * yukarıya doğru siliyoruz.
   *
   * DİKKAT: Anahtar başına YALNIZCA BİR satır silinir (son eşleşen).
   * Bu sheet'te aynı ID'yi paylaşan satırlar var (bir poligonda birden
   * fazla işletme — örn. ID-245'te dört mekan). Tüm eşleşmeleri silmek
   * "ID-245'i sil" isteğinde dört kaydı birden uçururdu. v1.0.0
   * davranışı da böyleydi; bilinçli olarak korundu. */
  const deleted = [];
  if (deleteKeys.length) {
    const lastRowOf = {};
    for (let i = 1; i < values.length; i++) {
      const key = String(values[i][keyIdx] || '').trim();
      if (key) lastRowOf[key] = i + 1; // 1 tabanlı satır numarası
    }
    const rowsToDelete = [];
    for (let d = 0; d < deleteKeys.length; d++) {
      const key = String(deleteKeys[d] || '').trim();
      if (!key || lastRowOf[key] === undefined) continue;
      rowsToDelete.push(lastRowOf[key]);
      deleted.push(key);
    }
    rowsToDelete.sort(function (a, b) { return b - a; });
    for (let r = 0; r < rowsToDelete.length; r++) sheet.deleteRow(rowsToDelete[r]);
  }

  /* ── 2. Ekle / güncelle ───────────────────────────────────────
   * Silmelerden sonra tabloyu yeniden okuyoruz. */
  const fresh = sheet.getDataRange().getValues();
  const keyRow = {};
  for (let i = 1; i < fresh.length; i++) {
    const key = String(fresh[i][keyIdx] || '').trim();
    if (key) keyRow[key] = i;
  }

  const updated = [];
  const inserted = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || {};
    const key = String(row[keyColumn] || '').trim();
    if (!key) continue;

    const existing = keyRow[key];
    if (existing !== undefined) {
      /* Yalnızca gönderilen kolonların HÜCRELERİ yazılır.
       *
       * Bütün satırı setValues ile bir kerede yazmak cazip görünür ama
       * yıkıcıdır: getValues() formülleri değil hesaplanmış DEĞERLERİ
       * döndürdüğü için, dokunmadığımız kolonlardaki formüller sabit
       * değere dönüşür. Örn. Logo kolonu "=M$1&K2" gibi bir birleştirme
       * formülüyse tek bir kaydetme onu kalıcı olarak düz metne çevirir.
       * Bu yüzden hücre hücre yazıyoruz. */
      const rowNumber = existing + 1;
      for (let c = 0; c < header.length; c++) {
        if (Object.prototype.hasOwnProperty.call(row, header[c])) {
          sheet.getRange(rowNumber, c + 1).setValue(row[header[c]]);
        }
      }
      updated.push(key);
    } else {
      sheet.appendRow(header.map(function (h) {
        return Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '';
      }));
      inserted.push(key);
    }
  }

  return jsonOut({
    ok: true,
    updated: updated,
    inserted: inserted,
    deleted: deleted.filter(function (k) { return existedBefore[k]; }),
    version: VERSION,
  });
}

function handleUpdateRow(body) {
  const values = body.values || {};
  const row = {};
  for (const k in values) {
    if (Object.prototype.hasOwnProperty.call(values, k)) row[k] = values[k];
  }
  row[body.keyColumn] = body.key;

  return handleUpsertRows({
    sheetId: body.sheetId,
    tab: body.tab,
    keyColumn: body.keyColumn,
    rows: [row],
  });
}

/**
 * Sekmenin sonuna satır ekler — değişiklik günlüğü için.
 * Sayfa tamamen boşsa gelen ilk satırın anahtarlarından başlık oluşturur.
 */
function handleAppendRows(body) {
  const sheetId = body.sheetId;
  const tab = body.tab;
  const rows = body.rows || [];

  guardSheetId(sheetId);
  if (!tab) throw new Error('tab boş');
  if (!rows.length) return jsonOut({ ok: true, appended: 0 });

  const sheet = openTab(sheetId, tab);
  let header = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(String)
    : [];

  if (!header.length || header.join('').trim() === '') {
    header = Object.keys(rows[0]);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  extendHeader(sheet, header, rows);

  const matrix = rows.map(function (row) {
    return header.map(function (h) {
      return Object.prototype.hasOwnProperty.call(row, h) ? row[h] : '';
    });
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, header.length).setValues(matrix);
  return jsonOut({ ok: true, appended: matrix.length });
}

/* ──────────────────────── helpers ──────────────────────────────── */

/**
 * Gelen satırlarda başlıkta olmayan kolon varsa başlığı sağa doğru
 * genişletir. `header` dizisi yerinde güncellenir.
 */
function extendHeader(sheet, header, rows) {
  const newCols = [];
  for (let i = 0; i < (rows || []).length; i++) {
    const keys = Object.keys(rows[i] || {});
    for (let k = 0; k < keys.length; k++) {
      const col = keys[k];
      if (col && header.indexOf(col) < 0 && newCols.indexOf(col) < 0) newCols.push(col);
    }
  }
  if (!newCols.length) return;
  sheet.getRange(1, header.length + 1, 1, newCols.length).setValues([newCols]);
  for (let n = 0; n < newCols.length; n++) header.push(newCols[n]);
}

function guardSheetId(id) {
  if (!id) throw new Error('sheetId boş');
  if (ALLOWED_SHEET_IDS.length && ALLOWED_SHEET_IDS.indexOf(id) < 0) {
    throw new Error('İzin verilmeyen sheetId');
  }
}

/** `tab` sekme adı ya da sayısal gid olabilir. */
function openTab(sheetId, tab) {
  const ss = SpreadsheetApp.openById(sheetId);
  if (/^\d+$/.test(String(tab))) {
    const gid = Number(tab);
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === gid) return sheets[i];
    }
    throw new Error('gid bulunamadı: ' + tab);
  }
  const sheet = ss.getSheetByName(String(tab));
  if (!sheet) throw new Error('Sayfa bulunamadı: ' + tab);
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
