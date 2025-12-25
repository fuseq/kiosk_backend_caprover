/**
 * Database Seed Script
 * Usage: npm run db:seed
 */

const { connectDB, disconnectDB } = require('../config/database');
const { Device, LandingPage } = require('../models');

const seedData = async () => {
  try {
    console.log('🌱 Starting database seed...\n');
    
    await connectDB();
    
    // Check if data already exists
    const deviceCount = await Device.countDocuments();
    const landingPageCount = await LandingPage.countDocuments();
    
    if (deviceCount > 0 || landingPageCount > 0) {
      console.log('⚠️  Database already has data. Skipping seed.');
      console.log(`   Devices: ${deviceCount}`);
      console.log(`   Landing Pages: ${landingPageCount}`);
      await disconnectDB();
      return;
    }
    
    // Create sample devices
    console.log('📱 Creating sample devices...');
    const devices = await Device.create([
      {
        fingerprint: 'demo-device-001',
        name: '1. Kat - Ana Giriş Kiosk',
        deviceInfo: {
          screenResolution: '1920x1080',
          platform: 'Windows',
          language: 'tr-TR'
        },
        location: {
          floor: '1. Kat',
          zone: 'Ana Giriş',
          description: 'Kapı yanındaki kiosk'
        },
        tags: ['ana-giris', 'yuksek-trafik']
      },
      {
        fingerprint: 'demo-device-002',
        name: '2. Kat - Yeme İçme Alanı',
        deviceInfo: {
          screenResolution: '1920x1080',
          platform: 'Windows',
          language: 'tr-TR'
        },
        location: {
          floor: '2. Kat',
          zone: 'Food Court',
          description: 'Restoran alanı ortası'
        },
        tags: ['food-court', 'orta-trafik']
      },
      {
        fingerprint: 'demo-device-003',
        name: '3. Kat - Sinema Alanı',
        deviceInfo: {
          screenResolution: '3840x2160',
          platform: 'Windows',
          language: 'tr-TR'
        },
        location: {
          floor: '3. Kat',
          zone: 'Sinema',
          description: 'Sinema gişeleri önü'
        },
        tags: ['sinema', 'premium']
      }
    ]);
    console.log(`   ✅ Created ${devices.length} devices`);
    
    // Create sample landing pages
    console.log('\n🎨 Creating sample landing pages...');
    
    const mainLandingPage = await LandingPage.create({
      name: 'Ana Giriş - Kampanyalar',
      description: 'Ana giriş kiosklarında gösterilecek kampanya görselleri',
      devices: [devices[0]._id],
      slides: [
        {
          imageUrl: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920&q=80',
          title: 'Hoş Geldiniz',
          description: 'Alışveriş merkezimize hoş geldiniz',
          order: 0
        },
        {
          imageUrl: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1920&q=80',
          title: 'Yılsonu İndirimleri',
          description: '%50\'ye varan indirimler',
          order: 1
        },
        {
          imageUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=1920&q=80',
          title: 'Moda Haftası',
          description: 'Yeni sezon ürünleri mağazalarda',
          order: 2
        }
      ],
      transitionDuration: 8000,
      isDefault: true,
      tags: ['ana-giris', 'kampanya']
    });
    
    const foodCourtLandingPage = await LandingPage.create({
      name: 'Food Court - Restoranlar',
      description: 'Yeme içme alanı kiosklarında gösterilecek restoran tanıtımları',
      devices: [devices[1]._id],
      slides: [
        {
          imageUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1920&q=80',
          title: 'Lezzetli Yemekler',
          order: 0
        },
        {
          imageUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=1920&q=80',
          title: 'Pizza & Makarna',
          order: 1
        },
        {
          imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1920&q=80',
          title: 'Burger Çeşitleri',
          order: 2
        }
      ],
      transitionDuration: 6000,
      tags: ['food-court', 'restoran']
    });
    
    const cinemaLandingPage = await LandingPage.create({
      name: 'Sinema - Vizyondakiler',
      description: 'Sinema kiosklarında gösterilecek film afişleri',
      devices: [devices[2]._id],
      slides: [
        {
          imageUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=80',
          title: 'Vizyondaki Filmler',
          order: 0
        },
        {
          imageUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1920&q=80',
          title: 'Yakında Vizyonda',
          order: 1
        }
      ],
      transitionDuration: 10000,
      tags: ['sinema', 'film']
    });
    
    console.log('   ✅ Created 3 landing pages');
    
    console.log('\n✅ Database seeded successfully!\n');
    console.log('Summary:');
    console.log(`   📱 Devices: ${devices.length}`);
    console.log(`   🎨 Landing Pages: 3`);
    console.log(`   🖼️  Total Slides: ${3 + 3 + 2}`);
    
    await disconnectDB();
    
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
};

seedData();

