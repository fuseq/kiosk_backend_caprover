
/**
 * ============================================
 * Inmapper Kiosk Backend - Admin Panel Script
 * Professional Dashboard Application
 * ============================================
 */

// ============================================
// Configuration
// ============================================
const API_BASE_URL = window.location.origin;

// Helper to get ID from MongoDB response (handles both id and _id)
const getId = (obj) => {
  if (obj == null) return null;
  if (typeof obj !== 'object') return String(obj);
  const raw = obj.id ?? obj._id ?? null;
  return raw == null ? null : String(raw);
};

// ============================================
// Auth helpers
// ============================================
const TOKEN_KEY = 'inmapper-kiosk-token';

const PERMS = {
  UNIT_ADS: 'unit_ads',
  LANDING: 'landing_campaigns',
  VENUE_MANAGER: 'venue_manager',
  DEVICES: 'devices',
};

const ACTIVE_VENUE_KEY = 'inmapper-active-venue';

function getActiveVenueId() {
  const raw = state.activeVenueId || localStorage.getItem(ACTIVE_VENUE_KEY) || null;
  return raw ? String(raw) : null;
}

function getActiveVenue() {
  const id = getActiveVenueId();
  return state.venues?.find(v => getId(v) === id) || null;
}

function venueQuery(extra = {}) {
  const params = new URLSearchParams(extra);
  const id = getActiveVenueId();
  if (id) params.set('venueId', id);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const FEATURE_LABELS_UI = {
  unit_ads: 'Birim reklamları',
  landing_campaigns: 'Kiosk kampanyaları',
  venue_manager: 'Birim yönetimi',
  devices: 'Cihazlar',
};

const ALL_TENANT_PERMS = [
  PERMS.UNIT_ADS,
  PERMS.LANDING,
  PERMS.VENUE_MANAGER,
  PERMS.DEVICES,
];

function getActiveTenantId() {
  const venue = getActiveVenue();
  return venue?.tenantId ? String(venue.tenantId) : null;
}

function getMembershipForTenant(tenantId) {
  const tid = tenantId ? String(tenantId) : null;
  if (!tid || !state.user?.memberships) return null;
  return state.user.memberships.find(m => String(m.tenantId) === tid) || null;
}

function getActivePermissions() {
  if (state.user?.role === 'admin') return ALL_TENANT_PERMS;
  const tid = getActiveTenantId();
  if (tid) {
    const membership = getMembershipForTenant(tid);
    return membership?.permissions || [];
  }
  // Mekan atanmamışsa herhangi bir üyelikteki izinlerin birleşimi
  const all = new Set();
  for (const m of state.user?.memberships || []) {
    for (const p of m.permissions || []) all.add(p);
  }
  return [...all];
}

function hasPermission(perm, tenantId) {
  if (state.user?.role === 'admin') return true;
  if (tenantId) {
    const membership = getMembershipForTenant(tenantId);
    return (membership?.permissions || []).includes(perm);
  }
  return getActivePermissions().includes(perm);
}

let tenantUserMembershipDraft = [];
let tenantUsersIndex = [];

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

/** fetch + Authorization header; 401'de login ekranına düşer. */
async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    showLogin();
    throw new Error('Oturum gerekli');
  }
  return res;
}

// ============================================
// State Management
// ============================================
const state = {
  devices: [],
  landingPages: [],
  deviceGroups: [],
  deviceView: 'venue',
  pendingDevices: [],
  currentLandingPage: null,
  currentGroup: null,
  currentPage: 'dashboard',
  user: null,
  venues: [],
  activeVenueId: null,
  venueUnits: [],
  selectedVenueId: null,
  selectedUnitId: null,
  unitAdFilter: 'all',
  tenants: [],
  unassignedVenues: [],
  stats: {
    totalDevices: 0,
    activeDevices: 0,
    totalLandingPages: 0,
    totalSlides: 0
  }
};

// ============================================
// DOM Elements Cache
// ============================================
const elements = {
  // Sidebar
  sidebar: document.getElementById('sidebar'),
  mobileMenuBtn: document.getElementById('mobileMenuBtn'),
  navItems: document.querySelectorAll('.nav-item'),
  
  // Header
  pageTitle: document.getElementById('pageTitle'),
  pageBreadcrumb: document.getElementById('pageBreadcrumb'),
  primaryAction: document.getElementById('primaryAction'),
  themeToggle: document.getElementById('themeToggle'),
  
  // Pages
  pages: {
    dashboard: document.getElementById('dashboardPage'),
    'landing-pages': document.getElementById('landingPagesPage'),
    devices: document.getElementById('devicesPage'),
    groups: document.getElementById('groupsPage'),
    'unit-ads': document.getElementById('unitAdsPage'),
    'venue-manager': document.getElementById('venueManagerPage'),
    venues: document.getElementById('venuesPage'),
    tenants: document.getElementById('tenantsPage'),
    settings: document.getElementById('settingsPage')
  },
  
  // Stats
  statTotalDevices: document.getElementById('statTotalDevices'),
  statActiveDevices: document.getElementById('statActiveDevices'),
  statLandingPages: document.getElementById('statLandingPages'),
  statPendingDevices: document.getElementById('statPendingDevices'),
  statUnitAds: document.getElementById('statUnitAds'),
  statVenues: document.getElementById('statVenues'),
  statTenants: document.getElementById('statTenants'),
  activityList: document.getElementById('activityList'),
  dashModuleList: document.getElementById('dashModuleList'),
  
  // Landing Pages
  landingPagesList: document.getElementById('landingPagesList'),
  landingPagesEmpty: document.getElementById('landingPagesEmpty'),
  newLandingPageBtn: document.getElementById('newLandingPageBtn'),
  landingPageSearch: document.getElementById('landingPageSearch'),
  
  // Devices
  devicesTableBody: document.getElementById('devicesTableBody'),
  devicesEmpty: document.getElementById('devicesEmpty'),
  deviceSearch: document.getElementById('deviceSearch'),
  filterBtns: document.querySelectorAll('.filter-btn[data-filter]'),
  
  // Landing Page Modal
  landingPageModal: document.getElementById('landingPageModal'),
  landingPageForm: document.getElementById('landingPageForm'),
  modalTitle: document.getElementById('modalTitle'),
  landingPageId: document.getElementById('landingPageId'),
  landingPageName: document.getElementById('landingPageName'),
  transitionDuration: document.getElementById('transitionDuration'),
  durationDisplay: document.getElementById('durationDisplay'),
  syncEnabled: document.getElementById('syncEnabled'),
  campaignStart: document.getElementById('campaignStart'),
  campaignEnd: document.getElementById('campaignEnd'),
  showNavbar: document.getElementById('showNavbar'),
  showSidePanel: document.getElementById('showSidePanel'),
  letterboxColor: document.getElementById('letterboxColor'),
  slidesList: document.getElementById('slidesList'),
  slideCount: document.getElementById('slideCount'),
  mediaDropzone: document.getElementById('mediaDropzone'),
  mediaFileInput: document.getElementById('mediaFileInput'),
  mediaUrlInput: document.getElementById('mediaUrlInput'),
  mediaUrlAddBtn: document.getElementById('mediaUrlAddBtn'),
  timingSlidesList: document.getElementById('timingSlidesList'),
  campaignWizardSteps: document.getElementById('campaignWizardSteps'),
  campaignWizardSummary: document.getElementById('campaignWizardSummary'),
  wizardPrevBtn: document.getElementById('wizardPrevBtn'),
  wizardNextBtn: document.getElementById('wizardNextBtn'),
  wizardSaveBtn: document.getElementById('wizardSaveBtn'),
  campaignGroupCheckboxes: document.getElementById('campaignGroupCheckboxes'),
  targetGroupCount: document.getElementById('targetGroupCount'),
  assignedDevicesList: document.getElementById('assignedDevicesList'),
  deviceCount: document.getElementById('deviceCount'),
  assignDevicesBtn: document.getElementById('assignDevicesBtn'),
  closeModal: document.getElementById('closeModal'),
  cancelBtn: document.getElementById('cancelBtn'),
  
  // Device Assign Modal
  deviceAssignModal: document.getElementById('deviceAssignModal'),
  deviceCheckboxes: document.getElementById('deviceCheckboxes'),
  closeDeviceAssignModal: document.getElementById('closeDeviceAssignModal'),
  cancelDeviceAssignBtn: document.getElementById('cancelDeviceAssignBtn'),
  saveDeviceAssignBtn: document.getElementById('saveDeviceAssignBtn'),
  
  // Device Name Edit Modal
  deviceNameModal: document.getElementById('deviceNameModal'),
  deviceNameForm: document.getElementById('deviceNameForm'),
  editDeviceId: document.getElementById('editDeviceId'),
  editDeviceName: document.getElementById('editDeviceName'),
  editDeviceAspect: document.getElementById('editDeviceAspect'),
  editDeviceAspectHint: document.getElementById('editDeviceAspectHint'),
  editDeviceContentAlign: document.getElementById('editDeviceContentAlign'),
  editDeviceShellMode: document.getElementById('editDeviceShellMode'),
  closeDeviceNameModal: document.getElementById('closeDeviceNameModal'),
  cancelDeviceNameBtn: document.getElementById('cancelDeviceNameBtn'),

  // Device Venue Assignment Modal
  deviceVenueModal: document.getElementById('deviceVenueModal'),
  deviceVenueForm: document.getElementById('deviceVenueForm'),
  venueAssignDeviceId: document.getElementById('venueAssignDeviceId'),
  venueAssignDeviceName: document.getElementById('venueAssignDeviceName'),
  venueAssignDisplayId: document.getElementById('venueAssignDisplayId'),
  venueAssignSelect: document.getElementById('venueAssignSelect'),
  closeDeviceVenueModal: document.getElementById('closeDeviceVenueModal'),
  cancelDeviceVenueBtn: document.getElementById('cancelDeviceVenueBtn'),
  
  // Groups
  groupsList: document.getElementById('groupsList'),
  groupsEmpty: document.getElementById('groupsEmpty'),
  newGroupBtn: document.getElementById('newGroupBtn'),
  groupSearch: document.getElementById('groupSearch'),
  groupModal: document.getElementById('groupModal'),
  groupForm: document.getElementById('groupForm'),
  groupModalTitle: document.getElementById('groupModalTitle'),
  groupId: document.getElementById('groupId'),
  groupName: document.getElementById('groupName'),
  groupDescription: document.getElementById('groupDescription'),
  groupContentAlign: document.getElementById('groupContentAlign'),
  groupShellMode: document.getElementById('groupShellMode'),
  groupDeviceCheckboxes: document.getElementById('groupDeviceCheckboxes'),
  groupDeviceCount: document.getElementById('groupDeviceCount'),
  closeGroupModal: document.getElementById('closeGroupModal'),
  cancelGroupBtn: document.getElementById('cancelGroupBtn'),
  
  // Settings
  apiEndpoint: document.getElementById('apiEndpoint'),
  
  // Toast
  toastContainer: document.getElementById('toastContainer')
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

async function initializeApp() {
  initTheme();
  setupEventListeners();
  initUnitAdsPage();
  initVenueManagerPage();
  initTenantsPage();
  initLogin();

  const ok = await checkSession();
  if (!ok) { showLogin(); return; }

  applyRoleUI({ navigateIfNeeded: false });
  await initGlobalVenuePicker();
  applyRoleUI({ navigateIfNeeded: true });
  await refreshAllData();
  updateApiEndpoint();
  
  // Start auto-refresh every 30 seconds
  setInterval(() => { if (state.user) refreshAllData(); }, 30000);
}

// ============================================
// Login / session
// ============================================
async function checkSession() {
  if (!getToken()) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!res.ok) return false;
    const data = await res.json();
    state.user = data.user;
    return true;
  } catch { return false; }
}

function showLogin() {
  state.user = null;
  document.getElementById('headerUser')?.classList.remove('open');
  document.getElementById('loginOverlay').style.display = 'flex';
}

function hideLogin() {
  document.getElementById('loginOverlay').style.display = 'none';
}

function applyRoleUI({ navigateIfNeeded = true } = {}) {
  const isAdmin = state.user?.role === 'admin';

  document.querySelectorAll('.nav-item').forEach(item => {
    const page = item.dataset.page;
    if (item.classList.contains('admin-only')) {
      item.style.display = isAdmin ? '' : 'none';
      return;
    }
    if (isAdmin) {
      item.style.display = '';
      return;
    }
    const permAttr = item.dataset.perm || '';
    const required = permAttr.split(',').map(s => s.trim()).filter(Boolean);
    const visible = !required.length || required.some(p => hasPermission(p));
    item.style.display = visible ? '' : 'none';
  });

  document.querySelectorAll('#dashboardPage .admin-only').forEach((el) => {
    el.hidden = !isAdmin;
  });
  renderDashboardModules();

  const displayName = state.user?.name || state.user?.email || 'Kullanıcı';
  const email = state.user?.email || '';
  const activeMembership = getMembershipForTenant(getActiveTenantId());
  const roleLabel = isAdmin
    ? 'Yönetici'
    : (activeMembership?.tenantName || state.user?.tenantName || 'Müşteri');
  const initial = (displayName.trim()[0] || '?').toUpperCase();
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('userAvatar', initial);
  set('userName', displayName);
  set('userRole', roleLabel);
  set('userMenuName', displayName);
  set('userMenuEmail', email);

  document.querySelectorAll('[data-device-view]').forEach(btn => {
    btn.style.display = isAdmin ? '' : 'none';
  });
  if (!isAdmin) state.deviceView = 'venue';

  if (!navigateIfNeeded || isAdmin) return;

  const currentNav = document.querySelector(`.nav-item[data-page="${state.currentPage}"]`);
  const currentVisible = currentNav && currentNav.style.display !== 'none';
  if (currentVisible && state.currentPage !== 'dashboard') return;

  const firstPage = ['unit-ads', 'venue-manager', 'landing-pages', 'devices', 'groups', 'settings']
    .find(p => {
      const item = document.querySelector(`.nav-item[data-page="${p}"]`);
      return item && item.style.display !== 'none';
    }) || 'settings';
  if (state.currentPage !== firstPage) navigateTo(firstPage);
}

function initLogin() {
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('loginEmail').value,
          password: document.getElementById('loginPassword').value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Giriş başarısız');
      setToken(data.token);
      state.user = data.user;
      hideLogin();
      applyRoleUI({ navigateIfNeeded: false });
      await initGlobalVenuePicker();
      applyRoleUI({ navigateIfNeeded: true });
      await refreshAllData();
      updateApiEndpoint();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    setToken(null);
    location.reload();
  });

  // Header kullanıcı dropdown'ı
  const userWrap = document.getElementById('headerUser');
  const userBtn = document.getElementById('headerUserBtn');
  userBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    userWrap?.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (userWrap?.classList.contains('open') && !userWrap.contains(e.target)) {
      userWrap.classList.remove('open');
    }
  });
}

// ============================================
// Theme Management
// ============================================
function initTheme() {
  const savedTheme = localStorage.getItem('inmapper-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
  const html = document.documentElement;
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('inmapper-theme', newTheme);
  notifyVenueManagerTheme(newTheme);
}

function notifyVenueManagerTheme(theme) {
  const frame = document.getElementById('venueManagerFrame');
  if (!frame?.contentWindow) return;
  try {
    frame.contentWindow.postMessage(
      { type: 'inmapper-theme', theme },
      window.location.origin
    );
  } catch (err) {
    console.warn('Venue Manager tema bildirimi gönderilemedi', err);
  }
}

function setupEventListeners() {
  // Mobile Sidebar
  elements.mobileMenuBtn?.addEventListener('click', toggleMobileSidebar);
  
  // Theme Toggle
  elements.themeToggle?.addEventListener('click', toggleTheme);

  document.getElementById('dashRefreshBtn')?.addEventListener('click', () => refreshAllData());
  document.getElementById('dashActivityRefresh')?.addEventListener('click', () => loadStats());
  
  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
    });
  });
  
  // Landing Page Modal
  elements.newLandingPageBtn?.addEventListener('click', () => openLandingPageModal());
  elements.closeModal?.addEventListener('click', closeLandingPageModal);
  elements.cancelBtn?.addEventListener('click', closeLandingPageModal);
  elements.landingPageForm?.addEventListener('submit', handleLandingPageSubmit);
  elements.assignDevicesBtn?.addEventListener('click', openDeviceAssignModal);
  elements.wizardPrevBtn?.addEventListener('click', () => campaignWizard.goToStep(campaignWizard.step - 1));
  elements.wizardNextBtn?.addEventListener('click', () => {
    if (campaignWizard.validateStep(campaignWizard.step)) {
      campaignWizard.goToStep(campaignWizard.step + 1);
    }
  });
  elements.campaignWizardSteps?.querySelectorAll('.wizard-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.step);
      if (n < campaignWizard.step || campaignWizard.validateStep(campaignWizard.step)) {
        campaignWizard.goToStep(n);
      }
    });
  });
  elements.mediaDropzone?.addEventListener('click', () => elements.mediaFileInput?.click());
  elements.mediaDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.mediaDropzone.classList.add('is-dragover');
  });
  elements.mediaDropzone?.addEventListener('dragleave', () => {
    elements.mediaDropzone.classList.remove('is-dragover');
  });
  elements.mediaDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.mediaDropzone.classList.remove('is-dragover');
    handleMediaDrop(e.dataTransfer?.files);
  });
  elements.mediaFileInput?.addEventListener('change', () => {
    handleMediaDrop(elements.mediaFileInput.files);
    elements.mediaFileInput.value = '';
  });
  elements.mediaUrlAddBtn?.addEventListener('click', handleMediaUrlAdd);
  elements.mediaUrlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleMediaUrlAdd();
    }
  });

  elements.showNavbar?.addEventListener('change', updateChromeToggleStyles);
  elements.showSidePanel?.addEventListener('change', updateChromeToggleStyles);
  
  // Duration slider
  elements.transitionDuration?.addEventListener('input', updateDurationDisplay);
  elements.syncEnabled?.addEventListener('change', updateChromeToggleStyles);
  
  // Device Assign Modal
  elements.closeDeviceAssignModal?.addEventListener('click', closeDeviceAssignModal);
  elements.cancelDeviceAssignBtn?.addEventListener('click', closeDeviceAssignModal);
  elements.saveDeviceAssignBtn?.addEventListener('click', saveDeviceAssignment);
  
  // Device Name Edit Modal
  elements.closeDeviceNameModal?.addEventListener('click', closeDeviceNameModal);
  elements.cancelDeviceNameBtn?.addEventListener('click', closeDeviceNameModal);
  elements.deviceNameForm?.addEventListener('submit', handleDeviceNameSubmit);

  elements.closeDeviceVenueModal?.addEventListener('click', closeDeviceVenueModal);
  elements.cancelDeviceVenueBtn?.addEventListener('click', closeDeviceVenueModal);
  elements.deviceVenueForm?.addEventListener('submit', handleDeviceVenueSubmit);
  
  // Group Modal
  elements.newGroupBtn?.addEventListener('click', () => openGroupModal());
  elements.closeGroupModal?.addEventListener('click', closeGroupModal);
  elements.cancelGroupBtn?.addEventListener('click', closeGroupModal);
  elements.groupForm?.addEventListener('submit', handleGroupSubmit);
  
  // Modal overlay click to close
  elements.landingPageModal?.addEventListener('click', (e) => {
    if (e.target === elements.landingPageModal) closeLandingPageModal();
  });
  elements.deviceAssignModal?.addEventListener('click', (e) => {
    if (e.target === elements.deviceAssignModal) closeDeviceAssignModal();
  });
  elements.deviceNameModal?.addEventListener('click', (e) => {
    if (e.target === elements.deviceNameModal) closeDeviceNameModal();
  });
  elements.deviceVenueModal?.addEventListener('click', (e) => {
    if (e.target === elements.deviceVenueModal) closeDeviceVenueModal();
  });
  elements.groupModal?.addEventListener('click', (e) => {
    if (e.target === elements.groupModal) closeGroupModal();
  });
  
  // Search
  elements.landingPageSearch?.addEventListener('input', handleLandingPageSearch);
  elements.deviceSearch?.addEventListener('input', handleDeviceSearch);
  elements.groupSearch?.addEventListener('input', (e) => renderDeviceGroups(e.target.value));
  
  // Device filters
  elements.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterDevices(btn.dataset.filter);
    });
  });

  document.querySelectorAll('[data-device-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-device-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setDeviceView(btn.dataset.deviceView);
    });
  });
  
  // Close mobile sidebar on click outside
  document.addEventListener('click', (e) => {
    if (elements.sidebar?.classList.contains('mobile-open') &&
        !elements.sidebar.contains(e.target) &&
        !elements.mobileMenuBtn?.contains(e.target)) {
      elements.sidebar.classList.remove('mobile-open');
    }
  });
}

