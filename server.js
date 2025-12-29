/**
 * ============================================
 * Inmapper Kiosk Backend Server
 * Production-Ready Express.js + MongoDB Application
 * ============================================
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connectDB, isConnected } = require('./config/database');
const { Device, LandingPage } = require('./models');

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

// Trust proxy for proper IP detection behind reverse proxy
app.set('trust proxy', 1);

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins in development or if CORS_ORIGINS is '*'
    if (config.corsOrigins === '*') {
      return callback(null, true);
    }
    
    // Check against allowed origins
    const allowedOrigins = config.corsOrigins.split(',').map(o => o.trim());
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Body parsing
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static('public'));

// Request logging (production-friendly)
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
// Health Check Endpoints
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

// ============================================
// API Info Endpoint
// ============================================
app.get('/api', (req, res) => {
  res.json({
    name: 'Inmapper Kiosk Backend API',
    version: '2.0.0',
    database: 'MongoDB',
    endpoints: {
      devices: '/api/devices',
      landingPages: '/api/landing-pages',
      stats: '/api/stats',
      health: '/health',
      ready: '/ready'
    }
  });
});

// ============================================
// DEVICE ENDPOINTS
// ============================================

// Register or update device
app.post('/api/devices/register', async (req, res) => {
  try {
    const { fingerprint, deviceInfo } = req.body;
    
    console.log('📱 Device registration request:', { fingerprint, userAgent: deviceInfo?.userAgent?.substring(0, 50) });
    console.log('🌐 Origin:', req.get('origin') || 'no-origin');
    
    if (!fingerprint) {
      return res.status(400).json({ error: 'Fingerprint is required' });
    }
    
    const device = await Device.findOrCreateByFingerprint(fingerprint, deviceInfo);
    
    console.log('✅ Device registered/updated:', device._id);
    
    res.json({ 
      device: {
        id: device._id,
        ...device.toObject()
      }
    });
  } catch (error) {
    console.error('❌ Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Get device configuration
app.get('/api/devices/:deviceId/config', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    console.log(`📡 Config request for device: ${deviceId}`);
    
    const device = await Device.findById(deviceId);
    if (!device) {
      console.log(`❌ Device not found: ${deviceId}`);
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Update last seen
    device.lastSeen = new Date();
    await device.save();
    
    // Bu cihaza atanmış landing page'i bul (deviceIds arrayinde ara)
    const landingPage = await LandingPage.findOne({
      deviceIds: deviceId,
      isActive: true
    });
    
    // Device bilgisi (displayId dahil)
    const deviceInfo = {
      id: device._id,
      displayId: device.displayId,
      name: device.name
    };
    
    // Cihaza atanmış landing page yoksa null döndür
    if (!landingPage) {
      console.log(`⚠️ No landing page assigned to device: ${deviceId} (displayId: ${device.displayId})`);
      return res.json({
        device: deviceInfo,
        landingPage: null,
        isAssigned: false,
        message: 'No landing page assigned to this device'
      });
    }
    
    console.log(`✅ Found landing page for device ${deviceId} (displayId: ${device.displayId}): ${landingPage.name}`);
    console.log(`📷 Slides count: ${landingPage.slides?.length || 0}`);
    
    res.json({ 
      device: deviceInfo,
      landingPage: {
        id: landingPage._id,
        name: landingPage.name,
        slides: landingPage.slides || [],
        transitionDuration: landingPage.transitionDuration,
        deviceIds: landingPage.deviceIds
      },
      isAssigned: true
    });
  } catch (error) {
    console.error('Error getting device config:', error);
    res.status(500).json({ error: 'Failed to get device config' });
  }
});

// Get all devices
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await Device.find({ isActive: true })
      .sort({ lastSeen: -1 });
    
    // Add computed status and transform _id to id
    const devicesWithStatus = devices.map(device => ({
      id: device._id,
      ...device.toObject(),
      status: device.computedStatus
    }));
    
    res.json({ devices: devicesWithStatus });
  } catch (error) {
    console.error('Error loading devices:', error);
    res.status(500).json({ error: 'Failed to load devices' });
  }
});

// Update device
app.put('/api/devices/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, location, tags } = req.body;
    
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    if (name !== undefined) device.name = name;
    if (location !== undefined) device.location = location;
    if (tags !== undefined) device.tags = tags;
    
    await device.save();
    
    res.json({ 
      device: {
        id: device._id,
        ...device.toObject()
      }
    });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// Delete device
app.delete('/api/devices/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const device = await Device.findById(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    // Remove device from all landing pages
    await LandingPage.updateMany(
      { devices: deviceId },
      { $pull: { devices: deviceId } }
    );
    
    // Soft delete - mark as inactive
    device.isActive = false;
    await device.save();
    
    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// ============================================
// LANDING PAGE ENDPOINTS
// ============================================

// Get all landing pages
app.get('/api/landing-pages', async (req, res) => {
  try {
    const landingPages = await LandingPage.find({ isActive: true })
      .sort({ createdAt: -1 });
    
    const landingPagesWithStats = landingPages.map(lp => ({
      id: lp._id,
      name: lp.name,
      description: lp.description,
      slides: lp.slides,
      transitionDuration: lp.transitionDuration,
      deviceIds: lp.deviceIds || [],
      deviceCount: lp.deviceCount,
      slideCount: lp.slideCount,
      isDefault: lp.isDefault,
      createdAt: lp.createdAt,
      updatedAt: lp.updatedAt
    }));
    
    res.json({ landingPages: landingPagesWithStats });
  } catch (error) {
    console.error('Error loading landing pages:', error);
    res.status(500).json({ error: 'Failed to load landing pages' });
  }
});

// Get single landing page
app.get('/api/landing-pages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const landingPage = await LandingPage.findById(id);
    
    if (!landingPage) {
      return res.status(404).json({ error: 'Landing page not found' });
    }
    
    res.json({ 
      landingPage: {
        id: landingPage._id,
        name: landingPage.name,
        description: landingPage.description,
        slides: landingPage.slides,
        transitionDuration: landingPage.transitionDuration,
        deviceIds: landingPage.deviceIds || [],
        isDefault: landingPage.isDefault,
        createdAt: landingPage.createdAt,
        updatedAt: landingPage.updatedAt
      }
    });
  } catch (error) {
    console.error('Error loading landing page:', error);
    res.status(500).json({ error: 'Failed to load landing page' });
  }
});

// Create new landing page
app.post('/api/landing-pages', async (req, res) => {
  try {
    const { name, description, slides, transitionDuration, isDefault } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const landingPage = new LandingPage({
      name: name.trim(),
      description,
      slides: (slides || []).map((slide, index) => ({
        imageUrl: slide.imageUrl,
        title: slide.title || '',
        order: index
      })),
      transitionDuration: transitionDuration || 8000,
      isDefault: isDefault || false
    });
    
    await landingPage.save();
    
    console.log(`✅ Landing page created: ${landingPage.name}`);
    
    res.status(201).json({ 
      landingPage: {
        id: landingPage._id,
        ...landingPage.toObject()
      }
    });
  } catch (error) {
    console.error('Error creating landing page:', error);
    res.status(500).json({ error: 'Failed to create landing page' });
  }
});

// Update landing page
app.put('/api/landing-pages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, slides, transitionDuration, isDefault, deviceIds } = req.body;
    
    console.log(`📝 Updating landing page: ${id}`);
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    
    const landingPage = await LandingPage.findById(id);
    if (!landingPage) {
      return res.status(404).json({ error: 'Landing page not found' });
    }
    
    if (name !== undefined) landingPage.name = name.trim();
    if (description !== undefined) landingPage.description = description;
    if (transitionDuration !== undefined) landingPage.transitionDuration = transitionDuration;
    if (isDefault !== undefined) landingPage.isDefault = isDefault;
    
    if (slides !== undefined && Array.isArray(slides)) {
      // Boş imageUrl'leri filtrele
      const validSlides = slides.filter(slide => slide.imageUrl && slide.imageUrl.trim());
      
      landingPage.slides = validSlides.map((slide, index) => {
        const slideData = {
          imageUrl: slide.imageUrl.trim(),
          title: slide.title || '',
          description: slide.description || '',
          order: index,
          isActive: true
        };
        return slideData;
      });
      
      console.log(`📷 Slides updated: ${landingPage.slides.length} valid slides`);
    }
    
    if (deviceIds !== undefined) {
      landingPage.deviceIds = deviceIds;
    }
    
    await landingPage.save();
    
    console.log(`✅ Landing page updated: ${landingPage.name}`);
    
    res.json({ 
      landingPage: {
        id: landingPage._id,
        name: landingPage.name,
        slides: landingPage.slides,
        transitionDuration: landingPage.transitionDuration,
        deviceIds: landingPage.deviceIds || [],
        updatedAt: landingPage.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating landing page:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Failed to update landing page', details: error.message });
  }
});

// Delete landing page
app.delete('/api/landing-pages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const landingPage = await LandingPage.findById(id);
    if (!landingPage) {
      return res.status(404).json({ error: 'Landing page not found' });
    }
    
    // Soft delete
    landingPage.isActive = false;
    await landingPage.save();
    
    console.log(`🗑️ Landing page deleted: ${landingPage.name}`);
    
    res.json({ message: 'Landing page deleted successfully' });
  } catch (error) {
    console.error('Error deleting landing page:', error);
    res.status(500).json({ error: 'Failed to delete landing page' });
  }
});

// Assign devices to landing page
app.post('/api/landing-pages/:id/assign-devices', async (req, res) => {
  try {
    const { id } = req.params;
    const { deviceIds } = req.body;
    
    console.log(`📥 Assign devices request for LP ${id}:`, deviceIds);
    
    if (!Array.isArray(deviceIds)) {
      return res.status(400).json({ error: 'deviceIds must be an array' });
    }
    
    const landingPage = await LandingPage.assignDevices(id, deviceIds);
    
    if (!landingPage) {
      return res.status(404).json({ error: 'Landing page not found' });
    }
    
    console.log(`✅ Devices assigned to ${landingPage.name}:`, landingPage.deviceIds);
    
    res.json({ 
      landingPage: {
        id: landingPage._id,
        name: landingPage.name,
        deviceIds: landingPage.deviceIds,
        slides: landingPage.slides,
        transitionDuration: landingPage.transitionDuration
      }
    });
  } catch (error) {
    console.error('Error assigning devices:', error);
    res.status(500).json({ error: 'Failed to assign devices' });
  }
});

// ============================================
// Statistics Endpoint
// ============================================
app.get('/api/stats', async (req, res) => {
  try {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const oneDay = 24 * 60 * 60 * 1000;
    
    // Get counts
    const [
      totalDevices,
      totalLandingPages,
      devices
    ] = await Promise.all([
      Device.countDocuments({ isActive: true }),
      LandingPage.countDocuments({ isActive: true }),
      Device.find({ isActive: true }).select('lastSeen')
    ]);
    
    // Calculate active devices
    const activeDevices = devices.filter(d => {
      const lastSeen = new Date(d.lastSeen).getTime();
      return (now - lastSeen) < fiveMinutes;
    }).length;
    
    const recentDevices = devices.filter(d => {
      const lastSeen = new Date(d.lastSeen).getTime();
      return (now - lastSeen) < oneDay;
    }).length;
    
    // Count total slides
    const landingPages = await LandingPage.find({ isActive: true }).select('slides');
    const totalSlides = landingPages.reduce((sum, lp) => 
      sum + (lp.slides?.filter(s => s.isActive !== false).length || 0), 0);
    
    res.json({
      totalDevices,
      activeDevices,
      recentDevices,
      totalLandingPages,
      totalSlides
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

// ============================================
// Database Reset Endpoint (TEMPORARY - REMOVE IN PRODUCTION)
// ============================================
app.post('/api/admin/reset-database', async (req, res) => {
  try {
    const { confirmCode } = req.body;
    
    // Güvenlik için onay kodu gerekli
    if (confirmCode !== 'RESET_DB_2024') {
      return res.status(403).json({ error: 'Invalid confirmation code' });
    }
    
    console.log('⚠️ DATABASE RESET INITIATED');
    
    // Tüm cihazları sil
    const deviceResult = await Device.deleteMany({});
    console.log(`🗑️ Deleted ${deviceResult.deletedCount} devices`);
    
    // Tüm landing page'leri sil
    const lpResult = await LandingPage.deleteMany({});
    console.log(`🗑️ Deleted ${lpResult.deletedCount} landing pages`);
    
    console.log('✅ DATABASE RESET COMPLETE');
    
    res.json({
      success: true,
      message: 'Database reset complete',
      deleted: {
        devices: deviceResult.deletedCount,
        landingPages: lpResult.deletedCount
      }
    });
  } catch (error) {
    console.error('❌ Database reset error:', error);
    res.status(500).json({ error: 'Failed to reset database' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ============================================
// Server Startup
// ============================================
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Create default landing page if none exists
    const count = await LandingPage.countDocuments();
    if (count === 0) {
      await LandingPage.create({
        name: 'Varsayılan Landing Page',
        isDefault: true,
        slides: [
          {
            imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920&q=80',
            title: 'Hoş Geldiniz',
            order: 0
          }
        ],
        transitionDuration: 8000
      });
      console.log('📄 Default landing page created');
    }
    
    // Start server
    const server = app.listen(config.port, () => {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀  INMAPPER KIOSK BACKEND SERVER                          ║
║                                                              ║
║   Environment: ${config.nodeEnv.padEnd(43)}║
║   Port: ${String(config.port).padEnd(51)}║
║   Database: MongoDB (Connected)${' '.repeat(28)}║
║                                                              ║
║   📡 API:    http://localhost:${config.port}/api${' '.repeat(27)}║
║   🎨 Admin:  http://localhost:${config.port}${' '.repeat(31)}║
║   ❤️  Health: http://localhost:${config.port}/health${' '.repeat(24)}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });
    
    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);
      
      server.close(async () => {
        console.log('✅ HTTP server closed');
        
        const { disconnectDB } = require('./config/database');
        await disconnectDB();
        
        console.log('✅ All connections closed');
        process.exit(0);
      });
      
      // Force close after 10 seconds
      setTimeout(() => {
        console.error('⚠️ Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

