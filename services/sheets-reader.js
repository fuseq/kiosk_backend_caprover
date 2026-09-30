const { parseCSV } = require('../utils/csv');

const GVIZ_BASE = 'https://docs.google.com/spreadsheets/d';

function makeSheetUrl(sheetId, tab) {
  if (!sheetId || !tab) return null;
  const tabStr = String(tab).trim();
  if (!tabStr) return null;
  if (/^\d+$/.test(tabStr)) {
    return `${GVIZ_BASE}/${sheetId}/gviz/tq?tqx=out:csv&gid=${tabStr}`;
  }
  return `${GVIZ_BASE}/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabStr)}`;
}

async function fetchSheetTab(sheetId, tab) {
  const url = makeSheetUrl(sheetId, tab);
  if (!url) throw new Error('sheets: missing sheetId or tab');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`sheets: HTTP ${r.status} for ${tab}`);
  const text = await r.text();
  if (/^\s*<!DOCTYPE|^\s*<html/i.test(text)) {
    throw new Error(`sheets: tab "${tab}" not accessible (share with "Anyone with the link")`);
  }
  return parseCSV(text);
}

function pickTab(sheetsCfg, key, ...legacyKeys) {
  if (!sheetsCfg) return null;
  const fromTabs = sheetsCfg.tabs?.[key];
  if (fromTabs && String(fromTabs).trim()) return String(fromTabs).trim();
  for (const k of legacyKeys) {
    const v = sheetsCfg[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

module.exports = { fetchSheetTab, pickTab, makeSheetUrl };
