# Venue Manager · Birim Yönetimi

Mekan yöneticilerinin birim değişikliklerini bildirmesi için bağımsız bir araç.
GeoJSON kat planını gösterir; bir birime tıklandığında o birimin Google Sheets
kaydı sağ üstteki panelde açılır, düzenlenip onaylandığında Sheets'e yazılır ve
değişiklik ayrı bir günlük sayfasına işlenir.

Bu proje `inmapper_kiosk` deposundan bağımsızdır — klasörü olduğu gibi başka bir
yere taşıyabilirsiniz. Kiosk projesinden alınan parçalar: gviz CSV okuma,
RFC-uyumlu CSV ayrıştırıcı, Apps Script yazma protokolü ve birim kimliği
normalizasyonu.

---

## Hızlı başlangıç

```bash
cd venue-manager
npm run dev        # http://127.0.0.1:8200 adresinde açar
```

Derleme adımı yok — düz ES modülleri. Tek koşul, dosyaların bir HTTP sunucusu
üzerinden servis edilmesi (`file://` ile modül import'ları çalışmaz).

Kontroller:

```bash
npm run check          # her modülü ayrıştırır ve import eder
npm run check:sheets   # yazma ucu + sekmeler + kolon şeması doğrulaması
```

`check:sheets`, tarayıcıyı açmadan kurulumun tamam olup olmadığını söyler:
yazma ucunun sürümü, sekmelerin okunabilirliği, liste sekmesinde eksik kolon
olup olmadığı ve günlük sekmesinin gerçekten var olup olmadığı.

---

## Sheets tarafında yapılması gerekenler

Aşağıdaki **5 adım** tamamlanmadan araç yazma yapamaz.

### 1. Liste sekmesine `Disabled` kolonu ekleyin

Birimin açık/kapalı durumu kiosk editöründe **GeoJSON içinde** tutuluyor; bu araç
durumu Sheets üzerinden takip eder. `Zorlu_List` sekmesine yeni bir kolon
ekleyin:

| Kolon      | Değerler                             |
| ---------- | ------------------------------------ |
| `Disabled` | `TRUE` = kapalı · `FALSE` / boş = aktif |

Kolon adı büyük/küçük harf duyarlıdır. Kolonu eklemezseniz araç uyarı verir ve
durum anahtarı kaydedilemez.

#### Kiosk ve editör bu kolonu okur

Kiosk çalışma zamanı (`src/features/data/location-service.js` →
`src/features/map/map-renderer.js`) bu kolonu her veri yenilemesinde okuyup
GeoJSON'un `properties.disabled` alanına damgalar. Yani buradan kapatılan bir
birim, GeoJSON'u yeniden dışa aktarmaya gerek kalmadan kiosk haritasında da
kapanır: grileşir veya gizlenir, tıklanamaz hâle gelir, etiketi kalkar ve rota
grafiği yeniden kurulduğu için içinden geçen rotalar da iptal olur.

Editörün **İşlenmiş** haritası da aynı kolonu okur (`sheet-disabled.js`).
Harita sekmesine her girişte Sheets yenilenir; Venue Manager'da kapatılan birim
orada da kapalı görünür. Tersi de geçerli: İşlenmiş'teki **Devre dışı** düğmesi
hem yerel GeoJSON'a hem Sheets `Disabled` kolonuna (ve varsa `Zorlu_Changes`
günlüğüne) yazar.

Öncelik kuralı: hücre **doluysa** Sheets kazanır. Hücre boşsa veya kolon yoksa
editörde verilmiş GeoJSON değeri geçerli kalır. Böylece bu araç yalnızca
hakkında açık bir karar verilmiş birimleri etkiler.

### 2. Düzenlenecek alanların kolonları mevcut olsun

Araç şu kolonları okur ve yazar:

`ID` · `Title` · `Subtitle` · `Category` · `Floor` · `Telephone` · `Web` ·
`Hours` · `Description` · `Logo` · `Disabled`

Eksik olan kolonlar ilk yazmada Apps Script tarafından otomatik olarak başlık
satırının sonuna eklenir; ancak mevcut değerlerin panelde görünmesi için
baştan var olmaları daha iyidir.

Hangi alanların düzenlenebileceğini değiştirmek isterseniz tek yer:
`src/data/unit-schema.js` içindeki `UNIT_FIELDS` listesi. Form, doğrulama,
günlük ve Sheets yazımı bu listeden türetilir.

### 3. Değişiklik günlüğü için yeni bir sayfa oluşturun

Adı `Zorlu_Changes` olan **boş** bir sayfa açmanız yeterli — başlık satırını
Apps Script ilk yazmada kendisi oluşturur ve dondurur. Başlıkları kendiniz
yazmak isterseniz sıra şu:

| Timestamp | UnitID | UnitTitle | Field | OldValue | NewValue | Action | Editor | Note |
| --------- | ------ | --------- | ----- | -------- | -------- | ------ | ------ | ---- |