// ============================================
// Navigation
// ============================================
function navigateTo(page) {
  state.currentPage = page;
  
  // Update nav items
  elements.navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  
  // Update pages
  Object.keys(elements.pages).forEach(key => {
    elements.pages[key]?.classList.toggle('active', key === page);
  });
  
  // Update header
  const titles = {
    dashboard: { title: 'Dashboard', breadcrumb: 'Ana Sayfa / Dashboard' },
    'landing-pages': { title: 'Kampanyalar', breadcrumb: 'Ana Sayfa / Kampanyalar' },
    devices: { title: 'Cihazlar', breadcrumb: 'Ana Sayfa / Cihazlar' },
    groups: { title: 'Gruplar', breadcrumb: 'Ana Sayfa / Gruplar' },
    'unit-ads': { title: 'Birim Reklamları', breadcrumb: 'Ana Sayfa / Birim Reklamları' },
    'venue-manager': { title: 'Birim Yönetimi', breadcrumb: 'Ana Sayfa / Birim Yönetimi' },
    venues: { title: 'Mekanlar', breadcrumb: 'Ana Sayfa / Mekanlar' },
    tenants: { title: 'Müşteriler', breadcrumb: 'Ana Sayfa / Müşteriler' },
    settings: { title: 'Ayarlar', breadcrumb: 'Ana Sayfa / Ayarlar' }
  };
  
  const pageInfo = titles[page] || titles.dashboard;
  if (elements.pageTitle) elements.pageTitle.textContent = pageInfo.title;
  if (elements.pageBreadcrumb) elements.pageBreadcrumb.textContent = pageInfo.breadcrumb;
  
  // Close mobile sidebar
  elements.sidebar?.classList.remove('mobile-open');

  if (page === 'unit-ads') loadUnitAdsPage();
  if (page === 'venue-manager') loadVenueManagerPage();
  if (page === 'venues') loadVenuesPage();
  if (page === 'tenants') loadTenantsPage();
  updatePageBreadcrumbVenue();
}

function toggleMobileSidebar() {
  elements.sidebar?.classList.toggle('mobile-open');
}

// ============================================
// Data Fetching
// ============================================
async function refreshAllData() {
  try {
    // Venue picker önce düzeltilmeli; aksi halde eski/geçersiz venueId ile
    // /api/stats boş (hepsi 0) döner ve silent picker güncellemesi stats'ı yenilemez.
    await loadVenuesList().then(() => refreshVenuePickerUI({ silent: true })).catch((err) => {
      console.error('Venue list failed:', err);
    });

    const tasks = [loadStats()];
    if (state.user?.role === 'admin' || hasPermission(PERMS.LANDING) || hasPermission(PERMS.DEVICES)) {
      if (hasPermission(PERMS.LANDING) || state.user?.role === 'admin') tasks.push(loadLandingPages());
      if (hasPermission(PERMS.DEVICES) || state.user?.role === 'admin') tasks.push(loadDevices(), loadDeviceGroups());
    }
    await Promise.all(tasks);
  } catch (error) {
    console.error('Error refreshing data:', error);
    showToast('Veri yüklenirken hata oluştu', 'error');
  }
}

async function loadVenuesList() {
  const res = await authFetch(`${API_BASE_URL}/api/venues`);
  if (!res.ok) throw new Error('Venue list failed');
  state.venues = await res.json();
  return state.venues;
}

async function loadStats() {
  try {
    const response = await authFetch(`${API_BASE_URL}/api/stats${venueQuery()}`);
    if (!response.ok) throw new Error('Failed to load stats');

    const stats = await response.json();
    state.stats = stats;

    setStatValue(elements.statTotalDevices, stats.totalDevices);
    setStatValue(elements.statActiveDevices, stats.activeDevices);
    setStatValue(elements.statLandingPages, stats.totalLandingPages);
    setStatValue(elements.statPendingDevices, stats.pendingDevices);
    setStatValue(elements.statUnitAds, stats.unitAds ?? stats.activeUnitAds);
    setStatValue(elements.statVenues, stats.totalVenues);
    setStatValue(elements.statTenants, stats.totalTenants);

    renderActivityList(stats.activity || []);
    renderDashboardModules();
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function setStatValue(element, value) {
  if (!element) return;
  const next = Number(value);
  animateValue(element, Number.isFinite(next) ? next : 0);
}

function formatRelativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const delta = Math.max(0, Date.now() - then);
  const mins = Math.floor(delta / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gün önce`;
  return new Date(then).toLocaleDateString('tr-TR');
}

function renderActivityList(items) {
  const host = elements.activityList;
  if (!host) return;
  if (!items.length) {
    host.innerHTML = `
      <div class="activity-empty">
        <i class="ph ph-moon-stars"></i>
        <span>Henüz aktivite yok</span>
        <small>Paneldeki kayıt, güncelleme ve silme işlemleri burada görünür.</small>
      </div>`;
    return;
  }
  host.innerHTML = items.map(item => {
    const when = formatRelativeTime(item.at);
    const who = item.actorEmail ? ` · ${item.actorEmail}` : '';
    return `
    <div class="activity-item">
      <div class="activity-icon ${escapeHtml(item.tone || 'blue')}">
        <i class="ph ph-${escapeHtml(item.icon || 'pulse')}"></i>
      </div>
      <div class="activity-content">
        <span class="activity-text">${escapeHtml(item.text || '')}</span>
        <span class="activity-time">${escapeHtml(when)}${escapeHtml(who)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderDashboardModules() {
  const host = elements.dashModuleList;
  if (!host) return;
  const isAdmin = state.user?.role === 'admin';
  host.querySelectorAll('[data-perm]').forEach((el) => {
    const required = String(el.dataset.perm || '').split(',').map(s => s.trim()).filter(Boolean);
    const visible = isAdmin || !required.length || required.some(p => hasPermission(p));
    el.hidden = !visible;
  });
  host.querySelectorAll('.admin-only').forEach((el) => {
    el.hidden = !isAdmin;
  });
}

async function loadDevices() {
  try {
    if (state.deviceView === 'pending' && state.user?.role === 'admin') {
      const response = await authFetch(`${API_BASE_URL}/api/devices?pending=1`);
      if (!response.ok) throw new Error('Failed to load pending devices');
      const data = await response.json();
      state.pendingDevices = data.devices || [];
      state.devices = state.pendingDevices;
      renderDevicesTable();
      return;
    }

    const response = await authFetch(`${API_BASE_URL}/api/devices${venueQuery()}`);
    if (!response.ok) throw new Error('Failed to load devices');

    const data = await response.json();
    state.devices = data.devices || [];
    renderDevicesTable();
  } catch (error) {
    console.error('Error loading devices:', error);
  }
}

async function loadLandingPages() {
  try {
    const response = await authFetch(`${API_BASE_URL}/api/landing-pages${venueQuery()}`);
    if (!response.ok) throw new Error('Failed to load landing pages');
    
    const data = await response.json();
    state.landingPages = data.landingPages || [];
    renderLandingPages();
  } catch (error) {
    console.error('Error loading landing pages:', error);
  }
}

async function loadDeviceGroups() {
  try {
    const response = await authFetch(`${API_BASE_URL}/api/device-groups${venueQuery()}`);
    if (!response.ok) throw new Error('Failed to load device groups');
    
    const data = await response.json();
    state.deviceGroups = data.groups || [];
    renderDeviceGroups();
    // Cihaz tablosundaki "Grup" sütunu grup verisine bağlı olduğundan tazele
    if (state.devices?.length) renderDevicesTable();
  } catch (error) {
    console.error('Error loading device groups:', error);
  }
}

// ============================================
// Rendering Functions
// ============================================
function renderLandingPages(filter = '') {
  const filtered = filter
    ? state.landingPages.filter(lp => 
        lp.name.toLowerCase().includes(filter.toLowerCase()))
    : state.landingPages;
  
  if (filtered.length === 0) {
    if (elements.landingPagesList) elements.landingPagesList.innerHTML = '';
    if (elements.landingPagesEmpty) {
      elements.landingPagesEmpty.style.display = 'flex';
    }
    return;
  }
  
  if (elements.landingPagesEmpty) {
    elements.landingPagesEmpty.style.display = 'none';
  }
  
  if (elements.landingPagesList) {
    elements.landingPagesList.innerHTML = filtered.map(lp => {
      const lpId = getId(lp);
      return `
      <div class="landing-page-card" data-id="${lpId}">
        <div class="lp-card-header">
          <h3 class="lp-card-title">${escapeHtml(lp.name)}</h3>
          <div class="lp-card-meta">
            <span><i class="ph ph-images"></i> ${lp.slideCount || lp.slides?.length || 0} medya</span>
            <span><i class="ph ph-devices"></i> ${lp.deviceCount || lp.devices?.length || 0} cihaz</span>
          </div>
        </div>
        <div class="lp-card-body">
          ${renderSlidesPreview(lp.slides)}
          <div class="lp-info-grid">
            <div class="lp-info-item">
              <span class="lp-info-label">Geçiş Süresi</span>
              <span class="lp-info-value">${(lp.transitionDuration / 1000).toFixed(0)} saniye</span>
            </div>
            ${lp.sync?.enabled ? `
            <div class="lp-info-item">
              <span class="lp-info-label">Senkron</span>
              <span class="lp-info-value">Açık</span>
            </div>` : ''}
            <div class="lp-info-item">
              <span class="lp-info-label">Son Güncelleme</span>
              <span class="lp-info-value">${formatDate(lp.updatedAt)}</span>
            </div>
          </div>
        </div>
        <div class="lp-card-footer">
          <button class="btn btn-primary btn-sm" onclick="editLandingPage('${lpId}')">
            <i class="ph ph-pencil-simple"></i>
            <span>Düzenle</span>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="deleteLandingPage('${lpId}')">
            <i class="ph ph-trash"></i>
            <span>Sil</span>
          </button>
        </div>
      </div>
    `;}).join('');
  }
}

function renderSlidesPreview(slides) {
  if (!slides || slides.length === 0) {
    return '<div class="lp-slides-preview"><span class="text-muted">Medya yok</span></div>';
  }
  
  const visibleSlides = slides.slice(0, 4);
  const remaining = slides.length - 4;
  
  return `
    <div class="lp-slides-preview">
      ${visibleSlides.map(slide => {
        const isVideo = slide.mediaType === 'video' || /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(slide.imageUrl || '');
        if (isVideo) {
          return `<div class="lp-slide-thumb lp-slide-thumb--video" title="Video"><i class="ph ph-video-camera"></i></div>`;
        }
        return `<img src="${escapeHtml(slide.imageUrl)}" 
             alt="Slide" 
             class="lp-slide-thumb"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22><rect fill=%22%231a1a24%22 width=%2264%22 height=%2264%22/><text x=%2232%22 y=%2236%22 text-anchor=%22middle%22 fill=%22%2364748b%22 font-size=%2212%22>?</text></svg>'">`;
      }).join('')}
      ${remaining > 0 ? `<div class="lp-slide-more">+${remaining}</div>` : ''}
    </div>
  `;
}

function isActiveVenueDevice(device) {
  return device?.enrollmentStatus === 'active' && Boolean(device?.venueId);
}

function findCampaignForDevice(deviceId) {
  const wanted = String(deviceId);
  const deviceGroupIds = (state.deviceGroups || [])
    .filter((g) => (g.deviceIds || []).some((id) => String(getId(id)) === wanted))
    .map((g) => String(getId(g)));

  return (state.landingPages || []).find((lp) => {
    const direct = (lp.deviceIds || lp.devices?.map((d) => getId(d)) || [])
      .some((id) => String(getId(id)) === wanted);
    if (direct) return true;
    const campaignGroups = (lp.groupIds || []).map((id) => String(getId(id)));
    return campaignGroups.some((gid) => deviceGroupIds.includes(gid));
  }) || null;
}

function renderDevicesTable(filter = 'all', search = '') {
  let filtered = state.devices;
  const pendingView = state.deviceView === 'pending';

  if (!pendingView && filter !== 'all') {
    filtered = filtered.filter(d => d.status === filter);
  }

  if (search) {
    const term = search.toLowerCase();
    filtered = filtered.filter(d => {
      const deviceId = getId(d);
      return d.name?.toLowerCase().includes(term) ||
        deviceId?.toLowerCase().includes(term) ||
        d.displayId?.toLowerCase().includes(term) ||
        d.fingerprint?.toLowerCase().includes(term);
    });
  }

  if (filtered.length === 0) {
    if (elements.devicesTableBody) {
      elements.devicesTableBody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 3rem;">
            <div class="empty-state">
              <div class="empty-state-icon">
                <i class="ph ph-devices"></i>
              </div>
              <h3>Cihaz Bulunamadı</h3>
              <p>${pendingView
                ? 'Bekleyen cihaz yok'
                : (search ? 'Arama kriterlerine uygun cihaz yok' : 'Henüz kayıtlı cihaz bulunmuyor')}</p>
            </div>
          </td>
        </tr>
      `;
    }
    return;
  }

  if (elements.devicesTableBody) {
    elements.devicesTableBody.innerHTML = filtered.map(device => {
      const deviceId = getId(device);
      const assignedLP = pendingView ? null : findCampaignForDevice(deviceId);
      const isRevoked = device.enrollmentStatus === 'revoked';
      const isPending = device.enrollmentStatus === 'pending';
      const venue = state.venues.find(v => getId(v) === String(device.venueId || ''));
      const venueLabel = isPending ? 'Mekan ata' : (venue?.name || 'Mekan seç');
      const statusBadge = isRevoked
        ? '<span class="status-badge offline">İptal edildi</span>'
        : (isPending
          ? '<span class="status-badge pending">Bekliyor</span>'
          : `<span class="status-badge ${device.status}">${getStatusText(device.status)}</span>`);

      return `
        <tr>
          <td>${statusBadge}</td>
          <td>
            <div class="device-name-cell">
              <span class="device-name-text">${escapeHtml(device.name || device.displayId || 'İsimsiz Cihaz')}</span>
              ${isPending ? '<span class="ua-badge wait" style="margin-left:6px;font-size:0.7rem">Mekana atanmadı</span>' : ''}
              ${isRevoked ? '<span class="ua-badge" style="margin-left:6px;font-size:0.7rem">Erişim kapalı</span>' : ''}
              <button class="device-name-edit-btn" onclick="openDeviceNameModal('${deviceId}')" title="Düzenle" ${isRevoked ? 'disabled' : ''}>
                <i class="ph ph-pencil-simple"></i>
              </button>
            </div>
          </td>
          <td>
            <span class="device-id">${escapeHtml(device.displayId || (deviceId?.substring(0, 8) || '-'))}</span>
          </td>
          <td>${device.deviceInfo?.screenResolution || '-'}</td>
          <td>${device.aspectRatio ? `<span class="aspect-badge">${escapeHtml(device.aspectRatio)}</span>` : '-'}</td>
          <td>${pendingView ? '-' : deviceGroupsHtml(deviceId)}</td>
          <td>${formatDate(device.lastSeen)}</td>
          <td>
            ${pendingView
              ? '<span class="text-muted">Atama bekleniyor</span>'
              : (assignedLP
                ? `<span class="text-primary">${escapeHtml(assignedLP.name)}</span>`
                : '<span class="text-muted">Atanmamış</span>')}
          </td>
          <td>
            <div class="device-actions">
              ${state.user?.role === 'admin' && !isRevoked ? `
                <button class="device-venue-chip ${isPending ? 'is-pending' : 'is-assigned'}"
                        onclick="openDeviceVenueModal('${deviceId}')"
                        title="${isPending ? 'Cihazı mekana ata' : 'Atanan mekanı değiştir'}">
                  <i class="ph ph-buildings"></i>
                  <span>${escapeHtml(venueLabel)}</span>
                </button>
              ` : (!isPending && venue ? `
                <span class="device-venue-chip is-assigned is-static">
                  <i class="ph ph-buildings"></i>
                  <span>${escapeHtml(venue.name)}</span>
                </span>
              ` : '')}
              ${state.user?.role === 'admin' && !isRevoked ? `
                <button class="btn btn-ghost btn-icon" onclick="revokeDevice('${deviceId}')" title="Erişimi iptal et">
                  <i class="ph ph-prohibit"></i>
                </button>
              ` : ''}
              ${state.user?.role === 'admin' && isRevoked ? `
                <button class="btn btn-ghost btn-icon" onclick="resetDevice('${deviceId}')" title="Yeniden eşleştir">
                  <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
              ` : ''}
              <button class="btn btn-ghost btn-icon" onclick="deleteDevice('${deviceId}')" title="Sil">
                <i class="ph ph-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }
}

// ============================================
// Modal Functions
// ============================================
const campaignWizard = {
  step: 1,
  maxStep: 6,
  brandNames: [],

  goToStep(n) {
    const step = Math.min(this.maxStep, Math.max(1, Number(n) || 1));
    this.step = step;
    document.querySelectorAll('#landingPageModal .wizard-panel').forEach((panel) => {
      const match = Number(panel.dataset.panel) === step;
      panel.hidden = !match;
      panel.classList.toggle('is-active', match);
    });
    elements.campaignWizardSteps?.querySelectorAll('.wizard-step').forEach((btn) => {
      const s = Number(btn.dataset.step);
      btn.classList.toggle('is-active', s === step);
      btn.classList.toggle('is-done', s < step);
    });
    if (elements.wizardPrevBtn) elements.wizardPrevBtn.hidden = step <= 1;
    if (elements.wizardNextBtn) {
      elements.wizardNextBtn.hidden = step >= this.maxStep;
      elements.wizardNextBtn.style.display = step >= this.maxStep ? 'none' : '';
    }
    if (elements.wizardSaveBtn) {
      elements.wizardSaveBtn.hidden = step < this.maxStep;
      elements.wizardSaveBtn.style.display = step < this.maxStep ? 'none' : '';
    }
    if (step === 3) renderTimingStep();
    if (step === 6) renderWizardSummary();
    updateChromeToggleStyles();
  },

  validateStep(step) {
    if (step === 1) {
      const name = elements.landingPageName?.value?.trim();
      if (!name) {
        showToast('Kampanya adı gerekli', 'error');
        return false;
      }
    }
    if (step === 2) {
      const count = elements.slidesList?.querySelectorAll('.slide-item').length || 0;
      if (!count) {
        showToast('En az bir medya ekleyin', 'error');
        return false;
      }
      const empty = Array.from(elements.slidesList.querySelectorAll('.slide-url-input'))
        .some((input) => !input.value.trim());
      if (empty) {
        showToast('Tüm medya kartlarında URL olmalı', 'error');
        return false;
      }
    }
    if (step === 5) {
      const syncOn = Boolean(elements.syncEnabled?.checked);
      if (syncOn) {
        const hasSlideTargets = Array.from(elements.slidesList?.querySelectorAll('.slide-item') || [])
          .some((el) => el.querySelectorAll('.slide-target-checkboxes input:checked').length > 0);
        if (hasSlideTargets) {
          showToast('Senkron açıkken slide bazlı hedef grup kullanılamaz', 'error');
          return false;
        }
      }
    }
    return true;
  },
};

function openLandingPageModal(landingPage = null) {
  if (!getActiveVenueId()) {
    showToast('Önce sidebar\'dan bir mekan seçin', 'warning');
    return;
  }
  state.currentLandingPage = landingPage;
  
  const titleSpan = elements.modalTitle?.querySelector('span');
  if (titleSpan) {
    titleSpan.textContent = landingPage ? 'Kampanyayı Düzenle' : 'Yeni Kampanya';
  }
  
  if (elements.landingPageId) elements.landingPageId.value = getId(landingPage) || '';
  if (elements.landingPageName) elements.landingPageName.value = landingPage?.name || '';
  if (elements.transitionDuration) {
    elements.transitionDuration.value = landingPage?.transitionDuration || 8000;
    updateDurationDisplay();
  }

  if (elements.syncEnabled) {
    elements.syncEnabled.checked = Boolean(landingPage?.sync?.enabled);
  }
  updateChromeToggleStyles();

  setLandingChrome(resolveChromeFromPage(landingPage));
  if (elements.letterboxColor) {
    elements.letterboxColor.value = landingPage?.letterboxColor === 'white' ? 'white' : 'black';
  }

  if (elements.campaignStart) elements.campaignStart.value = toLocalInput(landingPage?.schedule?.startDate);
  if (elements.campaignEnd) elements.campaignEnd.value = toLocalInput(landingPage?.schedule?.endDate);

  if (elements.mediaUrlInput) elements.mediaUrlInput.value = '';

  if (landingPage && !landingPage.deviceIds && landingPage.devices) {
    landingPage.deviceIds = landingPage.devices.map(d => getId(d));
  }
  
  if (elements.slidesList) {
    elements.slidesList.innerHTML = '';
    if (landingPage?.slides) {
      landingPage.slides.forEach(slide => addSlide(slide));
    }
  }
  updateSlideCount();

  renderCampaignGroupCheckboxes((landingPage?.groupIds || []).map(id => getId(id)));
  renderAssignedDevices();
  loadBrandSuggestions();

  campaignWizard.goToStep(1);
  elements.landingPageModal?.classList.add('show');
}

// datetime-local <-> ISO yardımcıları (yerel saat)
function toLocalInput(dateValue) {
  if (!dateValue) return '';
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function renderCampaignGroupCheckboxes(selectedIds = []) {
  if (!elements.campaignGroupCheckboxes) return;

  if (state.deviceGroups.length === 0) {
    elements.campaignGroupCheckboxes.innerHTML = `
      <div class="empty-placeholder">
        <i class="ph ph-squares-four"></i>
        <span>Henüz grup yok — Gruplar sayfasından oluşturabilirsiniz</span>
      </div>
    `;
    if (elements.targetGroupCount) elements.targetGroupCount.textContent = '0 grup';
    return;
  }

  elements.campaignGroupCheckboxes.innerHTML = state.deviceGroups.map(group => {
    const gId = getId(group);
    const checked = selectedIds.includes(gId) ? 'checked' : '';
    const count = group.deviceCount ?? group.deviceIds?.length ?? 0;
    return `
    <div class="group-target-item accordion">
      <div class="group-target-head">
        <label class="device-select-item">
          <input type="checkbox" value="${gId}" ${checked} onchange="updateTargetGroupCount()">
          <div class="device-select-info">
            <div class="device-select-name">${escapeHtml(group.name)}</div>
            <div class="device-select-id">${count} cihaz</div>
          </div>
        </label>
        <button type="button" class="accordion-toggle group-expand" onclick="toggleAccordion(this)" aria-expanded="false" title="Ekranları göster">
          <i class="ph ph-caret-right acc-caret"></i>
        </button>
      </div>
      <div class="accordion-body">
        <div class="group-members">${groupMembersHtml(group)}</div>
      </div>
    </div>
  `;}).join('');

  updateTargetGroupCount();
}

// Bir cihazın ait olduğu grupları chip listesi olarak döndürür (yoksa boş)
function deviceGroupsHtml(deviceId) {
  const id = getId(deviceId);
  const groups = (state.deviceGroups || []).filter(g =>
    (g.deviceIds || []).some(d => getId(d) === id)
  );
  if (!groups.length) return '<span class="text-muted">-</span>';
  return `<div class="device-chips">${groups
    .map(g => `<span class="group-chip">${escapeHtml(g.name)}</span>`)
    .join('')}</div>`;
}

// Bir grubun üye cihazlarını (isim + ID + oran) chip listesi olarak döndürür
function groupMembersHtml(group) {
  const ids = group.deviceIds || [];
  if (!ids.length) {
    return '<span class="group-member-empty">Bu grupta cihaz yok</span>';
  }
  return ids.map(did => {
    const id = getId(did);
    const device = state.devices.find(d => getId(d) === id);
    const name = device?.name || (id ? id.substring(0, 8) : 'Cihaz');
    const idLabel = device?.displayId || (id ? id.substring(0, 8) : '-');
    const aspect = device?.aspectRatio ? ` · ${escapeHtml(device.aspectRatio)}` : '';
    return `<span class="group-member-chip"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(idLabel)}${aspect}</small></span>`;
  }).join('');
}

function updateTargetGroupCount() {
  const checked = elements.campaignGroupCheckboxes?.querySelectorAll('input[type="checkbox"]:checked').length || 0;
  if (elements.targetGroupCount) elements.targetGroupCount.textContent = `${checked} grup`;
}

function closeLandingPageModal() {
  elements.landingPageModal?.classList.remove('show');
  state.currentLandingPage = null;
  elements.landingPageForm?.reset();
  if (elements.slidesList) elements.slidesList.innerHTML = '';
}

// ---- Kiosk chrome (navbar / side panel) ----
function resolveChromeFromPage(landingPage) {
  if (!landingPage) return { showNavbar: true, showSidePanel: true };
  if (landingPage.showNavbar !== undefined || landingPage.showSidePanel !== undefined) {
    return {
      showNavbar: landingPage.showNavbar !== false,
      showSidePanel: landingPage.showSidePanel !== false,
    };
  }
  const immersive = landingPage.displayMode === 'fullscreen';
  return { showNavbar: !immersive, showSidePanel: !immersive };
}

function setLandingChrome({ showNavbar, showSidePanel }) {
  if (elements.showNavbar) elements.showNavbar.checked = Boolean(showNavbar);
  if (elements.showSidePanel) elements.showSidePanel.checked = Boolean(showSidePanel);
  updateChromeToggleStyles();
}

function updateChromeToggleStyles() {
  document.querySelectorAll('.chrome-toggle').forEach((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    label.classList.toggle('is-active', Boolean(input?.checked));
  });
}

function readLandingChromeFromForm() {
  return {
    showNavbar: elements.showNavbar?.checked !== false,
    showSidePanel: elements.showSidePanel?.checked !== false,
  };
}

// ---- Satır içi accordion aç/kapa (genel amaçlı) ----
function toggleAccordion(btn) {
  const acc = btn.closest('.accordion');
  if (!acc) return;
  const open = acc.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(open));
}
window.toggleAccordion = toggleAccordion;

function openDeviceAssignModal() {
  renderDeviceCheckboxes();
  elements.deviceAssignModal?.classList.add('show');
}

function closeDeviceAssignModal() {
  elements.deviceAssignModal?.classList.remove('show');
}

// ============================================
// Landing Page CRUD
// ============================================
async function handleLandingPageSubmit(e) {
  e.preventDefault();
  
  const id = elements.landingPageId?.value;
  const name = elements.landingPageName?.value?.trim();
  const transitionDuration = parseInt(elements.transitionDuration?.value) || 8000;
  
  if (!name) {
    showToast('Lütfen kampanya adı girin', 'error');
    return;
  }
  
  // Get slides (zengin alanlarla)
  const slideElements = elements.slidesList?.querySelectorAll('.slide-item') || [];
  const slides = Array.from(slideElements).map((el, index) => {
    const targetGroupIds = Array.from(
      el.querySelectorAll('.slide-target-checkboxes input[type="checkbox"]:checked')
    ).map(cb => cb.value);
    const mediaType = el.querySelector('.slide-media-type')?.value || el.dataset.mediaType || 'image';
    const durationRaw = el.querySelector('.slide-duration-input')?.value;
    const durationMs = durationRaw ? Math.round(parseFloat(durationRaw) * 1000) : null;
    return {
      id: el.dataset.slideId || generateId(),
      imageUrl: el.querySelector('.slide-url-input')?.value?.trim() || '',
      mediaType,
      durationMs: Number.isFinite(durationMs) && durationMs >= 1000 ? durationMs : null,
      title: el.querySelector('.slide-title-input')?.value?.trim() || '',
      description: el.querySelector('.slide-desc-input')?.value?.trim() || '',
      width: parseInt(el.dataset.width) || 0,
      height: parseInt(el.dataset.height) || 0,
      aspectRatio: el.querySelector('.slide-aspect-select')?.value || el.dataset.aspect || '',
      schedule: {
        startDate: fromLocalInput(el.querySelector('.slide-start')?.value),
        endDate: fromLocalInput(el.querySelector('.slide-end')?.value)
      },
      targetGroupIds,
      order: index,
      mediaGroupId: el.closest('.media-group')?.dataset.mediaGroupId || '',
      mediaGroupTitle: el.closest('.media-group')?.querySelector('.media-group-title')?.value?.trim() || '',
    };
  }).filter(slide => slide.imageUrl);

  // Hedef gruplar (kampanya seviyesi)
  const groupIds = Array.from(
    elements.campaignGroupCheckboxes?.querySelectorAll('input[type="checkbox"]:checked') || []
  ).map(cb => cb.value);
  
  const chrome = readLandingChromeFromForm();
  const letterboxColor = elements.letterboxColor?.value === 'white' ? 'white' : 'black';

  const syncEnabled = Boolean(elements.syncEnabled?.checked);
  if (syncEnabled) {
    const hasSlideTargets = slides.some(s => Array.isArray(s.targetGroupIds) && s.targetGroupIds.length);
    if (hasSlideTargets) {
      showToast('Senkron açıkken slide bazlı hedef grup kullanılamaz', 'error');
      return;
    }
  }

  const payload = {
    name,
    transitionDuration,
    slides,
    deviceIds: state.currentLandingPage?.deviceIds || [],
    groupIds,
    showNavbar: chrome.showNavbar,
    showSidePanel: chrome.showSidePanel,
    letterboxColor,
    sync: {
      enabled: syncEnabled,
      epochMode: 'midnight',
      epochAt: null,
      tickMs: 250,
    },
    schedule: {
      startDate: fromLocalInput(elements.campaignStart?.value),
      endDate: fromLocalInput(elements.campaignEnd?.value)
    },
    venueId: getActiveVenueId()
  };
  
  try {
    let response;
    if (id) {
      response = await authFetch(`${API_BASE_URL}/api/landing-pages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await authFetch(`${API_BASE_URL}/api/landing-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    
    if (response.ok) {
      closeLandingPageModal();
      await refreshAllData();
      showToast(id ? 'Kampanya güncellendi' : 'Kampanya oluşturuldu', 'success');
    } else {
      throw new Error('Failed to save');
    }
  } catch (error) {
    console.error('Error saving landing page:', error);
    showToast('Kaydetme işlemi başarısız', 'error');
  }
}

function editLandingPage(id) {
  const landingPage = state.landingPages.find(lp => getId(lp) === id);
  if (landingPage) {
    openLandingPageModal(landingPage);
  }
}

async function deleteLandingPage(id) {
  const landingPage = state.landingPages.find(lp => getId(lp) === id);
  if (!confirm(`"${landingPage?.name}" kampanyasını silmek istediğinize emin misiniz?`)) {
    return;
  }
  
  try {
    const response = await authFetch(`${API_BASE_URL}/api/landing-pages/${id}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await refreshAllData();
      showToast('Kampanya silindi', 'success');
    } else {
      throw new Error('Failed to delete');
    }
  } catch (error) {
    console.error('Error deleting landing page:', error);
    showToast('Silme işlemi başarısız', 'error');
  }
}

