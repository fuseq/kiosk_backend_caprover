#!/usr/bin/env node
/**
 * Index'leri tek seferlik kurar.
 *
 * config/database.js içinde autoIndex kapalı: Firestore Enterprise (MongoDB
 * uyumluluğu) index'leri arka planda oluşturur ve bir index drop edildikten
 * hemen sonra aynı config'in yeniden oluşturulmasına izin vermez. Her cold
 * start'ta index senkronizasyonu denemek yerine bu script'i deploy sonrası
 * bir kez çalıştır.
 *
 * Index oluşturmak Firestore'da bir admin işlemidir; runtime kimliğinde
 * (roles/datastore.user) bu yetki yoktur. Bu yüzden script'i owner yetkisine
 * sahip bir kimlikle çalıştır:
 *
 *   TOKEN=$(gcloud auth print-access-token)
 *   MONGODB_URI="mongodb://access_token:$TOKEN@UID.LOCATION.firestore.goog:443/DB\
 *     ?loadBalanced=true&authMechanism=PLAIN&authSource=\$external&tls=true&retryWrites=false" \
 *     node scripts/ensure-indexes.js
 *
 * Index tanımları modellerin şemalarından okunur; burada tekrarlanmaz.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const models = require('../models');

function describe(keys) {
  return Object.entries(keys).map(([k, v]) => `${k}:${v}`).join(', ');
}

/** Firestore'un index build'i tek tek beklenir; toplu komut socket timeout'unu aşıyor. */
async function createOne(Model, keys, options) {
  const spec = { ...options };
  delete spec.background;
  await Model.collection.createIndex(keys, spec);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  // Index build'i dakikalar sürebildiği için socket timeout devre dışı.
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 0,
    autoIndex: false,
    autoCreate: false,
  });
  console.log(`Bağlandı: ${mongoose.connection.name}\n`);

  let created = 0;
  let existing = 0;
  let failed = 0;

  for (const [name, Model] of Object.entries(models)) {
    const specs = Model.schema.indexes();
    if (!specs.length) {
      console.log(`— ${name}: şemada index yok`);
      continue;
    }
    console.log(`${name} (${specs.length} index)`);
    for (const [keys, options = {}] of specs) {
      const label = `${describe(keys)}${options.unique ? ' [unique]' : ''}`;
      try {
        await createOne(Model, keys, options);
        created += 1;
        console.log(`  ok      ${label}`);
      } catch (err) {
        if (/already exists|IndexAlreadyExists/i.test(err.message)) {
          existing += 1;
          console.log(`  var     ${label}`);
        } else {
          failed += 1;
          console.log(`  HATA    ${label} → ${err.message}`);
        }
      }
    }
  }

  await mongoose.disconnect();
  console.log(`\nkuruldu=${created} mevcut=${existing} hata=${failed}`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('Index kurulumu başarısız:', err.message);
  process.exit(1);
});
