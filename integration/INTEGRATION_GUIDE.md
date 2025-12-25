# 🔗 inMapper Kiosk Entegrasyon Rehberi

Bu rehber, mevcut kiosk projenize inMapper Kiosk Backend sistemini nasıl entegre edeceğinizi adım adım açıklar.

---

## 📋 Gereksinimler

- Backend sunucusu çalışır durumda olmalı
- Kiosk cihazlarında internet bağlantısı
- Modern web tarayıcısı (Chrome, Firefox, Edge)

---

## 🚀 Adım 1: kiosk-client.js Dosyasını Projenize Ekleyin

`kiosk-client.js` dosyasını kiosk projenizin dizinine kopyalayın:

```
your_kiosk_project/
├── kiosk-client.js  ← Buraya kopyalayın
├── landing_alt.html
├── landing_alt.js
└── ...
```

---

## 📝 Adım 2: HTML Dosyanızı Güncelleyin

`landing_alt.html` dosyanızın `<head>` bölümüne şu script'leri ekleyin:

```html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kiosk Landing Page</title>
  
  <!-- Mevcut CSS'leriniz -->
  <link rel="stylesheet" href="landing_alt.css">
  
  <!-- FingerprintJS CDN - Cihaz tanımlama için -->
  <script src="https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@3/dist/fp.min.js"></script>
  
  <!-- inMapper Kiosk Client -->
  <script src="kiosk-client.js"></script>
</head>
<body>
  <!-- Slider içeriğiniz -->
  <div id="filmStrip">
    <!-- Slide'lar buraya dinamik olarak eklenecek -->
  </div>
  
  <!-- Mevcut script'leriniz -->
  <script src="landing_alt.js"></script>
</body>
</html>
```

---

## 🎨 Adım 3: JavaScript Entegrasyonu

`landing_alt.js` dosyanızın **başına** şu kodu ekleyin:

```javascript
// ===================================================
// inMapper KIOSK CLIENT ENTEGRASYONU
// ===================================================

// Backend sunucu adresi
const KIOSK_BACKEND_URL = 'https://your-backend-url.com';
// veya local geliştirme için: 'http://localhost:3000'

// Global yapılandırma değişkeni
let kioskConfig = null;

// Sayfa yüklendiğinde Kiosk Client'ı başlat
document.addEventListener('DOMContentLoaded', () => {
  initKioskClient();
});

async function initKioskClient() {
  if (typeof KioskClient === 'undefined') {
    console.warn('⚠️ KioskClient bulunamadı, varsayılan yapılandırma kullanılacak');
    return;
  }
  
  try {
    await KioskClient.init({
      apiUrl: KIOSK_BACKEND_URL,
      pollInterval: 60000, // Her 1 dakikada yapılandırmayı kontrol et
      
      onConfigLoaded: (config) => {
        console.log('✅ inMapper yapılandırması yüklendi:', config);
        kioskConfig = config;
        
        if (config.landingPage) {
          applyKioskConfiguration(config.landingPage);
        }
      },
      
      onError: (error) => {
        console.error('❌ inMapper Kiosk Client hatası:', error);
        // Hata durumunda mevcut slider'ı değiştirmeyin
      }
    });
  } catch (error) {
    console.error('❌ Kiosk Client başlatılamadı:', error);
  }
}

// Backend'den gelen yapılandırmayı uygula
function applyKioskConfiguration(landingPage) {
  console.log('🔧 Yapılandırma uygulanıyor...', landingPage);
  
  // 1. Slider görsellerini güncelle
  if (landingPage.slides && landingPage.slides.length > 0) {
    updateSliderImages(landingPage.slides);
  }
  
  // 2. Geçiş süresini güncelle
  if (landingPage.transitionDuration) {
    updateTransitionDuration(landingPage.transitionDuration);
  }
}

// Slider görsellerini güncelle
function updateSliderImages(slides) {
  const filmStrip = document.getElementById('filmStrip');
  if (!filmStrip) {
    console.error('filmStrip elementi bulunamadı!');
    return;
  }
  
  console.log('🖼️ Slider görselleri güncelleniyor:', slides.length, 'adet');
  
  // Mevcut slide'ları temizle
  filmStrip.innerHTML = '';
  
  // Yeni slide'ları ekle
  slides.forEach((slide, index) => {
    const slideDiv = document.createElement('div');
    slideDiv.className = 'slide';
    slideDiv.style.backgroundImage = `url('${slide.imageUrl}')`;
    slideDiv.style.backgroundSize = 'cover';
    slideDiv.style.backgroundPosition = 'center';
    slideDiv.dataset.slideId = slide.id;
    filmStrip.appendChild(slideDiv);
  });
  
  // Global değişkenleri güncelle (mevcut slider kodunuz için)
  window.originalSlides = Array.from(filmStrip.querySelectorAll('.slide'));
  window.totalSlides = window.originalSlides.length;
  
  // Indicator'ları güncelle (varsa)
  updateIndicatorsForNewSlides(slides.length);
  
  // Slider'ı yeniden başlat
  reinitializeSlider();
  
  console.log('✅ Slider güncellendi');
}

// Indicator'ları güncelle
function updateIndicatorsForNewSlides(count) {
  const slideIndicators = document.getElementById('slideIndicators');
  if (!slideIndicators) return;
  
  slideIndicators.innerHTML = '';
  
  for (let i = 0; i < count; i++) {
    const indicator = document.createElement('button');
    indicator.className = 'indicator' + (i === 0 ? ' active' : '');
    indicator.dataset.index = i;
    indicator.innerHTML = '<span></span>';
    
    indicator.addEventListener('click', () => {
      if (typeof goToSlide === 'function') {
        goToSlide(i);
        if (typeof startSlideShow === 'function') {
          startSlideShow();
        }
      }
    });
    
    slideIndicators.appendChild(indicator);
  }
  
  window.indicators = Array.from(slideIndicators.querySelectorAll('.indicator'));
}

// Geçiş süresini güncelle
function updateTransitionDuration(duration) {
  console.log('⏱️ Geçiş süresi:', duration, 'ms');
  
  window.SLIDE_TRANSITION_DURATION = duration;
  
  // Slider timer'ını yeniden başlat
  if (typeof startSlideShow === 'function') {
    startSlideShow();
  }
}

// Slider'ı yeniden başlat
function reinitializeSlider() {
  const filmStrip = document.getElementById('filmStrip');
  const originalSlides = window.originalSlides;
  
  if (!filmStrip || !originalSlides || originalSlides.length === 0) return;
  
  // İlk ve son slide'ın klonlarını oluştur (sonsuz döngü için)
  const firstClone = originalSlides[0].cloneNode(true);
  const lastClone = originalSlides[originalSlides.length - 1].cloneNode(true);
  
  firstClone.setAttribute('data-clone', 'true');
  lastClone.setAttribute('data-clone', 'true');
  
  filmStrip.insertBefore(lastClone, filmStrip.firstChild);
  filmStrip.appendChild(firstClone);
  
  // Pozisyonu sıfırla
  window.currentIndex = 0;
  
  // Varsa mevcut fonksiyonları çağır
  if (typeof updateIndicators === 'function') updateIndicators();
  if (typeof updateSlidePosition === 'function') updateSlidePosition(false);
  if (typeof startSlideShow === 'function') startSlideShow();
}

// ===================================================
// inMapper ENTEGRASYON SONU
// ===================================================
```