- Her **alan** değişikliği için bir satır yazılır (üç alan değiştiyse üç satır).
- `Action`: `update` · `disable` · `enable`
- `Field`: değişen kolonun adı; durum değişiminde `Disabled`
- `Editor`: üst çubuktaki "Düzenleyen" alanına yazılan ad (tarayıcıda saklanır)
- `Note`: yöneticinin panelde girdiği serbest metin gerekçe
- `Timestamp`: `YYYY-MM-DD HH:mm:ss` (yerel saat)

Sayfa adını değiştirirseniz `src/config.js` içindeki `tabs.changes` alanını da
güncelleyin.

> **Dikkat — sessiz tuzak:** gviz, olmayan bir sekme adı istendiğinde hata
> vermez, sessizce dosyanın **ilk sekmesini** döndürür. Yani sekme adını yanlış
> yazarsanız okuma "çalışıyor" gibi görünür ama Apps Script yazma sırasında
> "Sayfa bulunamadı" der. `npm run check:sheets` bu durumu tespit eder.

### 4. Sheet'i okumaya açın

Paylaş → **"Bağlantıya sahip herkes" → "Görüntüleyen"**. Okuma gviz uçları
üzerinden anonim yapılır; paylaşım kapalıysa Google HTTP 200 ile giriş sayfası
döner ve araç "sekme okunamadı" hatası verir.

### 5. Apps Script yazma ucunu yayınlayın

`tools/apps-script/venue-manager.gs`, kiosk editörünün v1.0.0 yazıcısının **üst
kümesidir**: `upsertRows` (`deleteKeys` dahil) ve `updateRow` aynen korunur,
üzerine `appendRows` eklenir. Yani iki araç tek uçtan beslenir.

**Kiosk yazıcısı zaten kuruluysa** (`sheet-writer.gs`, v1.0.0):

1. <https://script.google.com/home/my> → mevcut projeyi açın
2. `Code.gs` içeriğini bu dosyayla değiştirin — `ALLOWED_SHEET_IDS` değerinizi koruyun
3. **Deploy → Manage deployments → kalem simgesi → Version: New version → Deploy**
4. Adres değişmez; editör tarafında hiçbir şey bozulmaz

**Sıfırdan kuruyorsanız — bağımsız (standalone) proje kurun:**

1. <https://script.google.com/home/my> → **Yeni proje**
   Sheet'in içinden (**Uzantılar → Apps Script**) kurmayın; gerekçe aşağıda.
2. `venue-manager.gs` dosyasının tamamını `Code.gs` içine yapıştırın
3. Projeye ayırt edici bir ad verin, örn. `Inmapper · Sheet Writer v2.1`
4. `ALLOWED_SHEET_IDS` listesine yazmasına izin verdiğiniz sheet ID'lerini ekleyin
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** — "Anyone with Google account" *değil*
6. Çıkan `/exec` adresini `src/config.js` → `venue.sheets.writeEndpointUrl` alanına yazın

**Neden bağlı değil de bağımsız?** Script `sheetId`'yi istek gövdesinden alır ve
`ALLOWED_SHEET_IDS` bir listedir — yani tek uç birden fazla mekanı besleyebilir.
Bir dosyaya bağlarsanız bu esnekliği kaybeder; ayrıca o dosya kopyalandığında
script de kopyalanır ve elinizde yayınlanmamış klonlar birikir. Güvenlik
açısından iki seçenek arasında fark yoktur: ikisi de sahibin yetkisiyle çalışır,
sınırı `ALLOWED_SHEET_IDS` çizer.

Her iki durumda da doğrulama aynı: adresin sonuna `?op=ping` ekleyip tarayıcıda
açın, `{"ok":true,"version":"2.1.0"}` görmelisiniz. Sürüm `1.0.0` çıkıyorsa
yeniden yayınlama adımı atlanmış demektir.

> Kodu her değiştirdiğinizde **Manage deployments → Version: New version** ile
> yeniden yayınlamanız gerekir; aksi halde eski sürüm çalışmaya devam eder.

`writeEndpointUrl` boş bırakılırsa araç salt okunur modda açılır: birim
bilgileri görüntülenir ama kaydet düğmesi kapalı kalır.

---

## Güvenlik notu

"Who has access: Anyone" adresi bilen herkesin yazabileceği anlamına gelir.
İki katman öneriyoruz:

1. **`ALLOWED_SHEET_IDS`** — hangi dosyalara yazılabileceğini sınırlar.
2. **`SHARED_SECRET`** — `.gs` dosyasındaki bu alanı doldurun ve aynı değeri
   `src/config.js` → `venue.sheets.writeSecret` alanına yazın. İstemci her
   istekte gönderir, script doğrulamadan işlemi reddeder.

İkinci katman istemci kodunda görünür bir sır olduğu için kötü niyetli bir
kullanıcıya karşı tam koruma değildir; kazara/otomatik erişimi engeller. Aracı
yalnızca iç ağda ya da kimlik doğrulamalı bir statik barındırmada yayınlayın.

---

## Mimari

