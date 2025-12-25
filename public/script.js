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
const getId = (obj) => obj?.id || obj?._id || obj;

// ============================================
// State Management
// ============================================
const state = {
  devices: [],
  landingPages: [],
  currentLandingPage: null,
  currentPage: 'dashboard',
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
  sidebarToggle: document.getElementById('sidebarToggle'),
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
    settings: document.getElementById('settingsPage')
  },
  
  // Stats
  statTotalDevices: document.getElementById('statTotalDevices'),
  statActiveDevices: document.getElementById('statActiveDevices'),
  statLandingPages: document.getElementById('statLandingPages'),
  statTotalSlides: document.getElementById('statTotalSlides'),
  
  // Landing Pages
  landingPagesList: document.getElementById('landingPagesList'),
  landingPagesEmpty: document.getElementById('landingPagesEmpty'),
  newLandingPageBtn: document.getElementById('newLandingPageBtn'),
  landingPageSearch: document.getElementById('landingPageSearch'),
  
  // Devices
  devicesTableBody: document.getElementById('devicesTableBody'),
  devicesEmpty: document.getElementById('devicesEmpty'),
  deviceSearch: document.getElementById('deviceSearch'),
  filterBtns: document.querySelectorAll('.filter-btn'),
  
  // Landing Page Modal
  landingPageModal: document.getElementById('landingPageModal'),
  landingPageForm: document.getElementById('landingPageForm'),
  modalTitle: document.getElementById('modalTitle'),
  landingPageId: document.getElementById('landingPageId'),
  landingPageName: document.getElementById('landingPageName'),
  transitionDuration: document.getElementById('transitionDuration'),
  durationDisplay: document.getElementById('durationDisplay'),
  slidesList: document.getElementById('slidesList'),
  slideCount: document.getElementById('slideCount'),
  addSlideBtn: document.getElementById('addSlideBtn'),
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
  closeDeviceNameModal: document.getElementById('closeDeviceNameModal'),
  cancelDeviceNameBtn: document.getElementById('cancelDeviceNameBtn'),
  
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
  await refreshAllData();
  updateApiEndpoint();
  
  // Start auto-refresh every 30 seconds
  setInterval(refreshAllData, 30000);
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
}

function setupEventListeners() {
  // Sidebar
  elements.sidebarToggle?.addEventListener('click', toggleSidebar);
  elements.mobileMenuBtn?.addEventListener('click', toggleMobileSidebar);
  
  // Theme Toggle
  elements.themeToggle?.addEventListener('click', toggleTheme);
  
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
  elements.addSlideBtn?.addEventListener('click', () => addSlide());
  elements.assignDevicesBtn?.addEventListener('click', openDeviceAssignModal);
  
  // Duration slider
  elements.transitionDuration?.addEventListener('input', updateDurationDisplay);
  
  // Device Assign Modal
  elements.closeDeviceAssignModal?.addEventListener('click', closeDeviceAssignModal);
  elements.cancelDeviceAssignBtn?.addEventListener('click', closeDeviceAssignModal);
  elements.saveDeviceAssignBtn?.addEventListener('click', saveDeviceAssignment);
  
  // Device Name Edit Modal
  elements.closeDeviceNameModal?.addEventListener('click', closeDeviceNameModal);
  elements.cancelDeviceNameBtn?.addEventListener('click', closeDeviceNameModal);
  elements.deviceNameForm?.addEventListener('submit', handleDeviceNameSubmit);
  
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
  
  // Search
  elements.landingPageSearch?.addEventListener('input', handleLandingPageSearch);
  elements.deviceSearch?.addEventListener('input', handleDeviceSearch);
  
  // Device filters
  elements.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterDevices(btn.dataset.filter);
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
    'landing-pages': { title: 'Landing Pages', breadcrumb: 'Ana Sayfa / Landing Pages' },
    devices: { title: 'Cihazlar', breadcrumb: 'Ana Sayfa / Cihazlar' },
    settings: { title: 'Ayarlar', breadcrumb: 'Ana Sayfa / Ayarlar' }
  };
  
  const pageInfo = titles[page] || titles.dashboard;
  if (elements.pageTitle) elements.pageTitle.textContent = pageInfo.title;
  if (elements.pageBreadcrumb) elements.pageBreadcrumb.textContent = pageInfo.breadcrumb;
  
  // Close mobile sidebar
  elements.sidebar?.classList.remove('mobile-open');
}

function toggleSidebar() {
  elements.sidebar?.classList.toggle('collapsed');
}

function toggleMobileSidebar() {
  elements.sidebar?.classList.toggle('mobile-open');
}