// ============================================
// Device Functions
// ============================================
async function deleteDevice(id) {
  const device = state.devices.find(d => getId(d) === id);
  if (!confirm(`"${device?.name || 'Bu cihazı'}" silmek istediğinize emin misiniz?`)) {
    return;
  }
  
  try {
    const response = await authFetch(`${API_BASE_URL}/api/devices/${id}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await refreshAllData();
      showToast('Cihaz silindi', 'success');
    } else {
      throw new Error('Failed to delete');
    }
  } catch (error) {
    console.error('Error deleting device:', error);
    showToast('Silme işlemi başarısız', 'error');
  }
}

// ============================================
// Device Name Edit Functions
// ============================================
function fillAspectSelect(selectEl, selected = '', { includeAuto = true } = {}) {
  if (!selectEl) return;
  const classes = (window.AspectUtil?.ASPECT_CLASSES || []).map((c) => c.label);
  const opts = [];
  if (includeAuto) {
    opts.push(`<option value="">Otomatik (tespit / ekran)</option>`);
  }
  for (const label of classes) {
    opts.push(`<option value="${label}">${label}</option>`);
  }
  if (selected && !classes.includes(selected) && selected !== '') {
    opts.push(`<option value="${escapeHtml(selected)}">${escapeHtml(selected)} (özel)</option>`);
  }
  selectEl.innerHTML = opts.join('');
  selectEl.value = selected || '';
}

function openDeviceNameModal(deviceId) {
  const device = state.devices.find(d => getId(d) === deviceId);
  if (!device) return;

  const titleSpan = document.querySelector('#deviceNameModal .modal-title span');
  if (titleSpan) titleSpan.textContent = 'Cihazı Düzenle';

  if (elements.editDeviceId) elements.editDeviceId.value = deviceId;
  if (elements.editDeviceName) elements.editDeviceName.value = device.name || device.displayId || '';

  const autoAspect = window.AspectUtil?.aspectFromResolution?.(device.deviceInfo?.screenResolution) || '';
  const current = device.aspectRatio || '';
  // Otomatik ile aynıysa boş seç (otomatik); farklıysa manuel override
  const selectValue = (autoAspect && current === autoAspect) ? '' : current;
  fillAspectSelect(elements.editDeviceAspect, selectValue, { includeAuto: true });
  if (elements.editDeviceContentAlign) {
    const align = device.contentAlign || 'center';
    elements.editDeviceContentAlign.value = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].includes(align)
      ? align
      : 'center';
  }
  if (elements.editDeviceShellMode) {
    const mode = device.kioskShellMode || 'both';
    elements.editDeviceShellMode.value = ['both', 'landing', 'map'].includes(mode) ? mode : 'both';
  }
  if (elements.editDeviceAspectHint) {
    elements.editDeviceAspectHint.textContent = autoAspect
      ? `Ekran çözünürlüğünden: ${autoAspect}${device.deviceInfo?.screenResolution ? ` (${device.deviceInfo.screenResolution})` : ''}. Kampanya medyası bu orana göre dağıtılır.`
      : 'Kampanya medyası bu orana göre cihazlara dağıtılır.';
  }

  elements.deviceNameModal?.classList.add('show');
  elements.editDeviceName?.focus();
}

function closeDeviceNameModal() {
  elements.deviceNameModal?.classList.remove('show');
  elements.deviceNameForm?.reset();
}

async function handleDeviceNameSubmit(e) {
  e.preventDefault();

  const deviceId = elements.editDeviceId?.value;
  const newName = elements.editDeviceName?.value?.trim();
  const aspectRatio = elements.editDeviceAspect?.value ?? '';
  const contentAlign = elements.editDeviceContentAlign?.value || 'center';
  const kioskShellMode = elements.editDeviceShellMode?.value || 'both';

  if (!deviceId || !newName) {
    showToast('Lütfen cihaz adı girin', 'error');
    return;
  }

  try {
    const body = { name: newName, aspectRatio, contentAlign, kioskShellMode };
    const response = await authFetch(`${API_BASE_URL}/api/devices/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      closeDeviceNameModal();
      await loadDevices();
      showToast('Cihaz güncellendi', 'success');
    } else {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to update');
    }
  } catch (error) {
    console.error('Error updating device:', error);
    showToast(error.message || 'Güncelleme başarısız', 'error');
  }
}

function openDeviceVenueModal(deviceId) {
  if (state.user?.role !== 'admin') return;
  const device = state.devices.find(d => getId(d) === deviceId);
  if (!device || device.enrollmentStatus === 'revoked') return;

  elements.venueAssignDeviceId.value = deviceId;
  elements.venueAssignDeviceName.textContent = device.name || 'İsimsiz Cihaz';
  elements.venueAssignDisplayId.textContent = `Cihaz kodu: ${device.displayId || deviceId}`;
  elements.venueAssignSelect.innerHTML = '<option value="">Mekan seçin</option>' +
    state.venues.map(venue =>
      `<option value="${getId(venue)}">${escapeHtml(venue.name)}</option>`
    ).join('');

  const currentVenueId = device.venueId ? String(device.venueId) : '';
  elements.venueAssignSelect.value = currentVenueId;
  elements.deviceVenueModal?.classList.add('show');
  elements.venueAssignSelect?.focus();
}

function closeDeviceVenueModal() {
  elements.deviceVenueModal?.classList.remove('show');
  elements.deviceVenueForm?.reset();
}

