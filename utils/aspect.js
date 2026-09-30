/**
 * ============================================
 * Aspect Ratio Utilities
 * ============================================
 * Görsel/ekran en-boy oranını standart bir sınıfa (16:9, 4:3, 9:16 ...)
 * toleransla eşler. Hem sunucu (cihaz çözünürlüğü) hem de gelen slide
 * boyutları için kullanılır. Aynı fonksiyon admin panelde de (public/aspect.js)
 * kopya olarak bulunur; iki taraf da aynı kanonik değeri üretmeli ki eşleşme tutsun.
 */

// Standart oran sınıfları (yatay + dikey)
const ASPECT_CLASSES = [
  { label: '32:9', ratio: 32 / 9 },
  { label: '21:9', ratio: 21 / 9 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '16:10', ratio: 16 / 10 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '5:4', ratio: 5 / 4 },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '10:16', ratio: 10 / 16 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '9:21', ratio: 9 / 21 }
];

// Bu orandan daha yakın bir standart sınıf bulunamazsa gcd'li özel oran üretilir.
const SNAP_TOLERANCE = 0.08; // bağıl fark

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/**
 * Genişlik/yükseklikten kanonik en-boy oranı etiketi üretir.
 * @param {number} width
 * @param {number} height
 * @returns {string} örn. "16:9" — geçersizse ''
 */
function computeAspectRatio(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h || w <= 0 || h <= 0 || !isFinite(w) || !isFinite(h)) {
    return '';
  }

  const ratio = w / h;

  let best = null;
  let bestDiff = Infinity;
  for (const cls of ASPECT_CLASSES) {
    const diff = Math.abs(ratio - cls.ratio) / cls.ratio;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = cls;
    }
  }

  if (best && bestDiff <= SNAP_TOLERANCE) {
    return best.label;
  }

  // Standart sınıfa yeterince yakın değil: gcd ile sadeleştirilmiş özel oran
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

/**
 * "1920x1080" gibi bir çözünürlük dizesinden kanonik oran üretir.
 * @param {string} resolution
 * @returns {string}
 */
function aspectFromResolution(resolution) {
  if (!resolution || typeof resolution !== 'string') return '';
  const m = resolution.toLowerCase().match(/(\d+)\s*[x×]\s*(\d+)/);
  if (!m) return '';
  return computeAspectRatio(parseInt(m[1], 10), parseInt(m[2], 10));
}

module.exports = { computeAspectRatio, aspectFromResolution, ASPECT_CLASSES };
