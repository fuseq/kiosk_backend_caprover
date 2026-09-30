/**
 * Inmapper Kiosk Client
 *
 * Güvenli cihaz kaydı: her kiosk kendi cihaz anahtarını üretir.
 * Venue ataması yalnızca admin panelinden yapılır.
 */

(function(window) {
  'use strict';

  const STORAGE_KEY = 'inmapper_kiosk_device';
  const CONFIG_CACHE_KEY = 'inmapper_kiosk_config';

  function bytesToBase64Url(bytes) {
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function generateDeviceToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  const KioskClient = {
    config: {
      apiUrl: 'https://inmapper-kiosk-backend.isohtel.com.tr',
      pollInterval: 15000,
      onConfigLoaded: null,
      onEnrollmentChanged: null,
      onError: null,
    },

    deviceId: null,
    deviceToken: null,
    fingerprint: null,
    displayId: null,
    enrollmentStatus: 'pending',
    pollTimer: null,

    async init(options = {}) {
      this.config = { ...this.config, ...options };

      try {
        const savedDevice = this.loadFromStorage();

        if (savedDevice?.deviceId && savedDevice?.deviceToken && savedDevice?.fingerprint) {
          this.deviceId = savedDevice.deviceId;
          this.deviceToken = savedDevice.deviceToken;
          this.fingerprint = savedDevice.fingerprint;
          this.displayId = savedDevice.displayId || null;
          this.enrollmentStatus = savedDevice.enrollmentStatus || 'pending';
          await this.registerDevice({ heartbeat: true });
        } else {
          await this.initFingerprint();
          await this.registerDevice({ heartbeat: false });
        }

        await this.loadConfig();
        this.startPolling();
      } catch (error) {
        console.error('Kiosk Client başlatılamadı:', error);
        this.config.onError?.(error);
      }
    },

    loadFromStorage() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : null;
      } catch {
        return null;
      }
    },

    saveToStorage() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          deviceId: this.deviceId,
          deviceToken: this.deviceToken,
          fingerprint: this.fingerprint,
          displayId: this.displayId,
          enrollmentStatus: this.enrollmentStatus,
          savedAt: new Date().toISOString(),
        }));
      } catch (e) {
        console.warn('Cihaz bilgisi kaydedilemedi:', e);
      }
    },

    clearIdentity({ keepFingerprint = false } = {}) {
      const fingerprint = keepFingerprint ? this.fingerprint : null;
      this.deviceId = null;
      this.deviceToken = generateDeviceToken();
      this.fingerprint = fingerprint;
      this.displayId = null;
      this.enrollmentStatus = 'pending';
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(CONFIG_CACHE_KEY);
      } catch { /* ignore */ }
    },

    authHeaders(extra = {}) {
      return {
        'Content-Type': 'application/json',
        Authorization: `Device ${this.deviceToken}`,
        ...extra,
      };
    },

    collectDeviceInfo() {
      return {
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        language: navigator.language,
        platform: navigator.platform,
        timestamp: new Date().toISOString(),
      };
    },

    async initFingerprint() {
      if (typeof FingerprintJS === 'undefined') {
        throw new Error('FingerprintJS yüklenmemiş');
      }
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      this.fingerprint = result.visitorId;
      return this.fingerprint;
    },

    applyDevicePayload(device, enrollmentStatus) {
      const prevStatus = this.enrollmentStatus;
      if (device?.id) this.deviceId = device.id;
      if (device?.displayId) this.displayId = device.displayId;
      if (enrollmentStatus) this.enrollmentStatus = enrollmentStatus;
      else if (device?.enrollmentStatus) this.enrollmentStatus = device.enrollmentStatus;
      this.saveToStorage();
      if (prevStatus !== this.enrollmentStatus) {
        this.config.onEnrollmentChanged?.(this.enrollmentStatus);
      }
    },

    async registerDevice({ heartbeat = false } = {}) {
      if (!this.fingerprint) await this.initFingerprint();
      if (!this.deviceToken) this.deviceToken = generateDeviceToken();

      const response = await fetch(`${this.config.apiUrl}/api/devices/register`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          fingerprint: this.fingerprint,
          deviceInfo: this.collectDeviceInfo(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 403 && data.code === 'DEVICE_REVOKED') {
          const previous = this.enrollmentStatus;
          this.enrollmentStatus = 'revoked';
          this.saveToStorage();
          if (previous !== 'revoked') this.config.onEnrollmentChanged?.('revoked');
          return null;
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      this.applyDevicePayload(data.device, data.enrollmentStatus);
      if (!heartbeat) {
        console.log('Yeni cihaz kaydı tamamlandı:', this.deviceId, this.displayId);
      }
      return data.device;
    },

    async loadConfig() {
      if (!this.deviceId || !this.deviceToken) {
        throw new Error('Cihaz kimliği eksik');
      }

      const response = await fetch(`${this.config.apiUrl}/api/devices/${this.deviceId}/config`, {
        headers: {
          Authorization: `Device ${this.deviceToken}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        if (data.code === 'DEVICE_REVOKED') {
          const previous = this.enrollmentStatus;
          this.enrollmentStatus = 'revoked';
          this.saveToStorage();
          if (previous !== 'revoked') this.config.onEnrollmentChanged?.('revoked');
          const revokedConfig = {
            device: { id: this.deviceId, displayId: this.displayId },
            venue: null,
            landingPage: null,
            isAssigned: false,
            enrollmentStatus: 'revoked',
          };
          this.config.onConfigLoaded?.(revokedConfig);
          return revokedConfig;
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.enrollmentStatus) {
        this.applyDevicePayload(data.device || {}, data.enrollmentStatus);
      }

      if (data.enrollmentStatus === 'pending') {
        this.config.onConfigLoaded?.({
          device: data.device,
          venue: null,
          landingPage: null,
          isAssigned: false,
          enrollmentStatus: 'pending',
        });
        return data;
      }

      this.saveConfigToCache(data);
      this.config.onConfigLoaded?.(data);
      return data;
    },

    saveConfigToCache(data) {
      try {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
          data,
          deviceId: this.deviceId,
          savedAt: new Date().toISOString(),
        }));
      } catch { /* ignore */ }
    },

    loadConfigFromCache() {
      try {
        const raw = localStorage.getItem(CONFIG_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed.deviceId && parsed.deviceId !== this.deviceId) return null;
        return parsed.data || null;
      } catch {
        return null;
      }
    },

    startPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(async () => {
        try {
          await this.registerDevice({ heartbeat: true });
          await this.loadConfig();
        } catch (error) {
          const cached = this.loadConfigFromCache();
          if (cached) {
            this.config.onConfigLoaded?.(cached);
            return;
          }
          this.config.onError?.(error);
        }
      }, this.config.pollInterval);
    },

    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    async refresh() {
      await this.registerDevice({ heartbeat: true });
      return this.loadConfig();
    },

    getInfo() {
      return {
        deviceId: this.deviceId,
        fingerprint: this.fingerprint,
        displayId: this.displayId,
        enrollmentStatus: this.enrollmentStatus,
        apiUrl: this.config.apiUrl,
      };
    },
  };

  window.KioskClient = KioskClient;
})(window);
