/**
 * Aspect Ratio Utilities (tarayıcı kopyası)
 * Sunucudaki utils/aspect.js ile AYNI mantığı uygular; iki taraf da aynı
 * kanonik değeri üretmeli ki cihaz-görsel eşleşmesi tutsun.
 */
(function (window) {
  'use strict';

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

  const SNAP_TOLERANCE = 0.08;

  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) { [a, b] = [b, a % b]; }
    return a || 1;
  }

  function computeAspectRatio(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!w || !h || w <= 0 || h <= 0 || !isFinite(w) || !isFinite(h)) return '';

    const ratio = w / h;
    let best = null;
    let bestDiff = Infinity;
    for (const cls of ASPECT_CLASSES) {
      const diff = Math.abs(ratio - cls.ratio) / cls.ratio;
      if (diff < bestDiff) { bestDiff = diff; best = cls; }
    }
    if (best && bestDiff <= SNAP_TOLERANCE) return best.label;

    const g = gcd(w, h);
    return `${Math.round(w / g)}:${Math.round(h / g)}`;
  }

  function aspectFromResolution(resolution) {
    if (!resolution || typeof resolution !== 'string') return '';
    const m = resolution.toLowerCase().match(/(\d+)\s*[x×]\s*(\d+)/);
    if (!m) return '';
    return computeAspectRatio(parseInt(m[1], 10), parseInt(m[2], 10));
  }

  window.AspectUtil = {
    computeAspectRatio,
    aspectFromResolution,
    ASPECT_CLASSES: ASPECT_CLASSES.map((c) => ({ ...c })),
  };
})(window);