// ============================================
// Data Fetching
// ============================================
async function refreshAllData() {
  try {
    await Promise.all([
      loadStats(),
      loadDevices(),
      loadLandingPages()
    ]);
  } catch (error) {
    console.error('Error refreshing data:', error);
    showToast('Veri yüklenirken hata oluştu', 'error');
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/stats`);
    if (!response.ok) throw new Error('Failed to load stats');
    
    const stats = await response.json();
    state.stats = stats;
    
    // Animate stats
    animateValue(elements.statTotalDevices, stats.totalDevices);
    animateValue(elements.statActiveDevices, stats.activeDevices);
    animateValue(elements.statLandingPages, stats.totalLandingPages);
    animateValue(elements.statTotalSlides, stats.totalSlides);
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

async function loadDevices() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/devices`);
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
    const response = await fetch(`${API_BASE_URL}/api/landing-pages`);
    if (!response.ok) throw new Error('Failed to load landing pages');
    
    const data = await response.json();
    state.landingPages = data.landingPages || [];
    renderLandingPages();
  } catch (error) {
    console.error('Error loading landing pages:', error);
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
            <span><i class="ph ph-images"></i> ${lp.slideCount || lp.slides?.length || 0} görsel</span>
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
    return '<div class="lp-slides-preview"><span class="text-muted">Görsel yok</span></div>';
  }
  
  const visibleSlides = slides.slice(0, 4);
  const remaining = slides.length - 4;
  
  return `
    <div class="lp-slides-preview">
      ${visibleSlides.map(slide => `
        <img src="${escapeHtml(slide.imageUrl)}" 
             alt="Slide" 
             class="lp-slide-thumb"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22><rect fill=%22%231a1a24%22 width=%2264%22 height=%2264%22/><text x=%2232%22 y=%2236%22 text-anchor=%22middle%22 fill=%22%2364748b%22 font-size=%2212%22>?</text></svg>'">
      `).join('')}
      ${remaining > 0 ? `<div class="lp-slide-more">+${remaining}</div>` : ''}
    </div>
  `;
}