async function handleDeviceVenueSubmit(e) {
  e.preventDefault();
  const deviceId = elements.venueAssignDeviceId?.value;
  const venueId = elements.venueAssignSelect?.value;
  const device = state.devices.find(d => getId(d) === deviceId);

  if (!deviceId || !venueId) {
    showToast('Lütfen bir mekan seçin', 'warning');
    return;
  }

  try {
    const response = await authFetch(`${API_BASE_URL}/api/devices/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Mekan ataması başarısız');

    closeDeviceVenueModal();
    if (device?.enrollmentStatus === 'pending') state.deviceView = 'venue';
    await refreshAllData();
    showToast('Cihaz mekana atandı', 'success');
  } catch (error) {
    showToast(error.message || 'Mekan ataması başarısız', 'error');
  }
}

async function revokeDevice(deviceId) {
  if (!confirm('Bu cihazın erişimini iptal etmek istediğinize emin misiniz?')) return;
  try {
    const response = await authFetch(`${API_BASE_URL}/api/devices/${deviceId}/revoke`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'İptal başarısız');
    }
    await refreshAllData();
    showToast('Cihaz erişimi iptal edildi', 'success');
  } catch (error) {
    showToast(error.message || 'İptal başarısız', 'error');
  }
}

async function resetDevice(deviceId) {
  try {
    const response = await authFetch(`${API_BASE_URL}/api/devices/${deviceId}/reset`, {
      method: 'POST',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Yeniden eşleştirme başarısız');
    await loadDevices();
    showToast('Cihaz yeniden eşleştirme için bekliyor', 'success');
  } catch (error) {
    showToast(error.message || 'Yeniden eşleştirme başarısız', 'error');
  }
}

function setDeviceView(view) {
  state.deviceView = view;
  document.querySelectorAll('[data-device-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.deviceView === view);
  });
  document.querySelector('.filter-group')?.classList.toggle('is-hidden', view === 'pending');
  loadDevices();
}

function filterDevices(filter) {
  const search = elements.deviceSearch?.value || '';
  renderDevicesTable(filter, search);
}

function handleDeviceSearch(e) {
  const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
  renderDevicesTable(activeFilter, e.target.value);
}

// ============================================
// Slide Functions
// ============================================
function guessMediaTypeFromUrl(url) {
  const u = String(url || '').split('?')[0].toLowerCase();
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(u)) return 'video';
  return 'image';
}

function aspectSelectHtml(selected = '') {
  const classes = (window.AspectUtil?.ASPECT_CLASSES || []).map((c) => c.label);
  const opts = [`<option value="">Otomatik (medya)</option>`];
  for (const label of classes) {
    opts.push(`<option value="${label}" ${selected === label ? 'selected' : ''}>${label}</option>`);
  }
  if (selected && !classes.includes(selected)) {
    opts.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (özel)</option>`);
  }
  return opts.join('');
}

async function loadBrandSuggestions() {
  campaignWizard.brandNames = [];
  const venueId = getActiveVenueId();
  if (!venueId) return;
  try {
    const units = await loadVenueUnits(venueId);
    campaignWizard.brandNames = [...new Set(
      (units || []).map((u) => String(u.title || '').trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'tr'));
  } catch {
    campaignWizard.brandNames = [];
  }
}

function bindBrandAutocomplete(input) {
  if (!input) return;
  let listEl = null;
  const hide = () => { listEl?.remove(); listEl = null; };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { hide(); return; }
    const matches = campaignWizard.brandNames
      .filter((n) => n.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) { hide(); return; }
    if (!listEl) {
      listEl = document.createElement('div');
      listEl.className = 'brand-suggest-list';
      input.parentElement?.classList.add('brand-suggest');
      input.parentElement?.appendChild(listEl);
    }
    listEl.innerHTML = matches.map((n) =>
      `<button type="button">${escapeHtml(n)}</button>`
    ).join('');
    listEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = btn.textContent || '';
        hide();
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(hide, 150));
}

async function uploadCampaignFile(file) {
  const venueId = getActiveVenueId();
  if (!venueId) throw new Error('Mekan seçili değil');
  const formData = new FormData();
  formData.append('file', file);
  const response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/campaign-media`, {
    method: 'POST',
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Yükleme başarısız');
  return data;
}

async function handleMediaDrop(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  showToast(`${files.length} dosya yükleniyor…`, 'success');
  const grouped = files.length > 1;
  const groupId = grouped ? generateId() : '';
  const groupTitle = grouped ? deriveGroupTitle(files[0]?.name) : '';
  for (const file of files) {
    try {
      const saved = await uploadCampaignFile(file);
      const baseName = (file.name || '').replace(/\.[^.]+$/, '');
      addSlide({
        imageUrl: saved.url,
        mediaType: saved.mediaType || guessMediaTypeFromUrl(saved.url),
        title: grouped ? groupTitle : baseName,
        mediaGroupId: groupId,
        mediaGroupTitle: groupTitle,
      });
    } catch (err) {
      console.error(err);
      showToast(err.message || `${file.name} yüklenemedi`, 'error');
    }
  }
}

function deriveGroupTitle(filename) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  const trimmed = base.replace(/[-_\s]*(\(\d+\)|\d+)$/, '').trim();
  return trimmed || 'Toplu yükleme';
}

function pruneEmptyMediaGroups() {
  elements.slidesList?.querySelectorAll('.media-group').forEach((group) => {
    if (!group.querySelector('.slide-item')) group.remove();
    else refreshMediaGroupMeta(group);
  });
}

function refreshMediaGroupMeta(group) {
  if (!group) return;
  const n = group.querySelectorAll('.slide-item').length;
  const countEl = group.querySelector('.media-group-count');
  if (countEl) countEl.textContent = `${n} medya`;
}

function ensureMediaGroup(groupId, groupTitle) {
  if (!groupId || !elements.slidesList) return null;
  let group = Array.from(elements.slidesList.querySelectorAll('.media-group'))
    .find((g) => g.dataset.mediaGroupId === groupId);
  if (group) return group;
  group = document.createElement('div');
  group.className = 'media-group accordion';
  group.dataset.mediaGroupId = groupId;
  group.innerHTML = `
    <div class="media-group-head">
      <button type="button" class="accordion-toggle" onclick="toggleAccordion(this)" aria-expanded="false">
        <i class="ph ph-caret-right acc-caret"></i>
        <span class="media-group-count">0 medya</span>
      </button>
      <div class="brand-suggest media-group-title-wrap">
        <input type="text" class="form-input media-group-title" placeholder="Grup adı — tüm medyaya uygulanır" value="${escapeHtml(groupTitle || '')}" autocomplete="off">
      </div>
      <button type="button" class="btn btn-outline btn-sm" onclick="ungroupMediaGroup(this)">Tekil dağıt</button>
    </div>
    <div class="accordion-body media-group-items"></div>
  `;
  elements.slidesList.appendChild(group);
  const titleInput = group.querySelector('.media-group-title');
  bindBrandAutocomplete(titleInput);
  const applyGroupTitle = () => {
    const v = titleInput.value;
    group.querySelectorAll('.slide-title-input').forEach((inp) => { inp.value = v; });
  };
  titleInput?.addEventListener('input', applyGroupTitle);
  titleInput?.addEventListener('change', applyGroupTitle);
  return group;
}

function ungroupMediaGroup(btn) {
  const group = btn.closest('.media-group');
  if (!group) return;
  const items = Array.from(group.querySelectorAll('.slide-item'));
  let anchor = group;
  items.forEach((el) => {
    delete el.dataset.mediaGroupId;
    anchor.after(el);
    anchor = el;
  });
  group.remove();
  updateSlideOrders();
  updateSlideCount();
}
window.ungroupMediaGroup = ungroupMediaGroup;

function handleMediaUrlAdd() {
  const url = elements.mediaUrlInput?.value?.trim();
  if (!url) {
    showToast('URL girin', 'error');
    return;
  }
  addSlide({
    imageUrl: url,
    mediaType: guessMediaTypeFromUrl(url),
  });
  if (elements.mediaUrlInput) elements.mediaUrlInput.value = '';
}

function renderTimingStep() {
  const host = elements.timingSlidesList;
  if (!host) return;
  const items = Array.from(elements.slidesList?.querySelectorAll('.slide-item') || []);
  if (!items.length) {
    host.innerHTML = '<div class="empty-placeholder"><span>Önce medya ekleyin</span></div>';
    return;
  }
  host.innerHTML = items.map((el, i) => {
    const title = el.querySelector('.slide-title-input')?.value?.trim()
      || el.querySelector('.slide-url-input')?.value?.trim()
      || `Medya ${i + 1}`;
    const mediaType = el.querySelector('.slide-media-type')?.value || 'image';
    const url = el.querySelector('.slide-url-input')?.value?.trim() || '';
    const dur = el.querySelector('.slide-duration-input')?.value || '';
    const aspect = el.querySelector('.slide-aspect-select')?.value || 'otomatik oran';
    const thumb = mediaType === 'video'
      ? `<div class="timing-slide-thumb"><video src="${escapeHtml(url)}" muted playsinline preload="metadata"></video></div>`
      : `<div class="timing-slide-thumb"><img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.style.opacity='0.2'"></div>`;
    return `<div class="timing-slide-row" data-slide-ref="${el.dataset.slideId}">
      ${thumb}
      <div>
        <strong>${escapeHtml(title.slice(0, 60))}</strong>
        <div class="form-hint">${mediaType === 'video' ? 'Video' : 'Görsel'} · ${escapeHtml(aspect)}</div>
      </div>
      <label class="form-hint" style="display:flex;flex-direction:column;gap:4px;">
        ${mediaType === 'video' ? 'Video süresi (sn)' : 'Özel süre (sn, opsiyonel)'}
        <input type="number" class="form-input timing-duration-input" min="1" max="600" step="0.1" value="${escapeHtml(dur)}" data-for="${el.dataset.slideId}" style="width:110px">
      </label>
    </div>`;
  }).join('');
  host.querySelectorAll('.timing-duration-input').forEach((input) => {
    input.addEventListener('change', () => {
      const slideEl = elements.slidesList?.querySelector(`[data-slide-id="${input.dataset.for}"]`);
      const target = slideEl?.querySelector('.slide-duration-input');
      if (target) target.value = input.value;
      const inline = slideEl?.querySelector('.slide-duration-inline');
      if (inline && input.value) inline.hidden = false;
    });
  });
}

function renderWizardSummary() {
  const host = elements.campaignWizardSummary;
  if (!host) return;
  const name = elements.landingPageName?.value?.trim() || '—';
  const slides = Array.from(elements.slidesList?.querySelectorAll('.slide-item') || []);
  const groups = Array.from(
    elements.campaignGroupCheckboxes?.querySelectorAll('input[type="checkbox"]:checked') || []
  ).length;
  const devices = state.currentLandingPage?.deviceIds?.length || 0;
  const chrome = readLandingChromeFromForm();
  const syncOn = Boolean(elements.syncEnabled?.checked);
  const dur = Math.round((parseInt(elements.transitionDuration?.value, 10) || 8000) / 1000);
  const chips = slides.map((el, i) => {
    const t = el.querySelector('.slide-title-input')?.value?.trim() || `Medya ${i + 1}`;
    const ar = el.querySelector('.slide-aspect-select')?.value || 'auto';
    return `<span>${escapeHtml(t)} · ${escapeHtml(ar)}</span>`;
  }).join('');

  host.innerHTML = `
    <div class="wizard-summary-card"><h4>Kampanya</h4><p>${escapeHtml(name)}</p></div>
    <div class="wizard-summary-card"><h4>Medya</h4><p>${slides.length} öğe · genel geçiş ${dur}s</p><div class="wizard-summary-chips">${chips || '<span>Yok</span>'}</div></div>
    <div class="wizard-summary-card"><h4>Hedef</h4><p>${groups} grup · ${devices} cihaz</p></div>
    <div class="wizard-summary-card"><h4>Görünüm</h4><p>Navbar: ${chrome.showNavbar ? 'açık' : 'kapalı'} · Side panel: ${chrome.showSidePanel ? 'açık' : 'kapalı'} · Bar: ${elements.letterboxColor?.value === 'white' ? 'beyaz' : 'siyah'} · Senkron: ${syncOn ? 'açık' : 'kapalı'}</p></div>
  `;
}