```
venue-manager/
├── index.html                  Kabuk: ust cubuk + harita + island paneli
├── src/
│   ├── config.js               Tek yapılandırma noktası
│   ├── main.js                 Katmanları bağlayan tek yer
│   ├── core/                   Altyapı — tarayıcı API'si dışında bağımlılık yok
│   │   ├── csv.js              RFC-uyumlu CSV ayrıştırıcı
│   │   ├── sheets.js           gviz okuma + Apps Script yazma
│   │   ├── ids.js              Birim kimliği normalizasyonu
│   │   └── event-bus.js
│   ├── data/                   Alan modeli — haritayı ve arayüzü bilmez
│   │   ├── unit-schema.js      UNIT_FIELDS: düzenlenebilir alanlar
│   │   ├── units-repo.js       Yükleme, diff, kaydetme, günlükleme
│   │   └── categories.js       Kategori paleti ve renkleri
│   ├── map/                    MapLibre — Sheets'i yalnızca okur
│   │   ├── map-view.js
│   │   ├── venue-geojson.js
│   │   └── unit-utils.js
│   ├── ui/                     Sunum
│   │   ├── island.js           Sağ üst panel + düzenleme formu
│   │   ├── topbar.js           Kat seçici, arama, yenile, kimlik
│   │   └── toast.js
│   └── styles/
│       ├── tokens.css          Tüm renk/ölçek/gölge değerleri
│       ├── app.css
│       └── island.css
├── assets/venue.geojson        Kat geometrisi (kiosk projesinden kopya)
└── tools/
    ├── apps-script/venue-manager.gs
    └── check-syntax.mjs
```

**Bağımlılık yönü tek yönlüdür:** `ui` → `data` → `core`. `map` yalnızca `data`
katmanından okur. Katmanlar birbirini yalnızca `main.js` içinde tanımlanan geri
çağrılar üzerinden görür; hiçbir modül `ui`'ye doğru import yapmaz.

### Veri akışı

```
Sheets (Zorlu_List)  ──gviz CSV──►  units-repo  ──►  map-view (renkler, etiketler)
                                         │
                                         └────────►  island (form)
                                                        │
                              onayla ──► units-repo.saveUnit()
                                                        │
                        ┌───────────────────────────────┴───────────────┐
                        ▼                                               ▼
             1. upsertRows → Zorlu_List                    2. appendRows → Zorlu_Changes
                (yalnızca değişen kolonlar)                   (alan başına bir satır)
```

Sıra bilinçlidir: **önce veri, sonra günlük**. Böylece başarısız bir yazım
günlüğe "olmuş gibi" geçmez. Günlük yazımı başarısız olursa kullanıcıya ayrı bir
uyarı gösterilir, veri yazımı geri alınmaz.

### Harita renklendirme

Her poligona `__color` özelliği damgalanır ve boyama `['get','__color']` ile
yapılır. Sheets verisi değiştiğinde dev bir `match` ifadesi yeniden kurmak
yerine veriyi yeniden damgalayıp `setData` çağırmak yeterli olur. Fare üzerinde
ve seçili durumları `feature-state` ile bindirilir.

Renk önceliği: kapalı birim → gri · birincil kategori rengi · `sublayer` rengi ·
varsayılan. Sheets kaydı olmayan poligonlar soluk gösterilir ve tıklandığında
panel "kayıt bulunamadı" uyarısı verir.

---

## Bilinen sınır: aynı `ID`'yi paylaşan satırlar

`Zorlu_List` sekmesinde birden fazla işletme aynı `ID` değerini paylaşabiliyor —
bir poligonda birkaç mekan olduğunda (örn. `ID-245`: Cheers Bar, Studio, Touche,
Zorlu PSM; `carpark-301` ve `entrance-304` ikişer satır).

Araç bu durumda **son eşleşen satırı** gösterir ve düzenler. Okuma ve yazma aynı
satırı hedeflediği için veri bozulmaz, ancak aynı kimliği paylaşan diğer
işletmelere panelden erişilemez. Apps Script tarafındaki silme de bilinçli olarak
anahtar başına tek satır siler; aksi halde "ID-245'i sil" isteği dört kaydı
birden uçururdu.

Çok kiracılı poligonların hepsini yönetmek gerekirse iki yol var: satırlara
benzersiz bir alt anahtar kolonu eklemek (`ID` + sıra no) ya da panelde aynı
kimlikteki satırlar arasında geçiş yapan bir seçici göstermek. İkisi de
`src/data/units-repo.js` içindeki indeksleme mantığının değişmesini gerektirir.

## Kapsam dışı

- **Yol / kapi / portal düzenlemesi.** Bu araç `layer === 'rooms'` ve
  `layer === 'writing'` dışındaki GeoJSON katmanlarına hiç dokunmaz.
- **Geometri düzenlemesi.** Poligon çizimi ve `ID` ataması kiosk editöründe
  (Map Builder) yapılır.
- **Yeni birim oluşturma.** Araç yalnızca Sheets'te satırı olan birimleri
  düzenler.
