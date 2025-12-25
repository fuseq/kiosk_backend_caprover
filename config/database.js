/**
 * ============================================
 * MongoDB Database Configuration
 * ============================================
 */

const mongoose = require('mongoose');

// Connection options
const options = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

// Connection URI
const getConnectionUri = () => {
  // CapRover/Docker environment
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }
  
  // Build URI from individual components
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

// Connect to MongoDB
const connectDB = async () => {
  try {
    const uri = getConnectionUri();
    console.log('🔌 Connecting to MongoDB...');
    
    await mongoose.connect(uri, options);
    
    console.log('✅ MongoDB connected successfully');
    console.log(`📍 Database: ${mongoose.connection.name}`);
    
    // Connection event handlers
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
    // Retry connection after 5 seconds
    console.log('🔄 Retrying connection in 5 seconds...');
    setTimeout(connectDB, 5000);
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


