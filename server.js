/**
 * ============================================
 * Inmapper Kiosk Backend Server
 * Production-Ready Express.js + MongoDB Application
 * ============================================
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connectDB, isConnected } = require('./config/database');
const { Device, LandingPage, Venue, User, Tenant } = require('./models');
const { requireAuth } = require('./middleware/auth');
const { venueScopeFilter } = require('./routes/helpers');
const { attachAccessHelpers } = require('./middleware/access');
const { runMigrations, resolveDefaultVenueId } = require('./scripts/migrate');
const { loadUnits } = require('./services/unit-manager');
const { mapUnitAdPayload, isUnitAdActive } = require('./utils/ad-schedule');
const { listRecentActivities } = require('./services/activity-log');

const devicesRouter = require('./routes/devices');
const landingPagesRouter = require('./routes/landing-pages');
const deviceGroupsRouter = require('./routes/device-groups');
const authRouter = require('./routes/auth');
const venuesRouter = require('./routes/venues');
const publicRouter = require('./routes/public');

// ============================================
// Configuration
// ============================================
const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  logLevel: process.env.LOG_LEVEL || 'info'
};

// ============================================
// Express App Setup
// ============================================
const app = express();

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // SAMEORIGIN: admin panel içinde venue-manager iframe gömülebilir
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (config.corsOrigins === '*') return callback(null, true);
    const allowedOrigins = config.corsOrigins.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Token'],
  credentials: true
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (config.logLevel === 'debug' || (config.logLevel === 'info' && duration > 1000)) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ============================================
// Health + API info
// ============================================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    database: isConnected() ? 'connected' : 'disconnected'
  });
});

app.get('/ready', (req, res) => {
  if (isConnected()) {
    res.status(200).json({ status: 'ready', database: 'connected' });
  } else {
    res.status(503).json({ status: 'not ready', database: 'disconnected' });
  }
});

app.get('/api', (req, res) => {
  res.json({
    name: 'Inmapper Kiosk Backend API',
    version: '2.1.0',
    database: 'MongoDB',
    endpoints: {
      devices: '/api/devices',
      landingPages: '/api/landing-pages',
      deviceGroups: '/api/device-groups',
      venues: '/api/venues',
      auth: '/api/auth',
      stats: '/api/stats',
      health: '/health',
      ready: '/ready'
    }
  });
});

// ============================================
// API Routers
// ============================================
app.use('/api/devices', devicesRouter);
app.use('/api/landing-pages', landingPagesRouter);
app.use('/api/device-groups', deviceGroupsRouter);
app.use('/api/auth', authRouter);
app.use('/api/venues', attachAccessHelpers, venuesRouter);
app.use('/api/public', publicRouter);

// ============================================
// Statistics (auth required)
// ============================================
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;
    const isAdmin = req.user?.role === 'admin';

    const scope = await venueScopeFilter(req.user, req.query.venueId);
    if (scope._id === null) {
      return res.json({
        totalDevices: 0,
        activeDevices: 0,
        recentDevices: 0,
        pendingDevices: 0,
        totalLandingPages: 0,
        totalSlides: 0,
        totalVenues: 0,
        mapsReady: 0,
        totalTenants: 0,
        activeUnitAds: 0,
        unitAds: 0,
        activity: [],
      });
    }

    const baseFilter = { isActive: true, ...scope };
    const venueIdFilter = scope.venueId;
    const venueQuery = { isActive: true, _id: venueIdFilter?.$in ? { $in: venueIdFilter.$in } : venueIdFilter };

    const pendingQuery = isAdmin
      ? { enrollmentStatus: 'pending', isActive: true }
      : { enrollmentStatus: 'pending', isActive: true, ...scope };

    const [
      totalDevices,
      totalLandingPages,
      devices,
      pendingDevices,
      landingPages,
      venues,
      totalTenants,
    ] = await Promise.all([
      Device.countDocuments({ ...baseFilter, enrollmentStatus: { $ne: 'revoked' } }),
      LandingPage.countDocuments(baseFilter),
      Device.find({ ...baseFilter, enrollmentStatus: 'active' }).select('lastSeen name displayId'),
      Device.countDocuments(pendingQuery),
      LandingPage.find(baseFilter).select('slides name updatedAt createdAt'),
      Venue.find(venueQuery).select('name slug geojson geojsonPath updatedAt createdAt mapConfig').lean(),
      isAdmin ? Tenant.countDocuments({}) : Promise.resolve(0),
    ]);

    const activeDevices = devices.filter(d => d.lastSeen && (now - new Date(d.lastSeen).getTime()) < fiveMinutes).length;
    const recentDevices = devices.filter(d => d.lastSeen && (now - new Date(d.lastSeen).getTime()) < oneDay).length;
    const totalSlides = landingPages.reduce(
      (sum, lp) => sum + (lp.slides?.filter(s => s.isActive !== false).length || 0), 0
    );
    const mapsReady = venues.filter(v => v.geojson?.storageKey || v.geojsonPath).length;

    let activeUnitAds = 0;
    let unitAds = 0;

    await Promise.all(venues.map(async (venue) => {
      try {
        const { rows } = await loadUnits(venue);
        for (const row of rows) {
          const id = String(row.ID || row.id || '').trim();
          if (!id) continue;
          const ad = mapUnitAdPayload(row);
          if (!ad.images?.length || !ad.adSchedule) continue;
          unitAds += 1;
          if (ad.adActive || isUnitAdActive(row)) activeUnitAds += 1;
        }
      } catch (err) {
        console.warn(`Stats unit-ads load failed for ${venue.slug || venue._id}:`, err.message);
      }
    }));

    const venueIds = venues.map(v => String(v._id));
    const activity = await listRecentActivities({
      venueIds,
      includeGlobal: isAdmin && !req.query.venueId,
      limit: 20,
    });

    res.json({
      totalDevices,
      activeDevices,
      recentDevices,
      pendingDevices,
      totalLandingPages,
      totalSlides,
      totalVenues: venues.length,
      mapsReady,
      totalTenants,
      activeUnitAds,
      unitAds,
      activity,
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============================================
// Error Handling
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined
  });
});

app.post('/api/admin/reset-database', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Yalnızca admin veritabanını sıfırlayabilir' });
    }
    const { confirmCode } = req.body;
    if (confirmCode !== 'RESET_DB_2024') {
      return res.status(403).json({ error: 'Invalid confirmation code' });
    }
    const deviceResult = await Device.deleteMany({});
    const lpResult = await LandingPage.deleteMany({});
    res.json({
      success: true,
      message: 'Database reset complete',
      deleted: { devices: deviceResult.deletedCount, landingPages: lpResult.deletedCount }
    });
  } catch (error) {
    console.error('❌ Database reset error:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================
// Server Startup
// ============================================
async function startServer() {
  try {
    await connectDB();
    await runMigrations();

    const defaultVenueId = await resolveDefaultVenueId();

    const count = await LandingPage.countDocuments();
    if (count === 0 && defaultVenueId) {
      await LandingPage.create({
        venueId: defaultVenueId,
        name: 'Varsayılan Landing Page',
        isDefault: true,
        slides: [{
          imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920&q=80',
          title: 'Hoş Geldiniz',
          order: 0
        }],
        transitionDuration: 8000
      });
      console.log('📄 Default landing page created');
    }

    // Venue'ler yalnızca admin API'si üzerinden yönetilir. Buradaki eski
    // VENUE_* env senkronizasyonu her cold start'ta tek bir venue'nin sheets
    // ayarlarını env değeriyle ezdiği için multi-tenant kurulumda kaldırıldı.

    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@inmapper.com').toLowerCase();
    const adminExists = await User.findOne({ role: 'admin' });
    if (!adminExists) {
      const adminPassword = process.env.ADMIN_PASSWORD
        || (config.nodeEnv === 'production' ? null : 'admin123');
      if (!adminPassword) {
        throw new Error('ADMIN_PASSWORD is required in production to seed the first admin user');
      }
      const passwordHash = await User.hashPassword(adminPassword);
      await User.create({
        email: adminEmail,
        name: 'Admin',
        passwordHash,
        role: 'admin'
      });
      console.log(`👤 Admin user created: ${adminEmail}`);
    }

    const server = app.listen(config.port, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║   🚀  INMAPPER KIOSK BACKEND SERVER                          ║
║   Environment: ${config.nodeEnv.padEnd(43)}║
║   Port: ${String(config.port).padEnd(51)}║
║   📡 API:    http://localhost:${config.port}/api${' '.repeat(27)}║
║   🎨 Admin:  http://localhost:${config.port}${' '.repeat(31)}║
╚══════════════════════════════════════════════════════════════╝
      `);
    });

    const gracefulShutdown = async (signal) => {
      console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        const { disconnectDB } = require('./config/database');
        await disconnectDB();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