function renderDevicesTable(filter = 'all', search = '') {
  let filtered = state.devices;
  
  // Apply status filter
  if (filter !== 'all') {
    filtered = filtered.filter(d => d.status === filter);
  }
  
  // Apply search
  if (search) {
    const term = search.toLowerCase();
    filtered = filtered.filter(d => {
      const deviceId = getId(d);
      return d.name?.toLowerCase().includes(term) ||
        deviceId?.toLowerCase().includes(term) ||
        d.fingerprint?.toLowerCase().includes(term);
    });
  }
  
  if (filtered.length === 0) {
    if (elements.devicesTableBody) {
      elements.devicesTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 3rem;">
            <div class="empty-state">
              <div class="empty-state-icon">
                <i class="ph ph-devices"></i>
              </div>
              <h3>Cihaz Bulunamadı</h3>
              <p>${search ? 'Arama kriterlerine uygun cihaz yok' : 'Henüz kayıtlı cihaz bulunmuyor'}</p>
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
      const assignedLP = state.landingPages.find(lp => {
        const deviceIds = lp.deviceIds || lp.devices?.map(d => getId(d)) || [];
        return deviceIds.some(id => getId(id) === deviceId);
      });
      
      return `
        <tr>
          <td>
            <span class="status-badge ${device.status}">${getStatusText(device.status)}</span>
          </td>
          <td>
            <div class="device-name-cell">
              <span class="device-name-text">${escapeHtml(device.name || 'İsimsiz Cihaz')}</span>
              <button class="device-name-edit-btn" onclick="openDeviceNameModal('${deviceId}')" title="Adı Düzenle">
                <i class="ph ph-pencil-simple"></i>
              </button>
            </div>
          </td>
          <td>
            <span class="device-id">${deviceId?.substring(0, 8) || '-'}...</span>
          </td>
          <td>${device.deviceInfo?.screenResolution || '-'}</td>
          <td>${formatDate(device.lastSeen)}</td>
          <td>
            ${assignedLP 
              ? `<span class="text-primary">${escapeHtml(assignedLP.name)}</span>` 
              : '<span class="text-muted">Atanmamış</span>'}
          </td>
          <td>
            <div style="display: flex; gap: 0.5rem;">
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
function openLandingPageModal(landingPage = null) {
  state.currentLandingPage = landingPage;
  
  // Update modal title
  const titleSpan = elements.modalTitle?.querySelector('span');
  if (titleSpan) {
    titleSpan.textContent = landingPage ? 'Landing Page Düzenle' : 'Yeni Landing Page';
  }
  
  // Fill form
  if (elements.landingPageId) elements.landingPageId.value = getId(landingPage) || '';
  if (elements.landingPageName) elements.landingPageName.value = landingPage?.name || '';
  if (elements.transitionDuration) {
    elements.transitionDuration.value = landingPage?.transitionDuration || 8000;
    updateDurationDisplay();
  }
  
  // Normalize deviceIds from devices array
  if (landingPage && !landingPage.deviceIds && landingPage.devices) {
    landingPage.deviceIds = landingPage.devices.map(d => getId(d));
  }
  
  // Render slides
  if (elements.slidesList) {
    elements.slidesList.innerHTML = '';
    if (landingPage?.slides) {
      landingPage.slides.forEach(slide => addSlide(slide));
    }
  }
  updateSlideCount();
  
  // Render assigned devices
  renderAssignedDevices();
  
  // Show modal
  elements.landingPageModal?.classList.add('show');
}

function closeLandingPageModal() {
  elements.landingPageModal?.classList.remove('show');
  state.currentLandingPage = null;
  elements.landingPageForm?.reset();
  if (elements.slidesList) elements.slidesList.innerHTML = '';
}

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
    showToast('Lütfen landing page adı girin', 'error');
    return;
  }
  
  // Get slides
  const slideElements = elements.slidesList?.querySelectorAll('.slide-item') || [];
  const slides = Array.from(slideElements).map((el, index) => ({
    id: el.dataset.slideId || generateId(),
    imageUrl: el.querySelector('.slide-url-input')?.value || '',
    order: index
  })).filter(slide => slide.imageUrl);
  
  const payload = {
    name,
    transitionDuration,
    slides,
    deviceIds: state.currentLandingPage?.deviceIds || []
  };
  
  try {
    let response;
    if (id) {
      response = await fetch(`${API_BASE_URL}/api/landing-pages/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      response = await fetch(`${API_BASE_URL}/api/landing-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    
    if (response.ok) {
      closeLandingPageModal();
      await refreshAllData();
      showToast(id ? 'Landing page güncellendi' : 'Landing page oluşturuldu', 'success');
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
  if (!confirm(`"${landingPage?.name}" landing page'ini silmek istediğinize emin misiniz?`)) {
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/landing-pages/${id}`, {
      method: 'DELETE'
    });
    
    if (response.ok) {
      await refreshAllData();
      showToast('Landing page silindi', 'success');
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
    const response = await fetch(`${API_BASE_URL}/api/devices/${id}`, {
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
function openDeviceNameModal(deviceId) {
  const device = state.devices.find(d => getId(d) === deviceId);
  if (!device) return;
  
  if (elements.editDeviceId) elements.editDeviceId.value = deviceId;
  if (elements.editDeviceName) elements.editDeviceName.value = device.name || '';
  
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
  
  if (!deviceId || !newName) {
    showToast('Lütfen cihaz adı girin', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/devices/${deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    
    if (response.ok) {
      closeDeviceNameModal();
      await refreshAllData();
      showToast('Cihaz adı güncellendi', 'success');
    } else {
      throw new Error('Failed to update');
    }
  } catch (error) {
    console.error('Error updating device name:', error);
    showToast('Güncelleme başarısız', 'error');
  }
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
function addSlide(slide = null) {
  const slideId = slide?.id || generateId();
  const slideItem = document.createElement('div');
  slideItem.className = 'slide-item';
  slideItem.dataset.slideId = slideId;
  
  const slideNumber = (elements.slidesList?.children.length || 0) + 1;
  const imageUrl = slide?.imageUrl || '';
  
  slideItem.innerHTML = `
    <span class="slide-order">${slideNumber}</span>
    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" class="slide-thumb" onerror="this.style.display='none'">` : ''}
    <input type="url" class="slide-url-input" placeholder="Görsel URL'si girin..." value="${escapeHtml(imageUrl)}">
    <div class="slide-actions">
      <button type="button" class="btn btn-ghost btn-icon" onclick="moveSlideUp(this)" title="Yukarı">
        <i class="ph ph-arrow-up"></i>
      </button>
      <button type="button" class="btn btn-ghost btn-icon" onclick="moveSlideDown(this)" title="Aşağı">
        <i class="ph ph-arrow-down"></i>
      </button>
      <button type="button" class="btn btn-ghost btn-icon" onclick="removeSlide(this)" title="Sil">
        <i class="ph ph-trash"></i>
      </button>
    </div>
  `;
  
  elements.slidesList?.appendChild(slideItem);
  updateSlideOrders();
  updateSlideCount();
}

function removeSlide(btn) {
  btn.closest('.slide-item')?.remove();
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
  const count = elements.slidesList?.children.length || 0;
  if (elements.slideCount) {
    elements.slideCount.textContent = `${count} görsel`;
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
  
  const assignedDeviceIds = (state.currentLandingPage?.deviceIds || 
    state.currentLandingPage?.devices?.map(d => getId(d)) || [])
    .map(id => getId(id));
  
  elements.deviceCheckboxes.innerHTML = state.devices.map(device => {
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
    const response = await fetch(`${API_BASE_URL}/api/landing-pages/${lpId}/assign-devices`, {
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
  
  const current = parseInt(element.textContent) || 0;
  const diff = value - current;
  const duration = 500;
  const steps = 20;
  const increment = diff / steps;
  let step = 0;
  
  const timer = setInterval(() => {
    step++;
    element.textContent = Math.round(current + (increment * step));
    if (step >= steps) {
      clearInterval(timer);
      element.textContent = value;
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
// Global Functions (for onclick handlers)
// ============================================
window.navigateTo = navigateTo;
window.openLandingPageModal = openLandingPageModal;
window.editLandingPage = editLandingPage;
window.deleteLandingPage = deleteLandingPage;
window.deleteDevice = deleteDevice;
window.openDeviceNameModal = openDeviceNameModal;
window.removeSlide = removeSlide;
window.moveSlideUp = moveSlideUp;
window.moveSlideDown = moveSlideDown;
window.removeDeviceFromLP = removeDeviceFromLP;
window.refreshAllData = refreshAllData;
