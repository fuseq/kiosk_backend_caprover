/**
 * Kategori paleti — backend API üzerinden.
 */

import { ensureConfig, config } from '../config.js';
import { fetchCategories } from '../core/api.js';

const FALLBACK = [
  { apiKey: 'fashion', color: '#e74c3c', displayName: 'Moda', order: 10 },
  { apiKey: 'food', color: '#e67e22', displayName: 'Yeme İçme', order: 20 },
  { apiKey: 'shop', color: '#3498db', displayName: 'Mağaza', order: 30 },
  { apiKey: 'market', color: '#16a085', displayName: 'Market', order: 40 },
  { apiKey: 'service', color: '#8e44ad', displayName: 'Hizmet', order: 50 },
  { apiKey: 'wc', color: '#7f8c8d', displayName: 'Tuvalet', order: 60 },
  { apiKey: 'atm', color: '#2c3e50', displayName: 'ATM', order: 70 },
  { apiKey: 'parking', color: '#34495e', displayName: 'Otopark', order: 80 },
  { apiKey: 'other', color: '#95a5a6', displayName: 'Diğer', order: 999 },
];

let byKey = new Map();
let source = 'none';

function install(list, from) {
  byKey = new Map(list.map(c => [c.apiKey, c]));
  source = from;
}

export async function loadCategories() {
  await ensureConfig();
  try {
    const data = await fetchCategories(config.venue.id);
    const list = (data.categories || []).map(c => ({
      apiKey: c.apiKey || c.id || c.name,
      color: c.color || '#95a5a6',
      displayName: c.displayName || c.name || c.apiKey || c.id,
      displayNameEn: c.displayNameEn || c.displayName || c.name || c.apiKey,
      icon: c.icon || '',
      order: Number.isFinite(c.order) ? c.order : 999,
    })).filter(c => c.apiKey);
    if (!list.length) throw new Error('Kategori listesi boş');
    install(list, 'api');
    return { source };
  } catch (err) {
    install(FALLBACK, 'fallback');
    return { source, warning: `Kategoriler okunamadı (${err.message}); varsayılan palet kullanıldı.` };
  }
}

export function allCategories() {
  return [...byKey.values()].sort((a, b) => a.order - b.order
    || a.displayName.localeCompare(b.displayName, 'tr'));
}

export function getCategory(apiKey) {
  return byKey.get(String(apiKey || '').trim()) || null;
}

export function categoryColor(apiKey) {
  return getCategory(apiKey)?.color || null;
}

export function categoryLabel(apiKey) {
  const key = String(apiKey || '').trim();
  return getCategory(key)?.displayName || key;
}

export function categorySource() {
  return source;
}
