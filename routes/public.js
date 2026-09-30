/**
 * Kiosk'un kimlik doğrulaması olmadan tükettiği uçlar.
 *
 * Kiosk frontend'i tek bir derlemedir; hangi venue olduğunu URL'den öğrenir ve
 * çalışma zamanı config'ini buradan çeker. Böylece her venue için ayrı bir
 * build ya da elle kopyalanan config.js/geojson dosyası gerekmez.
 */

const express = require('express');
const Venue = require('../models/Venue');
const { resolveVenueGeojsonText } = require('../services/venue-map-store');
const { readStoredVenueMedia } = require('../services/venue-media-store');
const {
  readCampaignMedia,
  resolveCampaignKey,
  contentTypeForKey,
} = require('../services/campaign-media-store');
const { venueContentSignature } = require('../utils/venue-content-signature');

const router = express.Router();
const { rateLimit } = require('../middleware/rate-limit');

const timeRateLimit = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'public-time' });
const campaignMediaRateLimit = rateLimit({ windowMs: 60_000, max: 300, keyPrefix: 'public-campaign-media' });

/** Kiosk'un bu backend'e geri dönebilmesi için mutlak taban adres. */
function publicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

async function findActiveVenue(slug) {
  return Venue.findOne({
    slug: String(slug || '').trim().toLowerCase(),
    isActive: { $ne: false },
  }).lean();
}

/**
 * İmza için gereken alanlar.
 *
 * `findActiveVenue` tüm dokümanı okuyor; içinde editörden gelen config'in
 * tamamı var. İmza ucunun tek amacı ucuz olmak, o yüzden burada yalnızca
 * imzaya giren alanlar çekilir (bkz. utils/venue-content-signature).
 */
const SIGNATURE_FIELDS = [
  'geojson',
  'geojsonPath',
  'kioskConfig.updatedAt',
  'mapConfig.updatedAt',
  'media.logo.checksum',
  'updatedAt',
].join(' ');

async function findVenueForSignature(slug) {
  return Venue.findOne({
    slug: String(slug || '').trim().toLowerCase(),
    isActive: { $ne: false },
  })
    .select(SIGNATURE_FIELDS)
    .lean();
}

/**
 * GET /api/public/app-config
 *
 * Panelin derleme zamanında bilemediği dış adresler. Kiosk web servisinin
 * adresi deploy'a göre değiştiği için panele sabit yazmak yerine buradan
 * okutuyoruz.
 */
router.get('/app-config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    kioskWebUrl: (process.env.KIOSK_WEB_URL || '').trim().replace(/\/+$/, ''),
  });
});

/**
 * GET /api/public/time
 * Kiosk clock skew ölçümü — auth yok, rate-limit var.
 */
router.get('/time', timeRateLimit, (req, res) => {
  const now = Date.now();
  res.set('Cache-Control', 'no-store');
  res.json({
    serverTime: new Date(now).toISOString(),
    unixMs: now,
  });
});

/**
 * GET /api/public/venues/:slug/runtime-config
 *
 * Kiosk'un kendi derlenmiş config'inin üzerine derin birleştireceği parça.
 * Sunucudan türeyen alanlar (geojson adresi, sheet ayarları, slug) saklanan
 * config'i ezer; aksi halde derleme varsayılanındaki sheetId başka mekâna
 * sızar. Sheet kaynağı Venue.sheets'tir — panelde oluştururken ve editör
 * "venue'ya kaydet" ile (applyVenueSheetsFromConfig) güncellenir.
 */
router.get('/venues/:slug/runtime-config', async (req, res) => {
  try {
    const venue = await findActiveVenue(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Venue bulunamadı' });

    const base = publicBaseUrl(req);
    const stored = venue.kioskConfig?.config || {};
    const overrides = {
      venue: {
        name: venue.name,
        geojsonPath: `${base}/api/public/venues/${venue.slug}/geojson`,
        sheets: {
          sheetId: venue.sheets?.sheetId || '',
          tabs: {
            list: venue.sheets?.tabs?.list || '',
            categories: venue.sheets?.tabs?.categories || '',
            info: venue.sheets?.tabs?.info || '',
            changes: venue.sheets?.tabs?.changes || '',
          },
          writeEndpointUrl: venue.sheets?.writeEndpointUrl || '',
          gid: venue.sheets?.gid || '',
        },
        routing: { venueSlug: venue.slug },
      },
      api: {
        baseUrl: base,
      },
    };

    if (venue.floorMap && Object.keys(venue.floorMap).length) {
      overrides.venue.floorMap = venue.floorMap;
    }
    if (venue.media?.baseUrl) {
      overrides.venue.mediaBaseUrl = venue.media.baseUrl;
    }
    const branding = {};
    // Logo yüklüyse derlemedeki göreli 'assets/logo.png' yerine bu venue'nun
    // kendi logosu kullanılır; checksum sorgu parametresi olarak eklenir, böylece
    // dosya güncellendiğinde tarayıcı önbelleği kendiliğinden geçersizleşir.
    if (venue.media?.logo?.storageKey) {
      const version = venue.media.logo.checksum
        ? `?v=${venue.media.logo.checksum.slice(0, 12)}`
        : '';
      branding.logo = `${base}/api/public/venues/${venue.slug}/media/logo${version}`;
    }
    // Editörden henüz config kaydedilmemişse kiosk gömülü marka metnini
    // kullanır; o metin de derlemeyi üreten venue'ya (Zorlu) ait. Yeni bir
    // venue'nun başka bir mekânın adıyla açılmaması için venue adına düşüyoruz.
    if (!stored.branding) {
      branding.title = venue.name;
      branding.subtitle = '';
    }
    if (Object.keys(branding).length) {
      overrides.branding = branding;
    }
    // Panelden ayrıca yüklenmiş bir harita config'i, kiosk config'inin içindeki
    // features.map'ten daha güncel olabilir.
    if (venue.mapConfig?.map) {
      overrides.features = { map: venue.mapConfig.map };
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      slug: venue.slug,
      name: venue.name,
      timezone: venue.timezone || 'Europe/Istanbul',
      updatedAt: venue.kioskConfig?.updatedAt || venue.mapConfig?.updatedAt || null,
      config: stored,
      overrides,
    });
  } catch (err) {
    console.error('GET public runtime-config', err);
    res.status(500).json({ error: 'Runtime config alınamadı' });
  }
});

