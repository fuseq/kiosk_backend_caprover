/**
 * ============================================
 * MongoDB Database Configuration
 * ============================================
 */

const mongoose = require('mongoose');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Firestore Enterprise (MongoDB uyumluluğu) index oluşturmayı arka planda yapar ve
 * "drop sonrası aynı index config'i hemen oluşturulamaz" kısıtı vardır. Bu yüzden
 * Mongoose'un her boot'ta index senkronize etmesi kapatıldı; index'ler
 * scripts/ensure-indexes.js ile tek seferlik kurulur.
 */
const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  autoIndex: false,
  autoCreate: false,
};

// Connection URI
const getConnectionUri = () => {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  // Production'da sessizce localhost'a düşmek, boş bir veritabanıyla ayağa
  // kalkmak anlamına gelir; bunun yerine açıkça hata ver.
  if (isProduction) {
    throw new Error('MONGODB_URI is required in production');
  }

  const host = process.env.MONGODB_HOST || 'localhost';
  const port = process.env.MONGODB_PORT || '27017';
  const database = process.env.MONGODB_DATABASE || 'inmapper_kiosk';
  const username = process.env.MONGODB_USERNAME || '';
  const password = process.env.MONGODB_PASSWORD || '';

  if (username && password) {
    return `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=admin`;
  }

  return `mongodb://${host}:${port}/${database}`;
};

// Connect to MongoDB — bağlantı kurulmadan dönmez; hata olursa throw eder.
const connectDB = async () => {
  const uri = getConnectionUri();
  const maxAttempts = Number(process.env.MONGODB_CONNECT_RETRIES) || 12;
  const delayMs = Number(process.env.MONGODB_CONNECT_RETRY_MS) || 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔌 Connecting to MongoDB... (attempt ${attempt}/${maxAttempts})`);

      await mongoose.connect(uri, options);

      console.log('✅ MongoDB connected successfully');
      console.log(`📍 Database: ${mongoose.connection.name}`);

      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
      });

      return mongoose.connection;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      if (attempt < maxAttempts) {
        console.log(`🔄 Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
};

// Disconnect from MongoDB
const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    console.log('👋 MongoDB disconnected');
  } catch (error) {
    console.error('❌ Error disconnecting from MongoDB:', error);
  }
};

// Check connection status
const isConnected = () => {
  return mongoose.connection.readyState === 1;
};

module.exports = {
  connectDB,
  disconnectDB,
  isConnected,
  mongoose
};


