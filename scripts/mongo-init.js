/**
 * MongoDB Initialization Script
 * This script runs when the MongoDB container is first created
 */

// Create database and user
db = db.getSiblingDB('inmapper_kiosk');

// Create collections with validation
db.createCollection('devices', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['fingerprint'],
      properties: {
        fingerprint: {
          bsonType: 'string',
          description: 'Unique device fingerprint'
        },
        name: {
          bsonType: 'string',
          description: 'Device name'
        },
        status: {
          enum: ['online', 'idle', 'offline'],
          description: 'Device status'
        }
      }
    }
  }
});

db.createCollection('landingpages', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Landing page name'
        },
        transitionDuration: {
          bsonType: 'int',
          minimum: 1000,
          maximum: 60000,
          description: 'Slide transition duration in milliseconds'
        }
      }
    }
  }
});

// Create indexes
db.devices.createIndex({ fingerprint: 1 }, { unique: true });
db.devices.createIndex({ lastSeen: -1 });
db.devices.createIndex({ status: 1 });

db.landingpages.createIndex({ isDefault: 1 });
db.landingpages.createIndex({ isActive: 1 });
db.landingpages.createIndex({ devices: 1 });

// Insert default landing page
db.landingpages.insertOne({
  name: 'Varsayılan Landing Page',
  description: 'Sistem tarafından oluşturulan varsayılan landing page',
  devices: [],
  slides: [
    {
      imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920&q=80',
      title: 'Hoş Geldiniz',
      order: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      imageUrl: 'https://images.unsplash.com/photo-1555529669-e69e7aa0ba9a?w=1920&q=80',
      title: 'Mağazalar',
      order: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      imageUrl: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=1920&q=80',
      title: 'Kampanyalar',
      order: 2,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ],
  transitionDuration: 8000,
  transitionEffect: 'slide',
  isDefault: true,
  isActive: true,
  styling: {
    backgroundColor: '#000000',
    overlayOpacity: 0
  },
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date()
});

print('✅ Database initialized successfully');
print('📄 Default landing page created');


