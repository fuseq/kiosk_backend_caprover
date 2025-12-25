# 🗺️ inMapper Kiosk Backend

<div align="center">

![inMapper Logo](https://img.shields.io/badge/inMapper-Kiosk%20Manager-3b82f6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=)

**Profesyonel Kiosk Yönetim Sistemi**

Kiosk cihazlarınız için merkezi landing page ve içerik yönetimi.

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com/)
[![Express](https://img.shields.io/badge/Express-4.18-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com/)
[![CapRover](https://img.shields.io/badge/CapRover-Compatible-00758F?style=flat-square)](https://caprover.com/)

</div>

---

## ✨ Özellikler

- 🖥️ **Merkezi Yönetim Paneli** - Modern ve profesyonel admin arayüzü
- 📱 **Cihaz Takibi** - FingerprintJS ile benzersiz cihaz tanımlama
- 🎨 **Landing Page Yönetimi** - Her kiosk için özel slider yapılandırması
- 🗄️ **MongoDB Veritabanı** - Güvenilir ve ölçeklenebilir veri depolama
- 🔄 **Gerçek Zamanlı Güncelleme** - Değişiklikler anında tüm cihazlara yansır
- 📊 **Dashboard & İstatistikler** - Cihaz ve içerik durumu takibi
- 🐳 **Docker & CapRover Desteği** - Kolay deployment

---

## 🚀 Hızlı Başlangıç

### Docker Compose ile (Önerilen)

```bash
# Servisleri başlat (MongoDB + Backend)
docker-compose up -d

# Logları görüntüle
docker-compose logs -f

# Servisleri durdur
docker-compose down
```

Servisler başladığında:
- **Admin Panel**: http://localhost:3000
- **API**: http://localhost:3000/api
- **MongoDB**: localhost:27017

### Manuel Kurulum

```bash
# Bağımlılıkları yükle
npm install

# MongoDB'nin çalıştığından emin olun
# Örnek: Docker ile MongoDB başlatma
docker run -d -p 27017:27017 --name mongodb mongo:7

# Environment variables ayarla
export MONGODB_URI=mongodb://localhost:27017/inmapper_kiosk

# Sunucuyu başlat
npm start

# veya geliştirme modunda
npm run dev
```

### Örnek Verilerle Başlat

```bash
npm run db:seed
```

---

## 🐳 CapRover Deployment

### 1. MongoDB Kurulumu

CapRover panelinden **One-Click Apps** bölümüne gidin ve **MongoDB** uygulamasını kurun.

Veya CLI ile:

```bash
caprover deploy --appName srv-captain--mongodb
```

### 2. Backend Uygulaması Oluşturma

```bash
# CapRover CLI ile login
caprover login

# Yeni uygulama oluştur
caprover apps register --appName inmapper-kiosk-backend
```

### 3. Environment Variables

CapRover panelinden uygulamanızın **App Configs** bölümüne gidin:

```env
NODE_ENV=production
PORT=3000
MONGODB_URI=mongodb://srv-captain--mongodb:27017/inmapper_kiosk
CORS_ORIGINS=*
LOG_LEVEL=info
```

> ⚠️ MongoDB kullanıcı adı/şifre kullanıyorsanız:
> ```env
> MONGODB_URI=mongodb://username:password@srv-captain--mongodb:27017/inmapper_kiosk?authSource=admin
> ```

### 4. Deployment

```bash
caprover deploy
```

### 5. SSL Sertifikası

CapRover panelinden **Enable HTTPS** seçeneğini aktif edin.

---

## 📡 API Endpoints

### Cihaz Yönetimi

| Metod | Endpoint | Açıklama |
|-------|----------|----------|
| `POST` | `/api/devices/register` | Cihaz kaydı |
| `GET` | `/api/devices` | Tüm cihazları listele |
| `GET` | `/api/devices/:id/config` | Cihaz yapılandırmasını al |
| `PUT` | `/api/devices/:id` | Cihazı güncelle |
| `DELETE` | `/api/devices/:id` | Cihazı sil |

### Landing Page Yönetimi

| Metod | Endpoint | Açıklama |
|-------|----------|----------|
| `GET` | `/api/landing-pages` | Tüm landing page'leri listele |
| `GET` | `/api/landing-pages/:id` | Tek landing page detayı |
| `POST` | `/api/landing-pages` | Yeni landing page oluştur |
| `PUT` | `/api/landing-pages/:id` | Landing page güncelle |
| `DELETE` | `/api/landing-pages/:id` | Landing page sil |
| `POST` | `/api/landing-pages/:id/assign-devices` | Cihaz ata |

### Sistem

| Metod | Endpoint | Açıklama |
|-------|----------|----------|
| `GET` | `/health` | Sunucu sağlık durumu |
| `GET` | `/ready` | Hazırlık durumu (DB bağlantısı dahil) |
| `GET` | `/api/stats` | İstatistikler |

---

## 🌍 Environment Variables

| Değişken | Varsayılan | Açıklama |
|----------|------------|----------|
| `PORT` | `3000` | Sunucu portu |
| `NODE_ENV` | `development` | Ortam |
| `MONGODB_URI` | - | MongoDB bağlantı URI'si |
| `MONGODB_HOST` | `localhost` | MongoDB host (URI yoksa) |
| `MONGODB_PORT` | `27017` | MongoDB port (URI yoksa) |
| `MONGODB_DATABASE` | `inmapper_kiosk` | Veritabanı adı |
| `MONGODB_USERNAME` | - | MongoDB kullanıcı adı |
| `MONGODB_PASSWORD` | - | MongoDB şifresi |
| `CORS_ORIGINS` | `*` | İzin verilen originler |
| `LOG_LEVEL` | `info` | Log seviyesi |

---

## 📁 Proje Yapısı

```
inmapper_kiosk_backend/
├── server.js              # Ana sunucu dosyası
├── config/
│   └── database.js        # MongoDB bağlantı yapılandırması
├── models/
│   ├── index.js           # Model exports
│   ├── Device.js          # Cihaz modeli
│   └── LandingPage.js     # Landing page modeli
├── scripts/
│   ├── seed.js            # Örnek veri oluşturma
│   └── mongo-init.js      # MongoDB initialization
├── public/
│   ├── index.html         # Admin panel HTML
│   ├── style.css          # Admin panel stilleri
│   └── script.js          # Admin panel JavaScript
├── integration/
│   └── INTEGRATION_GUIDE.md
├── kiosk-client.js        # Kiosk cihazları için client
├── Dockerfile             # Docker yapılandırması
├── docker-compose.yml     # Docker Compose
├── captain-definition     # CapRover yapılandırması
└── package.json
```

---

## 📊 Veritabanı Şeması

### Device Collection

```javascript
{
  _id: ObjectId,
  fingerprint: String (unique),
  name: String,
  deviceInfo: {
    userAgent: String,
    screenResolution: String,
    language: String,
    platform: String
  },
  status: 'online' | 'idle' | 'offline',
  location: {
    floor: String,
    zone: String,
    description: String
  },
  tags: [String],
  isActive: Boolean,
  lastSeen: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### LandingPage Collection

```javascript
{
  _id: ObjectId,
  name: String (required),
  description: String,
  devices: [ObjectId] (ref: Device),
  slides: [{
    imageUrl: String (required),
    title: String,
    description: String,
    order: Number,
    isActive: Boolean
  }],
  transitionDuration: Number (1000-60000),
  transitionEffect: 'fade' | 'slide' | 'zoom',
  isDefault: Boolean,
  isActive: Boolean,
  schedule: {
    enabled: Boolean,
    startDate: Date,
    endDate: Date,
    startTime: String,
    endTime: String
  },
  styling: {
    backgroundColor: String,
    overlayOpacity: Number
  },
  tags: [String],
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🔧 Kiosk Client Entegrasyonu

### 1. Script'leri Ekleyin

```html
<script src="https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@3/dist/fp.min.js"></script>
<script src="kiosk-client.js"></script>
```

### 2. Client'ı Başlatın

```javascript
KioskClient.init({
  apiUrl: 'https://your-backend-url.com',
  pollInterval: 60000,
  onConfigLoaded: (config) => {
    console.log('Config loaded:', config);
    // Slider güncelleme işlemleri
  },
  onError: (error) => {
    console.error('Error:', error);
  }
});
```

---

## 🎯 Kullanım Senaryoları

### Kata Özel İçerik
Her AVM katı için farklı landing page oluşturun ve o kattaki kiosk'ları ilgili landing page'e atayın.

### Zamanlı Kampanyalar
Özel günler için kampanya landing page'leri oluşturup tüm kiosk'lara hızlıca uygulayın.

### A/B Testi
Farklı içeriklerin etkisini test etmek için kiosk'ları gruplara ayırın.

---

## 🔐 Güvenlik Önerileri

Production ortamında:
- ✅ HTTPS kullanın
- ✅ MongoDB authentication aktif edin
- ✅ Rate limiting ekleyin
- ✅ API authentication implementasyonu yapın
- ✅ Firewall kuralları belirleyin
- ✅ Düzenli veritabanı yedeklemesi yapın

---

## 🛠️ Bakım & Yedekleme

### MongoDB Yedekleme

```bash
# Yedekleme
docker exec inmapper-mongodb mongodump --out /backup

# Geri yükleme
docker exec inmapper-mongodb mongorestore /backup
```

### Logları Görüntüleme

```bash
# Tüm loglar
docker-compose logs -f

# Sadece backend
docker-compose logs -f backend

# Sadece MongoDB
docker-compose logs -f mongodb
```

---

## 📄 Lisans

ISC License - [inMapper](https://inmapper.com)

---

<div align="center">

**inMapper Kiosk Backend v2.0** - Profesyonel Dijital Signage Çözümü

Made with ❤️ by inMapper Team

</div>
