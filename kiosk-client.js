/**
 * Inmapper Kiosk Client
 * 
 * Bu dosyayı kiosk projenizdeki landing_alt.html dosyasına dahil edin.
 * FingerprintJS ile cihaz kimliği oluşturur ve backend'den yapılandırma çeker.
 * 
 * Kullanım:
 * <script src="https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@3/dist/fp.min.js"></script>
 * <script src="kiosk-client.js"></script>
 */

(function(window) {
  'use strict';

  const KioskClient = {
    config: {
      apiUrl: 'http://localhost:3000',
      pollInterval: 60000, // 1 dakikada bir config kontrolü
      onConfigLoaded: null,
      onError: null
    },

    deviceId: null,
    fingerprint: null,
    pollTimer: null,

    /**
     * Client'ı başlat
     * @param {Object} options - Yapılandırma seçenekleri
     */
    async init(options = {}) {
      this.config = { ...this.config, ...options };

      console.log('🔧 Inmapper Kiosk Client başlatılıyor...');

      try {
        // FingerprintJS'i yükle
        await this.initFingerprint();
        
        // Cihazı kaydet
        await this.registerDevice();
        
        // Yapılandırmayı çek
        await this.loadConfig();
        
        // Periyodik kontrol başlat
        this.startPolling();

        console.log('✅ Kiosk Client başarıyla başlatıldı');
      } catch (error) {
        console.error('❌ Kiosk Client başlatılamadı:', error);
        if (this.config.onError) {
          this.config.onError(error);
        }
      }
    },

    /**
     * FingerprintJS ile cihaz parmak izini oluştur
     */
    async initFingerprint() {
      console.log('🔍 Cihaz parmak izi oluşturuluyor...');

      if (typeof FingerprintJS === 'undefined') {
        throw new Error('FingerprintJS yüklenmemiş! CDN\'den yüklendiğinden emin olun.');
      }

      const fp = await FingerprintJS.load();
      const result = await fp.get();
      
      this.fingerprint = result.visitorId;
      console.log('✅ Fingerprint:', this.fingerprint);

      return this.fingerprint;
    },

    /**
     * Cihazı backend'e kaydet
     */
    async registerDevice() {
      console.log('📝 Cihaz kaydediliyor...');

      const deviceInfo = {
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        language: navigator.language,
        platform: navigator.platform,
        timestamp: new Date().toISOString()
      };

      try {
        const response = await fetch(`${this.config.apiUrl}/api/devices/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fingerprint: this.fingerprint,
            deviceInfo
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        this.deviceId = data.device.id;

        console.log('✅ Cihaz kaydedildi:', this.deviceId);
        return data.device;
      } catch (error) {
        console.error('❌ Cihaz kaydedilemedi:', error);
        throw error;
      }
    },

    /**
     * Cihazın yapılandırmasını backend'den çek
     */
    async loadConfig() {
      if (!this.deviceId) {
        console.error('❌ Device ID yok, önce cihazı kaydedin!');
        return null;
      }

      console.log('📥 Yapılandırma yükleniyor...');

      try {
        const response = await fetch(`${this.config.apiUrl}/api/devices/${this.deviceId}/config`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ Yapılandırma yüklendi:', data);

        if (this.config.onConfigLoaded && data.landingPage) {
          this.config.onConfigLoaded(data);
        }

        return data;
      } catch (error) {
        console.error('❌ Yapılandırma yüklenemedi:', error);
        if (this.config.onError) {
          this.config.onError(error);
        }
        throw error;
      }
    },

    /**
     * Periyodik yapılandırma kontrolü başlat
     */
    startPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }

      console.log(`🔄 Periyodik kontrol başlatıldı (${this.config.pollInterval}ms)`);

      this.pollTimer = setInterval(() => {
        this.loadConfig();
      }, this.config.pollInterval);
    },

    /**
     * Periyodik kontrolü durdur
     */
    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
        console.log('⏸️ Periyodik kontrol durduruldu');
      }
    },

    /**
     * Yapılandırmayı manuel olarak yeniden yükle
     */
    async refresh() {
      console.log('🔄 Manuel yenileme...');
      return await this.loadConfig();
    },

    /**
     * Client bilgilerini al
     */
    getInfo() {
      return {
        deviceId: this.deviceId,
        fingerprint: this.fingerprint,
        apiUrl: this.config.apiUrl
      };
    }
  };

  // Global scope'a ekle
  window.KioskClient = KioskClient;

  // Sayfa yüklendiğinde otomatik başlat (opsiyonel)
  // Eğer manuel kontrol isterseniz bu satırı kaldırın
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('📌 Kiosk Client otomatik başlatma hazır. KioskClient.init() çağrısı yapın.');
    });
  }

})(window);

