---

## 🔄 Adım 4: startSlideShow Fonksiyonunu Güncelleyin

Mevcut `startSlideShow` fonksiyonunuzu dinamik süre desteği için güncelleyin:

```javascript
function startSlideShow() {
  // Mevcut timer'ı durdur
  if (slideTimer) {
    window.clearInterval(slideTimer);
  }
  
  // inMapper'dan gelen süreyi kullan, yoksa varsayılan 8000ms
  const duration = window.SLIDE_TRANSITION_DURATION || 8000;
  
  slideTimer = window.setInterval(() => {
    nextSlide();
  }, duration);
}
```

---

## ✅ Adım 5: Test

### Backend Sunucusunu Başlatın

```bash
cd inmapper_kiosk_backend
npm start
```

### Admin Panelini Açın

```
http://localhost:3000
```

### Kiosk Uygulamasını Başlatın

```bash
cd your_kiosk_project
# Kiosk uygulamanızı başlatın
```

### Kontrol Listesi

Tarayıcı konsolunda şunları görmelisiniz:

1. ✅ `🔧 Inmapper Kiosk Client başlatılıyor...`
2. ✅ `✅ Fingerprint: xxxxxxxx`
3. ✅ `✅ Cihaz kaydedildi: device-id`
4. ✅ `✅ Yapılandırma yüklendi`
5. ✅ `✅ Slider güncellendi`

---

## 🎯 Kullanım Senaryoları

### Senaryo 1: Farklı Katlara Farklı İçerik

1. Admin panelde "1. Kat" landing page'i oluşturun
2. 1. kata ait mağaza görsellerini ekleyin
3. 1. kattaki kiosk cihazlarını bu landing page'e atayın
4. Diğer katlar için tekrarlayın

### Senaryo 2: Kampanya Dönemleri

1. "Yılsonu İndirimi" landing page'i oluşturun
2. Kampanya görsellerini ekleyin
3. Kampanya döneminde tüm kiosk'ları bu landing page'e atayın
4. Kampanya bitince normal landing page'e geri alın

### Senaryo 3: Özel Etkinlikler

1. Konser, fuar vb. için özel landing page oluşturun
2. Etkinlik görsellerini ve bilgilerini ekleyin
3. Etkinlik süresince aktif tutun

---

## 🐛 Sorun Giderme

### Yapılandırma Yüklenmiyor

```
❌ Kiosk Client başlatılamadı
```

**Çözüm:**
1. Backend sunucusunun çalıştığını kontrol edin
2. `KIOSK_BACKEND_URL` adresinin doğru olduğundan emin olun
3. CORS ayarlarını kontrol edin
4. Network sekmesinde hataları inceleyin

### Slider Güncellenmiyor

```
filmStrip elementi bulunamadı!
```

**Çözüm:**
1. HTML'de `id="filmStrip"` olan element olduğundan emin olun
2. Script'in DOM yüklendikten sonra çalıştığından emin olun

### Cihaz Kaydedilmiyor

**Çözüm:**
1. FingerprintJS CDN'in yüklendiğinden emin olun
2. Internet bağlantısını kontrol edin
3. Backend'in `/api/devices/register` endpoint'ini test edin

---

## 🔐 Güvenlik

### Production Ortamında

1. **HTTPS Kullanın**
   ```javascript
   const KIOSK_BACKEND_URL = 'https://your-secure-domain.com';
   ```

2. **CORS Ayarları**
   Backend'de sadece kiosk domain'lerine izin verin:
   ```
   CORS_ORIGINS=https://kiosk1.example.com,https://kiosk2.example.com
   ```

3. **Rate Limiting**
   API isteklerini sınırlandırın

---

## 📞 Destek

Sorularınız için:
- GitHub Issues açın
- support@inmapper.com adresine e-posta gönderin

---

<div align="center">

**inMapper Kiosk System** - Profesyonel Dijital Signage

</div>
