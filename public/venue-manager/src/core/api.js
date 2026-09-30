/**
 * Backend API istemcisi — JWT ile kimlik doğrulamalı venue manager istekleri.
 */

const API_BASE = window.location.origin;

export function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    sessionStorage.setItem('inmapper-kiosk-token', fromUrl);
    return fromUrl;
  }
  return sessionStorage.getItem('inmapper-kiosk-token') || localStorage.getItem('inmapper-kiosk-token') || '';
}

function getVenueId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('venue') || params.get('venueId') || sessionStorage.getItem('vm-venue-id') || '';
}

export function bootstrapRuntime() {
  const venueId = getVenueId();
  const token = getToken();
  if (venueId) sessionStorage.setItem('vm-venue-id', venueId);
  return { venueId, token };
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) throw new Error('Oturum süresi doldu. Admin panelinden tekrar açın.');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function fetchVenuesList() {
  return apiFetch('/api/venues');
}

export async function fetchCurrentUser() {
  const data = await apiFetch('/api/auth/me');
  return data.user || {};
}

export async function fetchVenueConfig(venueId) {
  const venues = await apiFetch('/api/venues');
  const venue = venues.find(v => String(v._id) === String(venueId) || v.slug === venueId);
  if (!venue) throw new Error('Venue bulunamadı veya erişim yok.');
  return venue;
}

export async function fetchUnits(venueId) {
  return apiFetch(`/api/venues/${encodeURIComponent(venueId)}/units`);
}

export async function fetchCategories(venueId) {
  return apiFetch(`/api/venues/${encodeURIComponent(venueId)}/categories`);
}

export async function saveUnit(venueId, unitId, body) {
  return apiFetch(`/api/venues/${encodeURIComponent(venueId)}/units/${encodeURIComponent(unitId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchGeojson(venueId) {
  return apiFetch(`/api/venues/${encodeURIComponent(venueId)}/geojson`);
}

export function canWriteViaApi() {
  return true;
}
