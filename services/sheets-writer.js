/**
 * Write rows back to venue sheet via Apps Script web app.
 * Contract (tools/apps-script/sheet-writer.gs):
 *   POST { op: 'upsertRows', sheetId, tab, keyColumn, rows[], deleteKeys[] }
 * Body is sent as text/plain to avoid the CORS preflight Apps Script blocks.
 */

async function upsertRows({ writeEndpointUrl, sheetId, tab, rows, keyColumn = 'ID', deleteKeys = [] }) {
  if (!writeEndpointUrl) {
    throw new Error('Venue sheets.writeEndpointUrl is not configured');
  }
  if (!sheetId || !tab) {
    throw new Error('sheetId / tab missing for sheet write');
  }
  const r = await fetch(writeEndpointUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ op: 'upsertRows', sheetId, tab, keyColumn, rows, deleteKeys })
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, error: `Geçersiz yanıt: ${text.slice(0, 200)}` }; }
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Sheet write failed (${r.status})`);
  }
  return data;
}

async function appendRows({ writeEndpointUrl, sheetId, tab, rows }) {
  if (!writeEndpointUrl) {
    throw new Error('Venue sheets.writeEndpointUrl is not configured');
  }
  if (!sheetId || !tab) {
    throw new Error('sheetId / tab missing for sheet write');
  }
  const r = await fetch(writeEndpointUrl, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ op: 'appendRows', sheetId, tab, rows: rows || [] })
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok: false, error: `Geçersiz yanıt: ${text.slice(0, 200)}` }; }
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Sheet append failed (${r.status})`);
  }
  return data;
}

module.exports = { upsertRows, appendRows };
