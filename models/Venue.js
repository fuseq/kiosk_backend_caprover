const mongoose = require('mongoose');

const unitAttributeSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['text', 'textarea', 'tel', 'url', 'email', 'number', 'floor', 'categories'],
    default: 'text'
  },
  required: { type: Boolean, default: false },
  visible: { type: Boolean, default: true },
  editable: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  placeholder: { type: String, default: '' },
  hint: { type: String, default: '' },
  rows: { type: Number, default: 3 },
  altKeys: [{ type: String }],
  custom: { type: Boolean, default: false }
}, { _id: false });

/**
 * Önceki yayınlanmış içerik (harita + config) kopyası. Dosyaların kendisi
 * depoda (`geojsonKey` / `configKey`); burada yalnızca listeleme üstverisi.
 * Bkz. services/venue-map-history.js.
 */
const mapHistoryEntrySchema = new mongoose.Schema({
  id: { type: String, required: true },
  savedAt: { type: Date, default: null },
  savedBy: { type: String, default: '' },
  archivedAt: { type: Date, default: null },
  archivedBy: { type: String, default: '' },
  reason: { type: String, enum: ['save', 'url', 'restore', 'delete'], default: 'save' },
  originalFileName: { type: String, default: '' },
  featureCount: { type: Number, default: 0 },
  roomCount: { type: Number, default: 0 },
  floors: [{ type: String }],
  sizeBytes: { type: Number, default: 0 },
  checksum: { type: String, default: '' },
  configChecksum: { type: String, default: '' },
  geojsonKey: { type: String, required: true },
  configKey: { type: String, required: true },
}, { _id: false });

/**
 * Venue — tenant-ready root entity. Each venue owns one Google Sheet document.
 * Future: Tenant { venues[], billing, media storage bucket }.
 */
const venueSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, trim: true, index: true },
  name: { type: String, required: true, trim: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
  timezone: { type: String, default: 'Europe/Istanbul' },
  sheets: {
    sheetId: { type: String, required: true },
    tabs: {
      list: { type: String, default: '' },
      categories: { type: String, default: '' },
      info: { type: String, default: '' },
      changes: { type: String, default: '' }
    },
    writeEndpointUrl: { type: String, default: '' },
    gid: { type: String, default: '' }
  },
  media: {
    uploadEnabled: { type: Boolean, default: false },
    /** Sheet'teki göreli logo yollarının çözüleceği taban adres. */
    baseUrl: { type: String, default: '' },
    /**
     * Venue marka logosu. Kiosk derlemesindeki `branding.logo` göreli bir yol
     * taşıdığı için imaja gömülüydü; burada tanımlıysa runtime-config onu
     * mutlak adresle ezer ve imaj venue'dan bağımsız kalır.
     */
    logo: {
      storageKey: { type: String, default: '' },
      contentType: { type: String, default: '' },
      originalFileName: { type: String, default: '' },
      sizeBytes: { type: Number, default: 0 },
      checksum: { type: String, default: '' },
      updatedAt: { type: Date, default: null },
      updatedBy: { type: String, default: '' }
    }
  },
  /** Venue Manager harita katmanı (public/ altında göreli yol veya tam URL). */
  geojsonPath: { type: String, default: '' },
  /** Yönetilen GeoJSON kaynağı ve doğrulama özeti. */
  geojson: {
    sourceType: { type: String, enum: ['', 'upload', 'url'], default: '' },
    sourceUrl: { type: String, default: '' },
    originalFileName: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    featureCount: { type: Number, default: 0 },
    roomCount: { type: Number, default: 0 },
    floors: [{ type: String }],
    sizeBytes: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' }
  },
  /** Kat adı → GeoJSON feature id eşlemesi. */
  floorMap: { type: mongoose.Schema.Types.Mixed, default: {} },
  /**
   * Editor'dan export edilen config.js içindeki features.map.
   * Birim Yönetimi harita görünümü bu ayarları kullanır.
   */
  mapConfig: {
    map: { type: mongoose.Schema.Types.Mixed, default: null },
    originalFileName: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' },
  },
  /**
   * Editor'dan gelen config'in tamamı (tema, branding, navigation, features…).
   * Kiosk bunu /api/public/venues/:slug/runtime-config üzerinden alır, böylece
   * her venue için ayrı bir frontend derlemesi gerekmez.
   */
  kioskConfig: {
    config: { type: mongoose.Schema.Types.Mixed, default: null },
    originalFileName: { type: String, default: '' },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: String, default: '' },
  },
  /** Son yayınlanmış içerik sürümleri, en yenisi başta (en fazla 3). */
  mapHistory: { type: [mapHistoryEntrySchema], default: [] },
  /** Venue Manager'da müşterinin görebileceği/düzenleyebileceği Sheet kolonları. */
  unitAttributes: { type: [unitAttributeSchema], default: [] },
  /** Müşteri kullanıcısı birimi aktif/kapalı yapabilir mi? */
  unitStatusEditable: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Venue', venueSchema);