function addSlide(slide = null) {
  const slideId = slide?.id || generateId();
  const slideItem = document.createElement('div');
  slideItem.className = 'slide-item media-card';
  slideItem.dataset.slideId = slideId;
  slideItem.dataset.width = slide?.width || 0;
  slideItem.dataset.height = slide?.height || 0;
  slideItem.dataset.aspect = slide?.aspectRatio || '';
  slideItem.dataset.aspectManual = slide?.aspectRatio ? '1' : '';
  const mediaType = slide?.mediaType || guessMediaTypeFromUrl(slide?.imageUrl) || 'image';
  slideItem.dataset.mediaType = mediaType;

  const slideNumber = (elements.slidesList?.children.length || 0) + 1;
  const imageUrl = slide?.imageUrl || '';
  const description = slide?.description || '';
  const title = slide?.title || '';
  const aspect = slide?.aspectRatio || '';
  const startVal = toLocalInput(slide?.schedule?.startDate);
  const endVal = toLocalInput(slide?.schedule?.endDate);
  const durationSec = slide?.durationMs ? (Number(slide.durationMs) / 1000) : '';

  slideItem.innerHTML = `
    <div class="media-card-main">
      <span class="slide-order">${slideNumber}</span>
      <div class="slide-thumb-wrap">
        <img src="${mediaType === 'image' && imageUrl ? escapeHtml(imageUrl) : ''}" class="slide-thumb" ${mediaType === 'image' && imageUrl ? '' : 'hidden'} alt="" onerror="this.hidden=true">
        <video class="slide-thumb-video" muted playsinline preload="metadata" ${mediaType === 'video' && imageUrl ? `src="${escapeHtml(imageUrl)}"` : 'hidden'}></video>
        <span class="slide-media-badge">${mediaType === 'video' ? 'Video' : 'Görsel'}</span>
      </div>
      <div class="media-card-fields">
        <div class="media-row-top">
          <input type="text" class="form-input slide-title-input media-title-input" placeholder="İsim / marka (chip)" value="${escapeHtml(title)}">
          <select class="slide-media-type form-input media-type-select">
            <option value="image" ${mediaType === 'image' ? 'selected' : ''}>Görsel</option>
            <option value="video" ${mediaType === 'video' ? 'selected' : ''}>Video</option>
          </select>
          <div class="slide-actions">
            <button type="button" class="btn btn-ghost btn-icon btn-icon-sm" onclick="moveSlideUp(this)" title="Yukarı"><i class="ph ph-arrow-up"></i></button>
            <button type="button" class="btn btn-ghost btn-icon btn-icon-sm" onclick="moveSlideDown(this)" title="Aşağı"><i class="ph ph-arrow-down"></i></button>
            <button type="button" class="btn btn-ghost btn-icon btn-icon-sm btn-danger-ghost" onclick="removeSlide(this)" title="Sil"><i class="ph ph-trash"></i></button>
          </div>
        </div>
        <input type="url" class="slide-url-input form-input" placeholder="Medya URL" value="${escapeHtml(imageUrl)}" title="${escapeHtml(imageUrl)}">
        <div class="media-meta-row">
          <div class="media-aspect-row">
            <span class="form-hint">Hedef oran</span>
            <select class="form-input slide-aspect-select">${aspectSelectHtml(aspect)}</select>
            <span class="aspect-badge slide-aspect" hidden></span>
          </div>
          <label class="slide-duration-inline" ${mediaType === 'video' ? '' : 'hidden'}>
            <span class="form-hint">Süre (sn)</span>
            <input type="number" class="form-input slide-duration-input" min="1" max="600" step="0.1" placeholder="15" value="${durationSec}">
          </label>
        </div>
      </div>
    </div>
    <div class="media-card-extras">
      <div class="accordion slide-acc${(description || startVal || endVal || (slide?.targetGroupIds || []).length) ? ' open' : ''}">
        <button type="button" class="accordion-toggle" onclick="toggleAccordion(this)" aria-expanded="${(description || startVal || endVal || (slide?.targetGroupIds || []).length) ? 'true' : 'false'}">
          <i class="ph ph-caret-right acc-caret"></i>
          <i class="ph ph-sliders-horizontal"></i>
          <span>Ek ayarlar (opsiyonel)</span>
        </button>
        <div class="accordion-body">
          <label class="media-extra-field">
            <span class="form-hint">Açıklama (alt bant)</span>
            <input type="text" class="slide-desc-input form-input" placeholder="Boş bırakılabilir" value="${escapeHtml(description)}">
          </label>
          <div class="accordion slide-acc nested${(startVal || endVal) ? ' open' : ''}">
            <button type="button" class="accordion-toggle" onclick="toggleAccordion(this)" aria-expanded="${(startVal || endVal) ? 'true' : 'false'}">
              <i class="ph ph-caret-right acc-caret"></i>
              <i class="ph ph-calendar-blank"></i>
              <span>Slide özel tarih aralığı</span>
            </button>
            <div class="accordion-body">
              <div class="slide-schedule-row">
                <label class="slide-sched-field"><span>Başlangıç</span><input type="datetime-local" class="slide-start" value="${startVal}"></label>
                <label class="slide-sched-field"><span>Bitiş</span><input type="datetime-local" class="slide-end" value="${endVal}"></label>
              </div>
            </div>
          </div>
          <div class="accordion slide-acc nested${((slide?.targetGroupIds || []).length) ? ' open' : ''}">
            <button type="button" class="accordion-toggle" onclick="toggleAccordion(this)" aria-expanded="${((slide?.targetGroupIds || []).length) ? 'true' : 'false'}">
              <i class="ph ph-caret-right acc-caret"></i>
              <i class="ph ph-users-three"></i>
              <span>Slide özel hedef grup</span>
            </button>
            <div class="accordion-body">
              <div class="slide-target-groups">
                <div class="slide-target-checkboxes">${renderSlideTargetGroups((slide?.targetGroupIds || []).map(id => getId(id)))}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  const groupId = slide?.mediaGroupId || '';
  const groupTitle = slide?.mediaGroupTitle || '';
  if (groupId) {
    slideItem.dataset.mediaGroupId = groupId;
    const group = ensureMediaGroup(groupId, groupTitle);
    const host = group?.querySelector('.media-group-items');
    (host || elements.slidesList)?.appendChild(slideItem);
    const shared = group?.querySelector('.media-group-title')?.value?.trim();
    if (shared) {
      const titleEl = slideItem.querySelector('.slide-title-input');
      if (titleEl) titleEl.value = shared;
    }
    refreshMediaGroupMeta(group);
  } else {
    elements.slidesList?.appendChild(slideItem);
  }

  const urlInput = slideItem.querySelector('.slide-url-input');
  const typeSelect = slideItem.querySelector('.slide-media-type');
  const aspectSelect = slideItem.querySelector('.slide-aspect-select');
  const titleInput = slideItem.querySelector('.slide-title-input');
  bindBrandAutocomplete(titleInput);

  aspectSelect?.addEventListener('change', () => {
    slideItem.dataset.aspectManual = aspectSelect.value ? '1' : '';
    slideItem.dataset.aspect = aspectSelect.value || '';
  });

  typeSelect?.addEventListener('change', () => {
    slideItem.dataset.mediaType = typeSelect.value;
    const durInline = slideItem.querySelector('.slide-duration-inline');
    if (durInline) durInline.hidden = typeSelect.value !== 'video';
    const badge = slideItem.querySelector('.slide-media-badge');
    if (badge) badge.textContent = typeSelect.value === 'video' ? 'Video' : 'Görsel';
    detectSlideAspect(slideItem);
  });
  urlInput?.addEventListener('input', () => {
    urlInput.title = urlInput.value.trim();
  });
  urlInput?.addEventListener('change', () => {
    if (typeSelect && guessMediaTypeFromUrl(urlInput.value) === 'video') {
      typeSelect.value = 'video';
      typeSelect.dispatchEvent(new Event('change'));
    }
    detectSlideAspect(slideItem);
  });
  urlInput?.addEventListener('blur', () => detectSlideAspect(slideItem));

  if (imageUrl && !aspect) detectSlideAspect(slideItem);
  else if (imageUrl && mediaType === 'video' && !durationSec) detectSlideAspect(slideItem);
  else if (aspect) {
    const badge = slideItem.querySelector('.slide-aspect');
    if (badge) {
      badge.textContent = aspect;
      badge.hidden = false;
    }
  }

  updateSlideOrders();
  updateSlideCount();
}

function renderSlideTargetGroups(selectedIds = []) {
  if (!state.deviceGroups.length) {
    return '<span class="text-muted" style="font-size:0.8rem;">Grup yok</span>';
  }
  return state.deviceGroups.map(group => {
    const gId = getId(group);
    const checked = selectedIds.includes(gId) ? 'checked' : '';
    return `<label class="slide-target-chip"><input type="checkbox" value="${gId}" ${checked}><span>${escapeHtml(group.name)}</span></label>`;
  }).join('');
}

// Medya URL'sinden boyut / oran / video süresi tespit eder
function detectSlideAspect(slideItem) {
  const urlInput = slideItem.querySelector('.slide-url-input');
  const typeSelect = slideItem.querySelector('.slide-media-type');
  const aspectSelect = slideItem.querySelector('.slide-aspect-select');
  const url = urlInput?.value?.trim();
  const badge = slideItem.querySelector('.slide-aspect');
  const thumb = slideItem.querySelector('.slide-thumb');
  const thumbVideo = slideItem.querySelector('.slide-thumb-video');
  const mediaType = typeSelect?.value || slideItem.dataset.mediaType || guessMediaTypeFromUrl(url);
  const durationInput = slideItem.querySelector('.slide-duration-input');
  const manual = Boolean(slideItem.dataset.aspectManual) || Boolean(aspectSelect?.value);

  if (!url) {
    if (badge) { badge.hidden = true; badge.textContent = ''; }
    slideItem.dataset.width = 0;
    slideItem.dataset.height = 0;
    if (!manual) {
      slideItem.dataset.aspect = '';
      if (aspectSelect) aspectSelect.value = '';
    }
    if (thumb) { thumb.hidden = true; thumb.removeAttribute('src'); }
    if (thumbVideo) { thumbVideo.hidden = true; thumbVideo.removeAttribute('src'); }
    return;
  }

  if (badge) { badge.hidden = false; badge.textContent = '...'; }

  const applyDetected = (w, h, ar) => {
    slideItem.dataset.width = w;
    slideItem.dataset.height = h;
    if (!manual) {
      slideItem.dataset.aspect = ar;
      if (aspectSelect && ar) {
        aspectSelect.value = '';
      }
    } else {
      slideItem.dataset.aspect = aspectSelect?.value || slideItem.dataset.aspect || ar;
    }
    if (badge) {
      const shown = aspectSelect?.value || ar;
      badge.textContent = shown
        ? (w && h ? `${shown} · ${w}x${h}` : shown)
        : (w ? `${w}x${h}` : '');
      badge.hidden = !badge.textContent;
    }
  };

  if (mediaType === 'video') {
    if (thumb) { thumb.hidden = true; thumb.removeAttribute('src'); }
    if (thumbVideo) {
      thumbVideo.hidden = false;
      thumbVideo.src = url;
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      const ar = (w && h && window.AspectUtil) ? window.AspectUtil.computeAspectRatio(w, h) : '';
      applyDetected(w, h, ar);
      if (durationInput && !durationInput.value && Number.isFinite(video.duration) && video.duration > 0) {
        durationInput.value = String(Math.round(video.duration * 10) / 10);
      }
    };
    video.onerror = () => {
      if (badge) { badge.textContent = 'video okunamadı'; badge.hidden = false; }
    };
    video.src = url;
    return;
  }

  if (thumbVideo) { thumbVideo.hidden = true; thumbVideo.removeAttribute('src'); }
  if (thumb) { thumb.hidden = false; thumb.src = url; }

  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const ar = window.AspectUtil ? window.AspectUtil.computeAspectRatio(w, h) : '';
    applyDetected(w, h, ar);
  };
  img.onerror = () => {
    slideItem.dataset.width = 0;
    slideItem.dataset.height = 0;
    if (!manual) slideItem.dataset.aspect = '';
    if (badge) { badge.textContent = 'boyut okunamadı'; badge.hidden = false; }
  };
  img.src = url;
}

// Toplu URL ekleme alanını aç/kapat
function toggleBulkAddArea() {
  if (!elements.bulkAddArea) return;
  elements.bulkAddArea.hidden = !elements.bulkAddArea.hidden;
  if (!elements.bulkAddArea.hidden) elements.bulkUrls?.focus();
}

function handleBulkAdd() {
  const text = elements.bulkUrls?.value || '';
  const urls = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!urls.length) {
    showToast('Lütfen en az bir URL girin', 'error');
    return;
  }
  urls.forEach(url => addSlide({ imageUrl: url }));
  if (elements.bulkUrls) elements.bulkUrls.value = '';
  if (elements.bulkAddArea) elements.bulkAddArea.hidden = true;
  showToast(`${urls.length} görsel eklendi`, 'success');
}

function removeSlide(btn) {
  btn.closest('.slide-item')?.remove();
  pruneEmptyMediaGroups();
  updateSlideOrders();
  updateSlideCount();
}

function moveSlideUp(btn) {
  const slideItem = btn.closest('.slide-item');
  const prev = slideItem?.previousElementSibling;
  if (prev && slideItem) {
    elements.slidesList?.insertBefore(slideItem, prev);
    updateSlideOrders();
  }
}

function moveSlideDown(btn) {
  const slideItem = btn.closest('.slide-item');
  const next = slideItem?.nextElementSibling;
  if (next && slideItem) {
    elements.slidesList?.insertBefore(next, slideItem);
    updateSlideOrders();
  }
}

function updateSlideOrders() {
  const slideItems = elements.slidesList?.querySelectorAll('.slide-item') || [];
  slideItems.forEach((item, index) => {
    const order = item.querySelector('.slide-order');
    if (order) order.textContent = index + 1;
  });
}

function updateSlideCount() {
  const count = elements.slidesList?.querySelectorAll('.slide-item').length || 0;
  if (elements.slideCount) {
    elements.slideCount.textContent = `${count} medya`;
  }
}

// ============================================
// Device Assignment
// ============================================
function renderAssignedDevices() {
  if (!elements.assignedDevicesList) return;
  
  const deviceIds = state.currentLandingPage?.deviceIds || 
    state.currentLandingPage?.devices?.map(d => getId(d)) || [];
  
  if (deviceIds.length === 0) {
    elements.assignedDevicesList.innerHTML = `
      <div class="empty-placeholder">
        <i class="ph ph-devices"></i>
        <span>Henüz cihaz atanmadı</span>
      </div>
    `;
  } else {
    elements.assignedDevicesList.innerHTML = deviceIds.map(deviceId => {
      const did = getId(deviceId);
      const device = state.devices.find(d => getId(d) === did);
      const name = device?.name || did?.substring(0, 8) || 'Cihaz';
      return `
        <span class="device-chip">
          ${escapeHtml(name)}
          <button type="button" onclick="removeDeviceFromLP('${did}')">
            <i class="ph ph-x"></i>
          </button>
        </span>
      `;
    }).join('');
  }
  
  if (elements.deviceCount) {
    elements.deviceCount.textContent = `${deviceIds.length} cihaz`;
  }
}

function renderDeviceCheckboxes() {
  if (!elements.deviceCheckboxes) return;
  
  if (state.devices.length === 0) {
    elements.deviceCheckboxes.innerHTML = `
      <div class="empty-placeholder">
        <i class="ph ph-devices"></i>
        <span>Kayıtlı cihaz yok</span>
      </div>
    `;
    return;
  }

  const eligible = state.devices.filter(device => isActiveVenueDevice(device));
  if (!eligible.length) {
    elements.deviceCheckboxes.innerHTML = `
      <div class="empty-placeholder">
        <i class="ph ph-devices"></i>
        <span>Bu mekana atanmış cihaz yok. Cihazlar sayfasından mekana atayın.</span>
      </div>
    `;
    return;
  }
  
  const assignedDeviceIds = (state.currentLandingPage?.deviceIds || 
    state.currentLandingPage?.devices?.map(d => getId(d)) || [])
    .map(id => getId(id));
  
  elements.deviceCheckboxes.innerHTML = eligible
    .map(device => {
    const deviceId = getId(device);
    return `
    <label class="device-select-item">
      <input type="checkbox" value="${deviceId}" ${assignedDeviceIds.includes(deviceId) ? 'checked' : ''}>
      <div class="device-select-info">
        <div class="device-select-name">${escapeHtml(device.name || 'İsimsiz Cihaz')}</div>
        <div class="device-select-id">${deviceId?.substring(0, 12) || '-'}...</div>
      </div>
      <span class="device-select-status ${device.status}">${getStatusText(device.status)}</span>
    </label>
  `;}).join('');
}

function removeDeviceFromLP(deviceId) {
  if (!state.currentLandingPage) return;
  
  // Handle both deviceIds array and devices array
  if (state.currentLandingPage.deviceIds) {
    state.currentLandingPage.deviceIds = state.currentLandingPage.deviceIds
      .filter(id => getId(id) !== deviceId);
  }
  if (state.currentLandingPage.devices) {
    state.currentLandingPage.devices = state.currentLandingPage.devices
      .filter(d => getId(d) !== deviceId);
    // Sync deviceIds
    state.currentLandingPage.deviceIds = state.currentLandingPage.devices.map(d => getId(d));
  }
  
  renderAssignedDevices();
}

async function saveDeviceAssignment() {
  if (!state.currentLandingPage) return;
  
  const lpId = getId(state.currentLandingPage);
  const checkboxes = elements.deviceCheckboxes?.querySelectorAll('input[type="checkbox"]:checked') || [];
  const selectedDeviceIds = Array.from(checkboxes).map(cb => cb.value);
  
  try {
    const response = await authFetch(`${API_BASE_URL}/api/landing-pages/${lpId}/assign-devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceIds: selectedDeviceIds })
    });
    
    if (response.ok) {
      const data = await response.json();
      state.currentLandingPage.deviceIds = data.landingPage.deviceIds || 
        data.landingPage.devices?.map(d => getId(d)) || [];
      renderAssignedDevices();
      closeDeviceAssignModal();
      await refreshAllData();
      showToast('Cihazlar atandı', 'success');
    } else {
      throw new Error('Failed to assign');
    }
  } catch (error) {
    console.error('Error assigning devices:', error);
    showToast('Cihaz atama başarısız', 'error');
  }
}

// ============================================
// Device Groups
// ============================================
function renderDeviceGroups(filter = '') {
  const filtered = filter
    ? state.deviceGroups.filter(g => g.name.toLowerCase().includes(filter.toLowerCase()))
    : state.deviceGroups;

  if (filtered.length === 0) {
    if (elements.groupsList) elements.groupsList.innerHTML = '';
    if (elements.groupsEmpty) elements.groupsEmpty.style.display = 'flex';
    return;
  }

  if (elements.groupsEmpty) elements.groupsEmpty.style.display = 'none';

  if (elements.groupsList) {
    elements.groupsList.innerHTML = filtered.map(group => {
      const gId = getId(group);
      const count = group.deviceCount ?? group.deviceIds?.length ?? 0;
      return `
      <div class="landing-page-card" data-id="${gId}">
        <div class="lp-card-header">
          <h3 class="lp-card-title">${escapeHtml(group.name)}</h3>
          <div class="lp-card-meta">
            <span><i class="ph ph-devices"></i> ${count} cihaz</span>
          </div>
        </div>
        <div class="lp-card-body">
          ${group.description ? `<p class="text-muted" style="margin-bottom: 0.75rem;">${escapeHtml(group.description)}</p>` : ''}
          <div class="device-chips">
            ${(group.deviceIds || []).slice(0, 6).map(did => {
              const device = state.devices.find(d => getId(d) === getId(did));
              const name = device?.name || String(getId(did)).substring(0, 8);
              return `<span class="device-chip">${escapeHtml(name)}</span>`;
            }).join('') || '<span class="text-muted">Cihaz atanmadı</span>'}
            ${count > 6 ? `<span class="device-chip">+${count - 6}</span>` : ''}
          </div>
        </div>
        <div class="lp-card-footer">
          <button class="btn btn-primary btn-sm" onclick="editGroup('${gId}')">
            <i class="ph ph-pencil-simple"></i>
            <span>Düzenle</span>
          </button>
          <button class="btn btn-ghost btn-sm" onclick="deleteGroup('${gId}')">
            <i class="ph ph-trash"></i>
            <span>Sil</span>
          </button>
        </div>
      </div>
    `;}).join('');
  }
}

function openGroupModal(group = null) {
  if (!getActiveVenueId()) {
    showToast('Önce sidebar\'dan bir mekan seçin', 'warning');
    return;
  }
  state.currentGroup = group;

  const titleSpan = elements.groupModalTitle?.querySelector('span');
  if (titleSpan) titleSpan.textContent = group ? 'Grup Düzenle' : 'Yeni Grup';

  if (elements.groupId) elements.groupId.value = getId(group) || '';
  if (elements.groupName) elements.groupName.value = group?.name || '';
  if (elements.groupDescription) elements.groupDescription.value = group?.description || '';
  if (elements.groupContentAlign) {
    elements.groupContentAlign.value = group
      ? (group.contentAlign || inferGroupField(group, 'contentAlign') || '')
      : 'center';
  }
  if (elements.groupShellMode) {
    elements.groupShellMode.value = group
      ? (group.kioskShellMode || inferGroupField(group, 'kioskShellMode') || '')
      : 'both';
  }

  const selectedIds = (group?.deviceIds || []).map(id => getId(id));
  renderGroupDeviceCheckboxes(selectedIds);

  elements.groupModal?.classList.add('show');
}

/** Üyelerin ortak değeri; karışıksa boş — "Değiştirme" seçili kalır. */
function inferGroupField(group, field) {
  const ids = new Set((group?.deviceIds || []).map(id => getId(id)));
  if (!ids.size) return '';
  const values = state.devices
    .filter(device => ids.has(getId(device)))
    .map(device => device[field] || '');
  if (!values.length) return '';
  return values.every(value => value === values[0]) ? values[0] : '';
}

function closeGroupModal() {
  elements.groupModal?.classList.remove('show');
  state.currentGroup = null;
  elements.groupForm?.reset();
}

function renderGroupDeviceCheckboxes(selectedIds = []) {
  if (!elements.groupDeviceCheckboxes) return;

  const eligible = state.devices.filter(device => isActiveVenueDevice(device));

  if (!eligible.length) {
    elements.groupDeviceCheckboxes.innerHTML = `
      <div class="empty-placeholder">
        <i class="ph ph-devices"></i>
        <span>${state.devices.length
          ? 'Bu mekana atanmış cihaz yok. Cihazlar sayfasından mekana atayın.'
          : 'Kayıtlı cihaz yok'}</span>
      </div>
    `;
    updateGroupDeviceCount();
    return;
  }

  elements.groupDeviceCheckboxes.innerHTML = eligible.map(device => {
    const deviceId = getId(device);
    const checked = selectedIds.includes(deviceId) ? 'checked' : '';
    return `
    <label class="device-select-item">
      <input type="checkbox" value="${deviceId}" ${checked} onchange="updateGroupDeviceCount()">
      <div class="device-select-info">
        <div class="device-select-name">${escapeHtml(device.name || 'İsimsiz Cihaz')}</div>
        <div class="device-select-id">${device.deviceInfo?.screenResolution || '-'}${device.aspectRatio ? ' · ' + escapeHtml(device.aspectRatio) : ''}</div>
      </div>
      <span class="device-select-status ${device.status}">${getStatusText(device.status)}</span>
    </label>
  `;}).join('');

  updateGroupDeviceCount();
}

function updateGroupDeviceCount() {
  const checked = elements.groupDeviceCheckboxes?.querySelectorAll('input[type="checkbox"]:checked').length || 0;
  if (elements.groupDeviceCount) elements.groupDeviceCount.textContent = `${checked} cihaz`;
}