/**
 * GET /api/public/venues/:slug/content-signature
 *
 * İçeriğin değişip değişmediğini ucuza sormak için. Web ve mobil yüzeyler
 * tazeliği periyodik yokluyor; bunu `runtime-config` ile yapmak her turda
 * ~15 KB taşımak demek ve eşzamanlı ziyaretçi sayısı yüksek olduğunda
 * anlamsız bir yük doğuruyor. Buradaki yanıt onlarca bayt, dolayısıyla
 * yoklama çok daha sık yapılabiliyor.
 *
 * Dönen değer yalnızca bir TETİKLEYİCİ: değiştiğini gören istemci asıl
 * revizyonu kendi hesabıyla belirliyor (bkz. kiosk content-version.js).
 * Kasıtlı olarak istemcinin revizyon hash'iyle aynı değer değil — aynı
 * formülü iki depoda sürdürmek, biri değiştiğinde sessiz bir uyuşmazlık
 * doğurur.
 */
router.get('/venues/:slug/content-signature', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const venue = await findVenueForSignature(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Venue bulunamadı' });

    res.json({ signature: venueContentSignature(venue) });
  } catch (err) {
    console.error('GET public content-signature', err);
    res.status(500).json({ error: 'İçerik imzası alınamadı' });
  }
});

/** GET /api/public/venues/:slug/geojson */
router.get('/venues/:slug/geojson', async (req, res) => {
  try {
    const venue = await findActiveVenue(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Venue bulunamadı' });

    if (venue.geojson?.checksum) res.set('ETag', `"${venue.geojson.checksum}"`);
    res.set('Cache-Control', 'public, max-age=60');

    // Harita 150 KB'ın üzerinde; değişmediyse depodan okumaya bile gerek yok.
    if (res.get('ETag') && req.fresh) {
      return res.status(304).end();
    }

    const content = await resolveVenueGeojsonText(venue);
    if (!content) return res.status(404).json({ error: 'Bu venue için harita tanımlı değil' });

    res.type('application/geo+json').send(content);
  } catch (err) {
    console.error('GET public geojson', err);
    res.status(500).json({ error: 'Harita alınamadı' });
  }
});

/**
 * GET /api/public/venues/:slug/media/logo
 *
 * Bucket'ı herkese açmamak için dosya buradan geçirilir. ETag ile koşullu istek
 * desteklenir: adres sabit kaldığı için kiosk'un logoyu her açılışta yeniden
 * indirmesi gerekmez.
 */
router.get('/venues/:slug/media/logo', async (req, res) => {
  try {
    const venue = await findActiveVenue(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Venue bulunamadı' });

    const logo = venue.media?.logo;
    if (!logo?.storageKey) return res.status(404).json({ error: 'Bu venue için logo tanımlı değil' });

    if (logo.checksum) res.set('ETag', `"${logo.checksum}"`);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');

    // req.fresh, If-None-Match'i RFC'ye göre çözer: alıntı işaretleri, W/ önekli
    // zayıf doğrulayıcılar ve virgülle ayrılmış listeler dahil. Elle karşılaştırma
    // bunları kaçırıp gereksiz yere tüm dosyayı yeniden gönderiyordu.
    if (res.get('ETag') && req.fresh) {
      return res.status(304).end();
    }

    const buffer = await readStoredVenueMedia(logo.storageKey);
    res.type(logo.contentType || 'application/octet-stream').send(buffer);
  } catch (err) {
    console.error('GET public venue logo', err);
    res.status(500).json({ error: 'Logo alınamadı' });
  }
});

/**
 * GET /api/public/venues/:slug/campaign-media/:filename
 * Kampanya slider medyası (auth yok).
 */
router.get('/venues/:slug/campaign-media/:filename', campaignMediaRateLimit, async (req, res) => {
  try {
    const venue = await findActiveVenue(req.params.slug);
    if (!venue) return res.status(404).json({ error: 'Venue bulunamadı' });

    const key = resolveCampaignKey(venue._id, req.params.filename);
    // Venue izolasyonu: key bu venue'ya ait olmalı
    if (!key.startsWith(`campaign-media/${String(venue._id)}/`)) {
      return res.status(404).json({ error: 'Medya bulunamadı' });
    }

    const { buffer } = await readCampaignMedia(key);
    const contentType = contentTypeForKey(key);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(contentType).send(buffer);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.code === 'ENOENT' || err.code === 404) {
      return res.status(404).json({ error: 'Medya bulunamadı' });
    }
    console.error('GET public campaign-media', err);
    res.status(500).json({ error: 'Medya alınamadı' });
  }
});

module.exports = router;