async function handleGroupSubmit(e) {
  e.preventDefault();

  const id = elements.groupId?.value;
  const name = elements.groupName?.value?.trim();
  const description = elements.groupDescription?.value?.trim() || '';

  if (!name) {
    showToast('Lütfen grup adı girin', 'error');
    return;
  }

  const checkboxes = elements.groupDeviceCheckboxes?.querySelectorAll('input[type="checkbox"]:checked') || [];
  const deviceIds = Array.from(checkboxes).map(cb => cb.value);

  const contentAlign = elements.groupContentAlign?.value || '';
  const kioskShellMode = elements.groupShellMode?.value || '';
  const payload = { name, description, deviceIds, venueId: getActiveVenueId() };
  if (contentAlign) payload.contentAlign = contentAlign;
  if (kioskShellMode) payload.kioskShellMode = kioskShellMode;

  try {
    let response;
    if (id) {
      response = await authFetch(`${API_BASE_URL}/api/device-groups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await authFetch(`${API_BASE_URL}/api/device-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (response.ok) {
      closeGroupModal();
      await refreshAllData();
      showToast(id ? 'Grup güncellendi' : 'Grup oluşturuldu', 'success');
    } else {
      throw new Error('Failed to save group');
    }
  } catch (error) {
    console.error('Error saving group:', error);
    showToast('Grup kaydedilemedi', 'error');
  }
}

function editGroup(id) {
  const group = state.deviceGroups.find(g => getId(g) === id);
  if (group) openGroupModal(group);
}

async function deleteGroup(id) {
  const group = state.deviceGroups.find(g => getId(g) === id);
  if (!confirm(`"${group?.name}" grubunu silmek istediğinize emin misiniz?`)) return;

  try {
    const response = await authFetch(`${API_BASE_URL}/api/device-groups/${id}`, { method: 'DELETE' });
    if (response.ok) {
      await refreshAllData();
      showToast('Grup silindi', 'success');
    } else {
      throw new Error('Failed to delete group');
    }
  } catch (error) {
    console.error('Error deleting group:', error);
    showToast('Grup silinemedi', 'error');
  }
}

// ============================================
// Search Functions
// ============================================
function handleLandingPageSearch(e) {
  renderLandingPages(e.target.value);
}

// ============================================
// Utility Functions
// ============================================
function updateDurationDisplay() {
  const value = parseInt(elements.transitionDuration?.value) || 8000;
  if (elements.durationDisplay) {
    elements.durationDisplay.textContent = `${(value / 1000).toFixed(0)} saniye`;
  }
}

function updateApiEndpoint() {
  if (elements.apiEndpoint) {
    elements.apiEndpoint.textContent = `${API_BASE_URL}/api`;
  }
}

function animateValue(element, value) {
  if (!element) return;
  const target = Number(value);
  const end = Number.isFinite(target) ? target : 0;
  const current = parseInt(String(element.textContent).replace(/[^\d-]/g, ''), 10) || 0;
  if (current === end) {
    element.textContent = String(end);
    return;
  }

  const diff = end - current;
  const duration = 400;
  const steps = 16;
  const increment = diff / steps;
  let step = 0;

  const timer = setInterval(() => {
    step++;
    element.textContent = String(Math.round(current + (increment * step)));
    if (step >= steps) {
      clearInterval(timer);
      element.textContent = String(end);
    }
  }, duration / steps);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Şimdi';
  if (minutes < 60) return `${minutes} dakika önce`;
  if (hours < 24) return `${hours} saat önce`;
  if (days < 7) return `${days} gün önce`;
  
  return date.toLocaleDateString('tr-TR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function getStatusText(status) {
  const texts = {
    online: 'Çevrimiçi',
    idle: 'Boşta',
    offline: 'Çevrimdışı'
  };
  return texts[status] || status;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: 'ph-check-circle',
    error: 'ph-x-circle',
    warning: 'ph-warning'
  };
  
  toast.innerHTML = `
    <i class="ph-fill ${icons[type]} toast-icon"></i>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">
      <i class="ph ph-x"></i>
    </button>
  `;
  
  elements.toastContainer?.appendChild(toast);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// ============================================
// Unit Ads (venue sheet → Images + AdStart / AdEnd / AdActive)
// ============================================
function parseImageUrls(str) {
  if (!str || typeof str !== 'string') return [];
  const s = String(str).trim();
  if (!s) return [];

  let parts = s.split(/[|\n\r]+/).map(x => x.trim()).filter(Boolean);
  if (parts.length <= 1 && s.includes(',')) {
    const comma = s.split(',').map(x => x.trim()).filter(Boolean);
    if (comma.length > 1) parts = comma;
  }
  if (parts.length === 1) {
    const blob = parts[0];
    const multi = blob.split(/(?=https?:\/\/)/i).map(x => x.trim()).filter(Boolean);
    if (multi.length > 1) parts = multi;
    else {
      const matches = blob.match(/https?:\/\/[^\s]+/gi);
      if (matches && matches.length > 1) parts = matches;
    }
  }
  return parts;
}

// ============================================
// Global venue picker (sidebar)
// ============================================
function setActiveVenueId(id, { silent = false } = {}) {
  const normalized = id ? String(id) : null;
  if (!normalized) return;
  const prev = getActiveVenueId();
  state.activeVenueId = normalized;
  state.selectedVenueId = normalized;
  localStorage.setItem(ACTIVE_VENUE_KEY, normalized);
  updateVenuePickerTrigger();
  if (!silent && normalized !== prev) onActiveVenueChanged();
}

function resolveActiveVenueId(preferId) {
  const venues = state.venues || [];
  if (!venues.length) return null;
  const candidates = [preferId, state.activeVenueId, localStorage.getItem(ACTIVE_VENUE_KEY)]
    .filter(Boolean)
    .map(String);
  for (const id of candidates) {
    if (venues.some(v => getId(v) === id)) return id;
  }
  return getId(venues[0]);
}

function refreshVenuePickerUI({ preferId, silent = true } = {}) {
  const picker = document.getElementById('globalVenuePicker');
  if (!picker) return;

  if (!state.venues?.length) {
    picker.style.display = 'none';
    return;
  }

  picker.style.display = '';
  const id = resolveActiveVenueId(preferId);
  if (!id) return;

  const trigger = document.getElementById('venuePickerTrigger');
  if (state.venues.length === 1) trigger?.setAttribute('disabled', 'disabled');
  else trigger?.removeAttribute('disabled');

  setActiveVenueId(id, { silent });

  const panel = document.getElementById('venuePickerPanel');
  if (panel && !panel.hidden) {
    const search = document.getElementById('venuePickerSearch');
    renderVenuePickerList(search?.value || '');
  }
}

function updateVenuePickerTrigger() {
  const nameEl = document.getElementById('venuePickerName');
  const venue = getActiveVenue();
  if (nameEl) nameEl.textContent = venue?.name || 'Mekan seçin';
}

function renderVenuePickerList(filter = '') {
  const list = document.getElementById('venuePickerList');
  if (!list) return;
  const q = filter.trim().toLocaleLowerCase('tr');
  const items = state.venues.filter(v =>
    !q || (v.name || '').toLocaleLowerCase('tr').includes(q)
  );
  const activeId = getActiveVenueId();
  if (!items.length) {
    list.innerHTML = '<li class="venue-picker__empty">Sonuç yok</li>';
    return;
  }
  list.innerHTML = items.map(v => {
    const id = getId(v);
    const active = id === activeId ? ' is-active' : '';
    return `<li><button type="button" class="venue-picker__item${active}" data-venue-id="${escapeHtml(id)}" role="option">${escapeHtml(v.name)}</button></li>`;
  }).join('');
  list.querySelectorAll('[data-venue-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeVenuePicker();
      if (btn.dataset.venueId !== activeId) setActiveVenueId(btn.dataset.venueId);
    });
  });
}

function openVenuePicker() {
  const panel = document.getElementById('venuePickerPanel');
  const trigger = document.getElementById('venuePickerTrigger');
  const search = document.getElementById('venuePickerSearch');
  if (!panel || !trigger) return;
  panel.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  renderVenuePickerList(search?.value || '');
  search?.focus();
}

function closeVenuePicker() {
  const panel = document.getElementById('venuePickerPanel');
  const trigger = document.getElementById('venuePickerTrigger');
  if (panel) panel.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  const search = document.getElementById('venuePickerSearch');
  if (search) search.value = '';
}

function wireVenuePicker() {
  const trigger = document.getElementById('venuePickerTrigger');
  const search = document.getElementById('venuePickerSearch');
  const picker = document.getElementById('globalVenuePicker');

  trigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('venuePickerPanel');
    if (panel?.hidden) openVenuePicker();
    else closeVenuePicker();
  });

  search?.addEventListener('input', () => renderVenuePickerList(search.value));

  document.addEventListener('click', (e) => {
    if (!picker?.contains(e.target)) closeVenuePicker();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeVenuePicker();
  });
}

let venuePickerWired = false;

async function initGlobalVenuePicker() {
  const picker = document.getElementById('globalVenuePicker');
  if (!picker) return;
  try {
    await loadVenuesList();
  } catch {
    picker.style.display = 'none';
    return;
  }
  if (!venuePickerWired) {
    wireVenuePicker();
    venuePickerWired = true;
  }
  refreshVenuePickerUI({ silent: true });
}

async function reloadVenues({ preferId, silent = false } = {}) {
  await loadVenuesList();
  refreshVenuePickerUI({ preferId, silent });
}

async function onActiveVenueChanged() {
  applyRoleUI({ navigateIfNeeded: true });
  state.deviceView = 'venue';
  document.querySelectorAll('[data-device-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.deviceView === 'venue');
  });
  document.querySelector('.filter-group')?.classList.remove('is-hidden');
  await refreshAllData();
  const page = state.currentPage;
  if (page === 'unit-ads') await loadUnitAdsPage();
  if (page === 'venue-manager') embedVenueManager(getActiveVenueId());
  updatePageBreadcrumbVenue();
}

function updatePageBreadcrumbVenue() {
  const venue = getActiveVenue();
  if (!venue || !elements.pageBreadcrumb) return;
  const base = elements.pageBreadcrumb.textContent.split(' · ')[0];
  elements.pageBreadcrumb.textContent = `${base} · ${venue.name}`;
}

async function loadVenueUnits(venueId) {
  const res = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/units`);
  if (!res.ok) throw new Error('Units load failed');
  const data = await res.json();
  state.venueUnits = data.units || [];
  return state.venueUnits;
}

function formatScheduleLabel(s) {
  if (!s?.startDate) return 'Zamanlama yok';
  const fmt = (d) => d ? d.split('-').reverse().join('.') : '';
  let label = `${fmt(s.startDate)} – ${fmt(s.endDate)}`;
  if ((s.startTime && s.startTime !== '00:00') || (s.endTime && s.endTime !== '23:59')) {
    label += ` · ${s.startTime}–${s.endTime}`;
  }
  return label;
}

function renderUnitAdsList() {
  const list = document.getElementById('unitAdsList');
  const empty = document.getElementById('unitAdsEmpty');
  if (!list) return;

  const q = (document.getElementById('unitAdSearch')?.value || '').trim().toLowerCase();
  let units = state.venueUnits.filter(u =>
    !q || (u.title || '').toLowerCase().includes(q) || String(u.id).toLowerCase().includes(q)
  );
  if (state.unitAdFilter === 'active') units = units.filter(u => u.adActive);
  if (state.unitAdFilter === 'scheduled') units = units.filter(u => u.adSchedule);

  if (!units.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = units.map(u => {
    // Üst bant her zaman logoya ait — reklam görseli logoyu ezmez,
    // köşede küçük bir önizleme olarak durur.
    const logo = u.logo
      ? `<img class="ua-logo" src="${escapeHtml(u.logo)}" alt="" loading="lazy">`
      : '<i class="ph ph-storefront"></i>';
    const adThumb = u.images?.[0]
      ? `<span class="ua-ad-thumb" title="${u.images.length > 1 ? u.images.length + ' reklam görseli' : 'Reklam görseli'}"><img src="${escapeHtml(u.images[0])}" alt="" loading="lazy">${u.images.length > 1 ? `<span class="ua-ad-thumb-count">+${u.images.length - 1}</span>` : ''}</span>`
      : '';
    const badge = u.adActive
      ? '<span class="ua-badge on"><i class="ph-fill ph-circle"></i>Yayında</span>'
      : (u.adSchedule
        ? (u.adSchedule.enabled === false
          ? '<span class="ua-badge off"><i class="ph ph-pause"></i>Durduruldu</span>'
          : '<span class="ua-badge wait"><i class="ph ph-clock"></i>Zamanlı</span>')
        : '');
    return `<div class="ua-card" data-unit-id="${escapeHtml(u.id)}">
      <div class="ua-card-media">${logo}${badge}${adThumb}</div>
      <div class="ua-card-body">
        <div class="ua-card-title">${escapeHtml(u.title || u.id)}</div>
        <div class="ua-card-sub">${escapeHtml(u.id)}${u.floor ? ' · Kat ' + escapeHtml(u.floor) : ''}</div>
        <div class="ua-card-sched"><i class="ph ph-calendar-blank"></i>${escapeHtml(formatScheduleLabel(u.adSchedule))}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.ua-card').forEach(card => {
    card.addEventListener('click', () => openUnitAdModal(card.dataset.unitId));
  });
}

function updateUnitAdPreview() {
  const preview = document.getElementById('unitAdPreview');
  const input = document.getElementById('unitAdImages');
  if (!preview) return;
  const urls = parseImageUrls(input?.value || '');
  preview.classList.toggle('has-many', urls.length > 1);
  if (!urls.length) {
    preview.innerHTML = '<div class="ua-modal-preview-empty"><i class="ph ph-image"></i><span>Görsel önizleme</span></div>';
    return;
  }
  const err = '<div class=\'ua-modal-preview-empty\'><i class=\'ph ph-warning\'></i><span>Yüklenemedi</span></div>';
  preview.innerHTML = urls.map((url, i) =>
    `<img src="${escapeHtml(url)}" alt="" class="${urls.length > 1 ? 'ua-preview-thumb' : ''}" data-idx="${i}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ua-preview-thumb ua-preview-thumb--err',innerHTML:'<i class=\\'ph ph-warning\\'></i>'}))">`
  ).join('');
}

function updateUnitAdEnabledLabel() {
  const on = document.getElementById('unitAdEnabled')?.checked;
  const label = document.getElementById('unitAdEnabledLabel');
  if (label) label.textContent = on ? 'Aktif — planlanan aralıkta yayınlanır' : 'Duraklatıldı';
}

function openUnitAdModal(unitId) {
  const unit = state.venueUnits.find(u => String(u.id) === String(unitId));
  if (!unit) return;
  state.selectedUnitId = unitId;

  document.getElementById('unitAdModalTitle').textContent = unit.title || unit.id;
  document.getElementById('unitAdModalSub').textContent =
    `${unit.id}${unit.floor ? ' · Kat ' + unit.floor : ''}`;
  const logoEl = document.getElementById('unitAdLogo');
  if (logoEl) {
    logoEl.innerHTML = unit.logo
      ? `<img src="${escapeHtml(unit.logo)}" alt="">`
      : '<i class="ph ph-storefront"></i>';
  }

  document.getElementById('unitAdUnitId').value = unit.id;
  document.getElementById('unitAdImages').value = (unit.images || []).join('\n');
  const s = unit.adSchedule || {};
  document.getElementById('unitAdStartDate').value = s.startDate || '';
  document.getElementById('unitAdEndDate').value = s.endDate || '';
  document.getElementById('unitAdStartTime').value = s.startTime || '00:00';
  document.getElementById('unitAdEndTime').value = s.endTime || '23:59';
  document.getElementById('unitAdEnabled').checked = s.enabled !== false;
  updateUnitAdEnabledLabel();
  updateUnitAdPreview();
  document.getElementById('unitAdModal').classList.add('show');
}

function closeUnitAdModal() {
  document.getElementById('unitAdModal').classList.remove('show');
}

async function loadUnitAdsPage() {
  try {
    const venueId = getActiveVenueId();
    if (!venueId) { showToast('Önce bir mekan seçin', 'warning'); return; }
    await loadVenueUnits(venueId);
    renderUnitAdsList();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Birim reklamları yüklenemedi', 'error');
  }
}

async function saveUnitAd(e) {
  e.preventDefault();
  const venueId = getActiveVenueId();
  const unitId = document.getElementById('unitAdUnitId').value;
  if (!venueId || !unitId) return;
  const urls = parseImageUrls(document.getElementById('unitAdImages').value);
  document.getElementById('unitAdImages').value = urls.join('\n');
  const body = {
    images: urls,
    adStartDate: document.getElementById('unitAdStartDate').value,
    adEndDate: document.getElementById('unitAdEndDate').value,
    adStartTime: document.getElementById('unitAdStartTime').value,
    adEndTime: document.getElementById('unitAdEndTime').value,
    adEnabled: document.getElementById('unitAdEnabled').checked
  };
  try {
    const res = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/units/${encodeURIComponent(unitId)}/ad`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Kayıt başarısız');
    if (data.writtenToSheet) {
      showToast('Reklam kaydedildi', 'success');
    } else {
      showToast('Venue için yazma servisi tanımlı değil — değişiklik kalıcı olmadı', 'warning');
    }
    closeUnitAdModal();
    await loadVenueUnits(venueId);
    renderUnitAdsList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function initUnitAdsPage() {
  document.getElementById('unitAdSearch')?.addEventListener('input', () => renderUnitAdsList());
  document.getElementById('refreshUnitAdsBtn')?.addEventListener('click', () => loadUnitAdsPage());
  document.getElementById('unitAdForm')?.addEventListener('submit', saveUnitAd);
  document.getElementById('unitAdImages')?.addEventListener('input', updateUnitAdPreview);
  document.getElementById('unitAdEnabled')?.addEventListener('change', updateUnitAdEnabledLabel);
  document.getElementById('closeUnitAdModal')?.addEventListener('click', closeUnitAdModal);
  document.getElementById('cancelUnitAdBtn')?.addEventListener('click', closeUnitAdModal);
  document.getElementById('unitAdModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'unitAdModal') closeUnitAdModal();
  });
  document.querySelectorAll('.ua-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ua-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.unitAdFilter = btn.dataset.filter;
      renderUnitAdsList();
    });
  });
}

function initVenueManagerPage() {
  /* Venue seçimi iframe içindeki topbar'da */
}

async function loadVenueManagerPage() {
  try {
    const venueId = getActiveVenueId();
    if (!venueId) { showToast('Önce bir mekan seçin', 'warning'); return; }
    embedVenueManager(venueId);
  } catch (e) {
    showToast(e.message || 'Birim yönetimi yüklenemedi', 'error');
  }
}

function embedVenueManager(venueId) {
  const frame = document.getElementById('venueManagerFrame');
  if (!frame || !venueId) return;
  const token = encodeURIComponent(getToken());
  const venue = encodeURIComponent(venueId);
  const theme = encodeURIComponent(
    document.documentElement.getAttribute('data-theme')
      || localStorage.getItem('inmapper-theme')
      || 'dark'
  );
  frame.src = `/venue-manager/index.html?venue=${venue}&token=${token}&theme=${theme}`;
}

// ============================================
// Customers (admin)
// ============================================
async function loadTenantsPage() {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/auth/tenants`);
    if (!res.ok) throw new Error('Müşteri listesi yüklenemedi');
    const data = await res.json();
    state.tenants = data.tenants || [];
    state.unassignedVenues = data.unassignedVenues || [];
    tenantUsersIndex = data.users || [];
    renderTenantsList();
  } catch (e) {
    console.error(e);
    showToast(e.message, 'error');
  }
}

function permissionSummary(permissions = []) {
  if (!permissions.length) return 'İzin yok';
  if (permissions.length === ALL_TENANT_PERMS.length) return 'Tüm izinler';
  return permissions.map(p => FEATURE_LABELS_UI[p] || p).join(', ');
}

function findIndexedUser(userId) {
  return tenantUsersIndex.find(u => String(u.id) === String(userId))
    || state.tenants.flatMap(t => t.users || []).find(u => String(u.id) === String(userId))
    || null;
}

function renderExistingUserDirectory(tenantId) {
  const available = tenantUsersIndex.filter(user =>
    !(user.memberships || []).some(m => String(m.tenantId) === String(tenantId))
  );
  const rows = available.map(user => `
    <div class="tenant-user-directory__row">
      <span class="tenant-user-directory__identity">
        <i class="ph ph-user-circle"></i>
        <span>
          <strong>${escapeHtml(user.name || user.email)}</strong>
          <small>${escapeHtml(user.email)}${user.isActive === false ? ' · Pasif' : ''}</small>
        </span>
      </span>
      <button type="button" class="btn btn-secondary btn-sm"
              onclick="openTenantUserModal('${tenantId}', '${user.id}')">
        <i class="ph ph-user-plus"></i><span>Ata</span>
      </button>
    </div>
  `).join('');

  return `
    <details class="tenant-user-directory">
      <summary>
        <span><i class="ph ph-users-three"></i> Sistemde kayıtlı kullanıcı ata</span>
        <small>${available.length}</small>
      </summary>
      <div class="tenant-user-directory__list">
        ${rows || '<span class="tenant-empty-hint">Atanabilecek başka kullanıcı yok.</span>'}
      </div>
    </details>
  `;
}

function renderTenantsList() {
  const list = document.getElementById('tenantsList');
  const empty = document.getElementById('tenantsEmpty');
  if (!list) return;

  const q = (document.getElementById('tenantSearch')?.value || '').trim().toLowerCase();
  const tenants = state.tenants.filter(t => {
    if (!q) return true;
    if (t.name.toLowerCase().includes(q) || (t.slug || '').toLowerCase().includes(q)) return true;
    return (t.users || []).some(u =>
      (u.email || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)
    );
  });

  if (!tenants.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = tenants.map(t => {
    const tid = getId(t);
    const users = (t.users || []).map(u => `
      <div class="tenant-user-chip" title="${escapeHtml(permissionSummary(u.permissions))}">
        <i class="ph ph-user"></i>
        <span>${escapeHtml(u.name || u.email)}</span>
        <span class="tenant-user-chip__actions">
          <button type="button" class="tenant-chip-x" onclick="openTenantUserModal('${tid}', '${getId(u)}')" title="Düzenle"><i class="ph ph-pencil-simple"></i></button>
          <button type="button" class="tenant-chip-x" onclick="removeUserFromTenant('${getId(u)}', '${tid}')" title="Bu müşteriden kaldır"><i class="ph ph-x"></i></button>
        </span>
      </div>`).join('') || '<span class="tenant-empty-hint">Henüz kullanıcı eklenmedi</span>';
    const venues = (t.venues || []).map(v => `
      <div class="tenant-chip venue">
        <i class="ph ph-map-pin"></i>
        <span>${escapeHtml(v.name)}</span>
        <button class="tenant-chip-x" onclick="unassignVenue('${getId(v)}')" title="Erişimi kaldır"><i class="ph ph-x"></i></button>
      </div>`).join('') || '<span class="tenant-empty-hint">Henüz mekan erişimi yok</span>';
    const assignOptions = state.unassignedVenues.map(v =>
      `<option value="${getId(v)}">${escapeHtml(v.name)}</option>`).join('');
    return `<div class="card tenant-card">
      <div class="tenant-card-head">
        <div class="tenant-identity">
          <div class="tenant-avatar">${escapeHtml((t.name.trim()[0] || '?').toUpperCase())}</div>
          <div>
            <h3 class="tenant-name">${escapeHtml(t.name)}</h3>
            <span class="tenant-slug">${escapeHtml(t.slug)}</span>
          </div>
        </div>
        <div class="tenant-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="openTenantUserModal('${tid}')"><i class="ph ph-user-plus"></i><span>Kullanıcı</span></button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteTenant('${tid}')" title="Müşteriyi sil"><i class="ph ph-trash"></i></button>
        </div>
      </div>
      <div class="tenant-section">
        <span class="tenant-section-title">Kullanıcılar</span>
        <div class="tenant-chips">${users}</div>
      </div>
      <div class="tenant-section">
        <span class="tenant-section-title">Mekan Erişimi</span>
        <div class="tenant-chips">${venues}</div>
        ${assignOptions ? `
        <div class="tenant-assign">
          <div class="tenant-assign-select">
            <i class="ph ph-map-pin"></i>
            <select id="assignVenueSel-${tid}">${assignOptions}</select>
            <i class="ph ph-caret-down tenant-assign-caret"></i>
          </div>
          <button class="btn btn-primary btn-sm" onclick="assignVenue('${tid}')"><i class="ph ph-plus"></i><span>Erişim Ver</span></button>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function deleteTenant(tenantId) {
  if (!confirm('Müşteri silinecek. Ortak kullanıcı hesapları korunur; yalnız bu müşteri üyeliği kaldırılır. Emin misiniz?')) return;
  try {
    const res = await authFetch(`${API_BASE_URL}/api/auth/tenants/${tenantId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Silme başarısız');
    showToast('Müşteri silindi', 'success');
    loadTenantsPage();
  } catch (e) { showToast(e.message, 'error'); }
}

async function removeUserFromTenant(userId, tenantId) {
  const user = findIndexedUser(userId);
  const tenant = state.tenants.find(t => getId(t) === String(tenantId));
  const label = user?.email || 'kullanıcı';
  const tenantName = tenant?.name || 'müşteri';
  if (!confirm(`"${label}" kullanıcısı "${tenantName}" müşterisinden kaldırılsın mı?`)) return;
  try {
    const res = await authFetch(`${API_BASE_URL}/api/auth/users/${userId}/memberships/${tenantId}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Üyelik kaldırılamadı');
    showToast('Müşteri erişimi kaldırıldı', 'success');
    loadTenantsPage();
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteUserAccount(userId) {
  if (!confirm('Kullanıcı hesabı tüm müşteri üyelikleriyle birlikte silinecek. Emin misiniz?')) return;
  try {
    const res = await authFetch(`${API_BASE_URL}/api/auth/users/${userId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Silme başarısız');
    showToast('Kullanıcı hesabı silindi', 'success');
    closeTenantUserModal();
    loadTenantsPage();
  } catch (e) { showToast(e.message, 'error'); }
}

async function assignVenue(tenantId) {
  const sel = document.getElementById(`assignVenueSel-${tenantId}`);
  if (!sel?.value) return;
  try {
    const res = await authFetch(`${API_BASE_URL}/api/auth/venues/${sel.value}/tenant`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId })
    });
    if (!res.ok) throw new Error('Atama başarısız');
    showToast('Mekan erişimi verildi', 'success');
    loadTenantsPage();
  } catch (e) { showToast(e.message, 'error'); }
}

async function unassignVenue(venueId) {
  try {
    const res = await authFetch(`${API_BASE_URL}/api/auth/venues/${venueId}/tenant`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: null })
    });
    if (!res.ok) throw new Error('İşlem başarısız');
    showToast('Mekan erişimi kaldırıldı', 'success');
    loadTenantsPage();
  } catch (e) { showToast(e.message, 'error'); }
}

function renderTenantUserMemberships() {
  const host = document.getElementById('tenantUserMemberships');
  if (!host) return;
  if (!state.tenants.length) {
    host.innerHTML = '<div class="tenant-empty-hint">Önce bir müşteri oluşturun.</div>';
    return;
  }
  host.innerHTML = state.tenants.map(tenant => {
    const tid = getId(tenant);
    const draft = tenantUserMembershipDraft.find(m => m.tenantId === tid);
    const assigned = !!draft;
    const open = assigned;
    const perms = draft?.permissions || [PERMS.UNIT_ADS];
    return `
      <div class="tenant-membership-row ${assigned ? 'is-assigned' : ''} ${open ? 'is-open' : ''}" data-membership-tenant="${tid}">
        <label class="tenant-membership-row__head">
          <input type="checkbox" data-membership-assign ${assigned ? 'checked' : ''}>
          <strong>${escapeHtml(tenant.name)}</strong>
          <small>${assigned ? permissionSummary(perms) : 'Atanmadı'}</small>
        </label>
        <div class="tenant-membership-row__body">
          <div class="perm-checkboxes">
            ${ALL_TENANT_PERMS.map(perm => `
              <label>
                <input type="checkbox" data-membership-perm="${perm}" ${perms.includes(perm) ? 'checked' : ''}>
                ${FEATURE_LABELS_UI[perm]}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function syncTenantUserMembershipDraftFromDom() {
  const next = [];
  document.querySelectorAll('[data-membership-tenant]').forEach(row => {
    const tid = row.dataset.membershipTenant;
    const assigned = row.querySelector('[data-membership-assign]')?.checked;
    if (!assigned) return;
    const permissions = [...row.querySelectorAll('[data-membership-perm]:checked')]
      .map(el => el.dataset.membershipPerm);
    next.push({
      tenantId: tid,
      permissions: permissions.length ? permissions : [PERMS.UNIT_ADS],
    });
  });
  tenantUserMembershipDraft = next;
}

function openTenantUserModal(focusTenantId, userId = null) {
  const isEdit = !!userId;
  const user = isEdit ? findIndexedUser(userId) : null;
  document.getElementById('tenantUserId').value = userId || '';
  document.getElementById('tenantUserFocusTenantId').value = focusTenantId || '';
  document.getElementById('tenantUserModalTitle').textContent = isEdit ? 'Kullanıcıyı Düzenle' : 'Kullanıcı Ekle';
  document.getElementById('tenantUserSubmitBtn').querySelector('span').textContent = isEdit ? 'Kaydet' : 'Ekle';
  document.getElementById('tenantUserName').value = user?.name || '';
  document.getElementById('tenantUserEmail').value = user?.email || '';
  document.getElementById('tenantUserPassword').value = '';
  document.getElementById('tenantUserPassword').required = !isEdit;
  document.getElementById('tenantUserPasswordHint').textContent = isEdit
    ? '(değiştirmek için doldurun)'
    : '(zorunlu)';
  document.getElementById('tenantUserDanger').hidden = !isEdit;
  document.getElementById('tenantUserEmail').readOnly = isEdit;
  const existingDirectory = document.getElementById('tenantExistingUserDirectory');
  if (existingDirectory) {
    existingDirectory.hidden = isEdit;
    existingDirectory.innerHTML = isEdit ? '' : renderExistingUserDirectory(focusTenantId);
  }

  if (user) {
    tenantUserMembershipDraft = (user.memberships || []).map(m => ({
      tenantId: String(m.tenantId),
      permissions: [...(m.permissions || [])],
    }));
    if (focusTenantId && !tenantUserMembershipDraft.some(m => m.tenantId === String(focusTenantId))) {
      const cardUser = state.tenants
        .find(t => getId(t) === String(focusTenantId))
        ?.users?.find(u => getId(u) === String(userId));
      tenantUserMembershipDraft.push({
        tenantId: String(focusTenantId),
        permissions: cardUser?.permissions?.length ? [...cardUser.permissions] : [PERMS.UNIT_ADS],
      });
    }
  } else {
    tenantUserMembershipDraft = focusTenantId
      ? [{ tenantId: String(focusTenantId), permissions: [PERMS.UNIT_ADS] }]
      : [];
  }

  renderTenantUserMemberships();
  document.getElementById('tenantUserModal').classList.add('show');
}

function closeTenantUserModal() {
  document.getElementById('tenantUserModal')?.classList.remove('show');
  tenantUserMembershipDraft = [];
  document.getElementById('tenantUserForm')?.reset();
  document.getElementById('tenantUserId').value = '';
  document.getElementById('tenantUserEmail').readOnly = false;
}

async function handleTenantUserSubmit(e) {
  e.preventDefault();
  syncTenantUserMembershipDraftFromDom();
  if (!tenantUserMembershipDraft.length) {
    showToast('En az bir müşteri seçilmeli', 'error');
    return;
  }
  for (const m of tenantUserMembershipDraft) {
    if (!m.permissions?.length) {
      showToast('Atanan her müşteri için en az bir izin seçin', 'error');
      return;
    }
  }

  const userId = document.getElementById('tenantUserId').value;
  const payload = {
    name: document.getElementById('tenantUserName').value,
    email: document.getElementById('tenantUserEmail').value,
    memberships: tenantUserMembershipDraft,
  };
  const password = document.getElementById('tenantUserPassword').value;
  if (password) payload.password = password;
  if (!userId && !password) {
    showToast('Yeni kullanıcı için şifre gerekli', 'error');
    return;
  }

  try {
    const res = await authFetch(
      userId ? `${API_BASE_URL}/api/auth/users/${userId}` : `${API_BASE_URL}/api/auth/users`,
      {
        method: userId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Kayıt başarısız');
    closeTenantUserModal();
    const successMessage = userId ? 'Kullanıcı güncellendi' : 'Kullanıcı kaydedildi';
    showToast(successMessage, 'success');
    loadTenantsPage();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadVenuesPage() {
  try {
    await loadVenuesList();
    renderVenueMapManagement();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'Mekan listesi yüklenemedi', 'error');
  }
}

function venueMapSummary(venue) {
  const map = venue?.geojson || {};
  const configured = Boolean(map.storageKey || venue?.geojsonPath);
  const cfg = venue?.mapConfig || {};
  return {
    configured,
    sourceType: map.sourceType || (venue?.geojsonPath ? 'legacy' : ''),
    sourceUrl: map.sourceUrl || '',
    originalFileName: map.originalFileName || '',
    featureCount: map.featureCount || 0,
    roomCount: map.roomCount || 0,
    floors: map.floors || [],
    sizeBytes: map.sizeBytes || 0,
    updatedAt: map.updatedAt || null,
    config: {
      configured: Boolean(cfg.map && typeof cfg.map === 'object'),
      originalFileName: cfg.originalFileName || '',
      updatedAt: cfg.updatedAt || null,
    },
  };
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_UNIT_ATTRIBUTES = [
  { key: 'Title', label: 'Başlık', type: 'text', required: true, visible: true, editable: true },
  { key: 'Subtitle', label: 'Alt başlık', type: 'text', visible: true, editable: true },
  { key: 'Category', label: 'Kategori', type: 'categories', visible: true, editable: true },
  { key: 'Floor', label: 'Kat', type: 'floor', visible: true, editable: true },
  { key: 'Telephone', label: 'Telefon', type: 'tel', visible: true, editable: true, altKeys: ['Phone'] },
  { key: 'Web', label: 'Web sitesi', type: 'url', visible: true, editable: true },
  { key: 'Hours', label: 'Çalışma saatleri', type: 'textarea', visible: true, editable: true, rows: 3 },
  { key: 'Description', label: 'Açıklama', type: 'textarea', visible: true, editable: true, rows: 4 },
  { key: 'Logo', label: 'Logo bağlantısı', type: 'url', visible: true, editable: true },
];
const UNIT_ATTRIBUTE_TYPES = [
  ['text', 'Kısa metin'], ['textarea', 'Uzun metin'], ['tel', 'Telefon'],
  ['url', 'URL'], ['email', 'E-posta'], ['number', 'Sayı'],
  ['floor', 'Kat seçimi'], ['categories', 'Kategori seçimi'],
];
let unitSchemaDraft = [];

function cloneDefaultUnitAttributes() {
  return DEFAULT_UNIT_ATTRIBUTES.map((field, order) => ({ ...field, order }));
}

function renderUnitSchemaEditor() {
  const host = document.getElementById('unitSchemaList');
  if (!host) return;
  if (!unitSchemaDraft.length) {
    host.innerHTML = '<div class="unit-schema-empty">Alan bulunmuyor. “Alan Ekle” ile bir kolon tanımlayın.</div>';
    return;
  }
  host.innerHTML = unitSchemaDraft.map((field, index) => `
    <div class="unit-schema-row" data-unit-field="${index}">
      <div class="unit-schema-order">
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-schema-move="-1" ${index === 0 ? 'disabled' : ''} title="Yukarı"><i class="ph ph-caret-up"></i></button>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-schema-move="1" ${index === unitSchemaDraft.length - 1 ? 'disabled' : ''} title="Aşağı"><i class="ph ph-caret-down"></i></button>
      </div>
      <div class="unit-schema-main">
        <label>Kolon anahtarı
          <input class="form-input" data-schema-prop="key" value="${escapeHtml(field.key)}"
                 placeholder="Örn: InstagramUrl" ${field.custom ? '' : 'readonly'}>
        </label>
        <label>Görünen ad
          <input class="form-input" data-schema-prop="label" value="${escapeHtml(field.label)}" placeholder="Örn: Instagram">
        </label>
        <label>Alan tipi
          <select class="form-input" data-schema-prop="type">
            ${UNIT_ATTRIBUTE_TYPES.map(([value, label]) =>
              `<option value="${value}" ${field.type === value ? 'selected' : ''}>${label}</option>`
            ).join('')}
          </select>
        </label>
      </div>
      <div class="unit-schema-flags">
        <label><input type="checkbox" data-schema-prop="visible" ${field.visible !== false ? 'checked' : ''}> Görünür</label>
        <label><input type="checkbox" data-schema-prop="editable" ${field.editable !== false ? 'checked' : ''}> Düzenlenebilir</label>
        <label><input type="checkbox" data-schema-prop="required" ${field.required ? 'checked' : ''}> Zorunlu</label>
      </div>
      <button type="button" class="btn btn-ghost btn-icon btn-sm unit-schema-delete" data-schema-delete title="Alanı kaldır">
        <i class="ph ph-trash"></i>
      </button>
    </div>
  `).join('');
}

function openUnitSchemaModal(venueId) {
  const venue = state.venues.find(item => getId(item) === String(venueId));
  if (!venue) return;
  const configured = Array.isArray(venue.unitAttributes) && venue.unitAttributes.length
    ? venue.unitAttributes
    : cloneDefaultUnitAttributes();
  unitSchemaDraft = configured.map((field, order) => ({
    ...field,
    order,
    visible: field.visible !== false,
    editable: field.editable !== false,
  }));
  document.getElementById('unitSchemaVenueId').value = venueId;
  document.getElementById('unitSchemaModalTitle').textContent = `${venue.name} Birim Alanları`;
  document.getElementById('unitSchemaChangesTab').value = venue.sheets?.tabs?.changes || '';
  document.getElementById('unitStatusEditable').checked = venue.unitStatusEditable !== false;
  renderUnitSchemaEditor();
  document.getElementById('unitSchemaModal').classList.add('show');
}

function closeUnitSchemaModal() {
  document.getElementById('unitSchemaModal')?.classList.remove('show');
  unitSchemaDraft = [];
}

async function handleUnitSchemaSubmit(event) {
  event.preventDefault();
  const venueId = document.getElementById('unitSchemaVenueId').value;
  const fields = unitSchemaDraft.map((field, order) => ({ ...field, order }));
  try {
    const response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/unit-schema`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields,
        changesTab: document.getElementById('unitSchemaChangesTab').value.trim(),
        statusEditable: document.getElementById('unitStatusEditable').checked,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Birim alanları kaydedilemedi');
    await loadVenuesList();
    renderVenueMapManagement();
    closeUnitSchemaModal();
    showToast('Birim alanları ve günlük ayarı kaydedildi', 'success');
  } catch (err) {
    showToast(err.message || 'Birim alanları kaydedilemedi', 'error');
  }
}

function renderVenueMapManagement() {
  const host = document.getElementById('venueMapManagementList');
  if (!host) return;
  if (!state.venues.length) {
    host.innerHTML = '<div class="venue-map-empty">Henüz venue oluşturulmadı.</div>';
    return;
  }

  host.innerHTML = state.venues.map(venue => {
    const id = getId(venue);
    const map = venueMapSummary(venue);
    const source = map.sourceType === 'url'
      ? 'URL'
      : (map.sourceType === 'upload' ? 'Yerel dosya' : 'Mevcut kaynak');
    const details = map.configured
      ? [
          source,
          map.featureCount ? `${map.featureCount} feature` : '',
          map.floors.length ? `${map.floors.length} kat` : '',
          formatFileSize(map.sizeBytes),
          map.config?.configured ? 'config ✓' : 'config eksik',
        ].filter(Boolean).join(' · ')
      : 'Harita eklenmedi';
    return `
      <div class="venue-map-row">
        <div class="venue-map-row__identity">
          <span class="venue-map-row__icon"><i class="ph ph-map-trifold"></i></span>
          <span>
            <strong>${escapeHtml(venue.name)}</strong>
            <small>${escapeHtml(details)}</small>
          </span>
        </div>
        <span class="venue-map-state ${map.configured ? 'is-ready' : 'is-empty'}">
          ${map.configured ? 'Hazır' : 'Eksik'}
        </span>
        <div class="venue-map-row__actions">
          <button class="btn btn-secondary btn-sm" onclick="openUnitSchemaModal('${id}')">
            <i class="ph ph-list-checks"></i><span>Birim Alanları</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openVenueMapModal('${id}')">
            <i class="ph ph-${map.configured ? 'pencil-simple' : 'plus'}"></i>
            <span>${map.configured ? 'Haritayı Yönet' : 'Harita Ekle'}</span>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" onclick="deleteVenue('${id}')" title="Mekanı sil">
            <i class="ph ph-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/** "Zorlu Holding" → "zorlu-holding" */
function slugify(str) {
  const map = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
  return String(str || '')
    .toLowerCase()
    .replace(/[çğıöşü]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Ad alanından kısa adı otomatik doldur; kullanıcı elle değiştirene dek. */
function wireSlugAutofill(nameId, slugId) {
  const nameEl = document.getElementById(nameId);
  const slugEl = document.getElementById(slugId);
  if (!nameEl || !slugEl) return;
  let touched = false;
  slugEl.addEventListener('input', () => { touched = slugEl.value !== ''; });
  nameEl.addEventListener('input', () => {
    if (!touched) slugEl.value = slugify(nameEl.value);
  });
}

function selectedMapSourceType(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || 'upload';
}

function updateMapSourceFields({ radioName, uploadGroupId, urlGroupId }) {
  const type = selectedMapSourceType(radioName);
  const uploadGroup = document.getElementById(uploadGroupId);
  const urlGroup = document.getElementById(urlGroupId);
  if (uploadGroup) uploadGroup.hidden = type !== 'upload';
  if (urlGroup) urlGroup.hidden = type !== 'url';
}

async function persistVenueMap(venueId, { type, file, url, configFile }) {
  if (type === 'none' && !configFile) return null;

  let response;

  if (type === 'url') {
    if (!url?.trim()) throw new Error('GeoJSON URL’si girin');
    if (configFile) {
      const formData = new FormData();
      formData.append('url', url.trim());
      formData.append('config', configFile);
      response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/map/url`, {
        method: 'PUT',
        body: formData,
      });
    } else {
      response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/map/url`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
    }
  } else {
    /* upload veya yalnızca config */
    if (!file && !configFile) throw new Error('GeoJSON veya config.js dosyası seçin');
    const formData = new FormData();
    if (file) formData.append('geojson', file);
    if (configFile) formData.append('config', configFile);
    response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/map/upload`, {
      method: 'POST',
      body: formData,
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Harita kaydedilemedi');
  return data.map;
}

function renderVenueMapStatus(venue) {
  const host = document.getElementById('venueMapStatus');
  const removeButton = document.getElementById('removeVenueMapBtn');
  if (!host) return;
  const map = venueMapSummary(venue);
  removeButton.hidden = !map.configured;
  if (!map.configured) {
    host.innerHTML = `
      <div class="venue-map-status__empty">
        <i class="ph ph-warning-circle"></i>
        <span>Bu venue için henüz harita yok. <strong>Editörde Düzenle</strong> ile açıp kaydedin.${map.config?.configured
          ? ` Config kayıtlı: ${escapeHtml(map.config.originalFileName || 'features.map')}.`
          : ''}</span>
      </div>
    `;
    return;
  }
  const configLine = map.config?.configured
    ? `Config: ${map.config.originalFileName || 'kiosk config yüklü'}`
    : "Config: henüz kaydedilmedi (editörden Venue'ya kaydet)";
  host.innerHTML = `
    <div class="venue-map-status__ready">
      <i class="ph ph-check-circle"></i>
      <span>
        <strong>Harita yayında</strong>
        <small>
          ${map.featureCount || 0} feature · ${map.roomCount || 0} birim geometrisi
          ${map.floors.length ? ` · Katlar: ${map.floors.map(escapeHtml).join(', ')}` : ''}
          ${map.sizeBytes ? ` · ${formatFileSize(map.sizeBytes)}` : ''}
          <br>${escapeHtml(configLine)}
        </small>
      </span>
    </div>
  `;
}

/**
 * Marka logosu bölümünü venue'nun mevcut durumuna göre çizer.
 *
 * Dosya adresi sabit olduğu için (venue slug'ına bağlı) tarayıcı önbelleğini
 * atlamak adına checksum sorgu parametresi ekleniyor; aksi halde yeni yüklenen
 * logo yerine eskisi görünürdü.
 */
function renderVenueLogo(venue) {
  const preview = document.getElementById('venueLogoPreview');
  const meta = document.getElementById('venueLogoMeta');
  const removeButton = document.getElementById('removeVenueLogoBtn');
  if (!preview || !meta) return;

  const logo = venue?.media?.logo;
  const configured = Boolean(logo?.storageKey);
  removeButton.hidden = !configured;

  if (!configured) {
    preview.innerHTML = '<i class="ph ph-image"></i>';
    preview.classList.remove('has-image');
    meta.textContent = 'Logo yüklenmedi';
    return;
  }

  const version = logo.checksum ? `?v=${logo.checksum.slice(0, 12)}` : '';
  const url = `${API_BASE_URL}/api/public/venues/${encodeURIComponent(venue.slug)}/media/logo${version}`;
  preview.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
  preview.classList.add('has-image');
  meta.textContent = [
    logo.originalFileName || 'logo',
    logo.sizeBytes ? formatFileSize(logo.sizeBytes) : '',
    logo.updatedAt ? `güncellendi ${formatRelativeTime(logo.updatedAt)}` : '',
  ].filter(Boolean).join(' · ');
}

async function uploadVenueLogo(file) {
  const venueId = document.getElementById('venueMapVenueId').value;
  if (!venueId || !file) return;

  const formData = new FormData();
  formData.append('logo', file);

  try {
    const response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/media/logo`, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Logo yüklenemedi');

    await loadVenuesPage();
    renderVenueLogo(state.venues.find(item => getId(item) === String(venueId)));
    document.getElementById('venueLogoFile').value = '';
    showToast('Logo yüklendi', 'success');
  } catch (err) {
    showToast(err.message || 'Logo yüklenemedi', 'error');
  }
}

async function removeVenueLogo() {
  const venueId = document.getElementById('venueMapVenueId').value;
  if (!venueId || !confirm('Bu mekanın logosunu kaldırmak istediğinize emin misiniz?')) return;

  try {
    const response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/media/logo`, {
      method: 'DELETE',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Logo kaldırılamadı');

    await loadVenuesPage();
    renderVenueLogo(state.venues.find(item => getId(item) === String(venueId)));
    showToast('Logo kaldırıldı', 'success');
  } catch (err) {
    showToast(err.message || 'Logo kaldırılamadı', 'error');
  }
}

let appConfigCache = null;

/** Panelin dışa açık adresleri; oturum başına bir kez okunur. */
async function ensureAppConfig() {
  if (appConfigCache) return appConfigCache;
  const res = await fetch(`${API_BASE_URL}/api/public/app-config`);
  if (!res.ok) throw new Error('Uygulama ayarları okunamadı');
  appConfigCache = await res.json();
  return appConfigCache;
}

/**
 * Harita editörünü bu venue'ya bağlı olarak açar.
 *
 * Token URL fragment'ında gider: fragment sunucuya iletilmediği için erişim
 * anahtarı kiosk web servisinin erişim kayıtlarına düşmez. Editör onu okur
 * okumaz adres çubuğunu temizler.
 */
async function openVenueEditor() {
  const venueId = document.getElementById('venueMapVenueId').value;
  const venue = state.venues.find(item => getId(item) === String(venueId));
  if (!venue?.slug) {
    showToast('Bu mekanın slug’ı yok, editör açılamıyor', 'error');
    return;
  }
  const token = getToken();
  if (!token) {
    showLogin();
    return;
  }

  try {
    const { kioskWebUrl } = await ensureAppConfig();
    if (!kioskWebUrl) {
      showToast('Kiosk web adresi tanımlı değil (KIOSK_WEB_URL)', 'error');
      return;
    }
    const url = `${kioskWebUrl}/editor/${encodeURIComponent(venue.slug)}`
      + `#token=${encodeURIComponent(token)}`;
    window.open(url, '_blank', 'noopener');
    closeVenueMapModal();
  } catch (err) {
    showToast(err.message || 'Editör açılamadı', 'error');
  }
}

async function deleteVenue(venueId) {
  const venue = state.venues.find(item => getId(item) === String(venueId));
  if (!venue) return;
  const label = venue.name || venue.slug || 'Bu mekan';
  if (!confirm(
    `"${label}" mekanı kalıcı olarak silinecek.\n\n`
    + 'Harita ve logo dosyaları da kaldırılır. Bu mekâna bağlı cihazlar mekansız kalır; '
    + 'landing page ve cihaz grupları silinir.\n\nEmin misiniz?',
  )) return;

  try {
    const response = await authFetch(`${API_BASE_URL}/api/venues/${encodeURIComponent(venueId)}`, {
      method: 'DELETE',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Mekan silinemedi');

    if (String(state.activeVenueId) === String(venueId)
      || String(state.selectedVenueId) === String(venueId)) {
      state.activeVenueId = null;
      state.selectedVenueId = null;
      try { localStorage.removeItem(ACTIVE_VENUE_KEY); } catch {}
    }
    closeVenueMapModal();
    await reloadVenues({ silent: true });
    renderVenueMapManagement();
    showToast(`"${label}" silindi`, 'success');
  } catch (err) {
    showToast(err.message || 'Mekan silinemedi', 'error');
  }
}

function openVenueMapModal(venueId) {
  const venue = state.venues.find(item => getId(item) === String(venueId));
  if (!venue) return;
  document.getElementById('venueMapVenueId').value = venueId;
  document.getElementById('venueMapModalTitle').textContent = `${venue.name} Haritası`;
  renderVenueMapStatus(venue);
  renderVenueLogo(venue);
  document.getElementById('venueMapModal').classList.add('show');
}

function closeVenueMapModal() {
  document.getElementById('venueMapModal')?.classList.remove('show');
  const logoInput = document.getElementById('venueLogoFile');
  if (logoInput) logoInput.value = '';
}

async function removeVenueMap() {
  const venueId = document.getElementById('venueMapVenueId').value;
  if (!venueId || !confirm('Bu venue haritasını kaldırmak istediğinize emin misiniz?')) return;
  try {
    const response = await authFetch(`${API_BASE_URL}/api/venues/${venueId}/map`, { method: 'DELETE' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Harita kaldırılamadı');
    await loadVenuesList();
    renderVenueMapManagement();
    const venue = state.venues.find(item => getId(item) === venueId);
    if (venue) renderVenueMapStatus(venue);
    showToast('Venue haritası kaldırıldı', 'success');
  } catch (err) {
    showToast(err.message || 'Harita kaldırılamadı', 'error');
  }
}

function initTenantsPage() {
  wireSlugAutofill('tenantName', 'tenantSlug');
  wireSlugAutofill('venueName', 'venueSlug');
  document.getElementById('closeVenueMapModal')?.addEventListener('click', closeVenueMapModal);
  document.getElementById('cancelVenueMapBtn')?.addEventListener('click', closeVenueMapModal);
  document.getElementById('removeVenueMapBtn')?.addEventListener('click', removeVenueMap);
  document.getElementById('openVenueEditorBtn')?.addEventListener('click', openVenueEditor);
  document.getElementById('venueLogoFile')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadVenueLogo(file);
  });
  document.getElementById('removeVenueLogoBtn')?.addEventListener('click', removeVenueLogo);
  document.getElementById('venueMapModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'venueMapModal') closeVenueMapModal();
  });
  document.getElementById('closeUnitSchemaModal')?.addEventListener('click', closeUnitSchemaModal);
  document.getElementById('cancelUnitSchemaBtn')?.addEventListener('click', closeUnitSchemaModal);
  document.getElementById('unitSchemaModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'unitSchemaModal') closeUnitSchemaModal();
  });
  document.getElementById('unitSchemaForm')?.addEventListener('submit', handleUnitSchemaSubmit);
  document.getElementById('addUnitAttributeBtn')?.addEventListener('click', () => {
    let suffix = unitSchemaDraft.length + 1;
    while (unitSchemaDraft.some(field => field.key === `CustomField${suffix}`)) suffix += 1;
    unitSchemaDraft.push({
      key: `CustomField${suffix}`,
      label: 'Yeni alan',
      type: 'text',
      visible: true,
      editable: true,
      required: false,
      custom: true,
    });
    renderUnitSchemaEditor();
  });
  document.getElementById('resetUnitSchemaBtn')?.addEventListener('click', () => {
    unitSchemaDraft = cloneDefaultUnitAttributes();
    renderUnitSchemaEditor();
  });
  document.getElementById('unitSchemaList')?.addEventListener('input', (event) => {
    const row = event.target.closest('[data-unit-field]');
    const prop = event.target.dataset.schemaProp;
    if (!row || !prop) return;
    const index = Number(row.dataset.unitField);
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    unitSchemaDraft[index][prop] = value;
    if (prop === 'required' && value) {
      unitSchemaDraft[index].visible = true;
      unitSchemaDraft[index].editable = true;
      renderUnitSchemaEditor();
    } else if (prop === 'visible' && !value) {
      unitSchemaDraft[index].editable = false;
      unitSchemaDraft[index].required = false;
      renderUnitSchemaEditor();
    } else if (prop === 'editable' && !value && unitSchemaDraft[index].required) {
      unitSchemaDraft[index].required = false;
      renderUnitSchemaEditor();
    }
  });
  document.getElementById('unitSchemaList')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-unit-field]');
    if (!row) return;
    const index = Number(row.dataset.unitField);
    if (event.target.closest('[data-schema-delete]')) {
      unitSchemaDraft.splice(index, 1);
      renderUnitSchemaEditor();
      return;
    }
    const move = Number(event.target.closest('[data-schema-move]')?.dataset.schemaMove || 0);
    const target = index + move;
    if (!move || target < 0 || target >= unitSchemaDraft.length) return;
    [unitSchemaDraft[index], unitSchemaDraft[target]] = [unitSchemaDraft[target], unitSchemaDraft[index]];
    renderUnitSchemaEditor();
  });

  document.getElementById('newTenantBtn')?.addEventListener('click', () => {
    document.getElementById('tenantName').value = '';
    document.getElementById('tenantSlug').value = '';
    document.getElementById('tenantModal').classList.add('show');
  });
  const closeTenantModal = () => document.getElementById('tenantModal')?.classList.remove('show');
  const closeTenantUserModal = () => document.getElementById('tenantUserModal')?.classList.remove('show');
  const closeVenueModal = () => document.getElementById('venueModal')?.classList.remove('show');

  document.getElementById('closeTenantModal')?.addEventListener('click', closeTenantModal);
  document.getElementById('cancelTenantBtn')?.addEventListener('click', closeTenantModal);
  document.getElementById('tenantModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tenantModal') closeTenantModal();
  });
  document.getElementById('tenantForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await authFetch(`${API_BASE_URL}/api/auth/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('tenantName').value,
          slug: document.getElementById('tenantSlug').value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Oluşturulamadı');
      document.getElementById('tenantModal').classList.remove('show');
      showToast('Müşteri oluşturuldu', 'success');
      loadTenantsPage();
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('closeTenantUserModal')?.addEventListener('click', closeTenantUserModal);
  document.getElementById('cancelTenantUserBtn')?.addEventListener('click', closeTenantUserModal);
  document.getElementById('tenantUserModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'tenantUserModal') closeTenantUserModal();
  });
  document.getElementById('tenantUserForm')?.addEventListener('submit', handleTenantUserSubmit);
  document.getElementById('deleteTenantUserAccountBtn')?.addEventListener('click', () => {
    const userId = document.getElementById('tenantUserId').value;
    if (userId) deleteUserAccount(userId);
  });
  document.getElementById('tenantUserMemberships')?.addEventListener('change', (event) => {
    const row = event.target.closest('[data-membership-tenant]');
    if (!row) return;
    if (event.target.matches('[data-membership-assign]')) {
      row.classList.toggle('is-assigned', event.target.checked);
      row.classList.toggle('is-open', event.target.checked);
      if (event.target.checked) {
        const checked = row.querySelectorAll('[data-membership-perm]:checked');
        if (!checked.length) {
          const first = row.querySelector(`[data-membership-perm="${PERMS.UNIT_ADS}"]`);
          if (first) first.checked = true;
        }
      }
    }
    syncTenantUserMembershipDraftFromDom();
    renderTenantUserMemberships();
  });

  document.getElementById('newVenueBtn')?.addEventListener('click', () => {
    document.getElementById('venueModal').classList.add('show');
  });
  document.getElementById('closeVenueModal')?.addEventListener('click', closeVenueModal);
  document.getElementById('cancelVenueBtn')?.addEventListener('click', closeVenueModal);
  document.getElementById('venueModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'venueModal') closeVenueModal();
  });
  document.getElementById('venueForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await authFetch(`${API_BASE_URL}/api/venues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('venueName').value,
          slug: document.getElementById('venueSlug').value,
          tenantId: null,
          sheets: {
            sheetId: document.getElementById('venueSheetId').value,
            tabs: {
              list: document.getElementById('venueTabList').value,
              categories: document.getElementById('venueTabCategories').value,
              info: 'Info',
              changes: document.getElementById('venueTabChanges').value
            },
            writeEndpointUrl: document.getElementById('venueWriteUrl').value
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Oluşturulamadı');

      closeVenueModal();
      document.getElementById('venueForm')?.reset();
      await reloadVenues({ preferId: getId(data), silent: true });
      renderVenueMapManagement();
      showToast('Mekan oluşturuldu — haritayı Editörde Düzenle ile ekleyin', 'success');
      openVenueMapModal(getId(data));
    } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('tenantSearch')?.addEventListener('input', () => renderTenantsList());
}

// ============================================
// Global Functions (for onclick handlers)
// ============================================
window.navigateTo = navigateTo;
window.openLandingPageModal = openLandingPageModal;
window.editLandingPage = editLandingPage;
window.deleteLandingPage = deleteLandingPage;
window.deleteDevice = deleteDevice;
window.revokeDevice = revokeDevice;
window.resetDevice = resetDevice;
window.setDeviceView = setDeviceView;
window.openDeviceNameModal = openDeviceNameModal;
window.openDeviceVenueModal = openDeviceVenueModal;
window.openVenueMapModal = openVenueMapModal;
window.deleteVenue = deleteVenue;
window.openUnitSchemaModal = openUnitSchemaModal;
window.removeSlide = removeSlide;
window.moveSlideUp = moveSlideUp;
window.moveSlideDown = moveSlideDown;
window.removeDeviceFromLP = removeDeviceFromLP;
window.refreshAllData = refreshAllData;
window.openGroupModal = openGroupModal;
window.editGroup = editGroup;
window.deleteGroup = deleteGroup;
window.updateGroupDeviceCount = updateGroupDeviceCount;
window.updateTargetGroupCount = updateTargetGroupCount;
window.deleteTenant = deleteTenant;
window.removeUserFromTenant = removeUserFromTenant;
window.deleteUserAccount = deleteUserAccount;
window.assignVenue = assignVenue;
window.unassignVenue = unassignVenue;
window.openTenantUserModal = openTenantUserModal;

