// Legibility engine: text stays 100% opaque; only the backdrop is tuned.
// From the sampled ambient pixels we solve for the smallest scrim alpha that
// keeps the worst-case pixel at >= target contrast (WCAG 2.x) against the
// weakest text colour of the current theme.
(() => {
  const toLinear = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  // 256-entry LUT: the solver runs a few thousand luminance evaluations per tick.
  const LIN = new Float32Array(256).map((_, i) => toLinear(i));

  const luminance = (r, g, b) =>
    0.2126 * LIN[r | 0] + 0.7152 * LIN[g | 0] + 0.0722 * LIN[b | 0];

  const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

  // Theme palettes. `text` is the weakest text colour we must protect —
  // YouTube's secondary text after glass.css raises it for vibrancy
  // (#aaa → #c6c6c6 dark, #606060 → #4a4a4a light). `base` is the scrim colour.
  const THEMES = {
    dark: { base: [15, 15, 15], text: [198, 198, 198] },
    light: { base: [249, 249, 250], text: [74, 74, 74] },
  };

  /**
   * @param {Uint8ClampedArray} px  RGBA ambient samples
   * @param {number} opacity        ambient layer opacity over the base (0–1)
   * @param {boolean} dark
   * @param {number} target         contrast ratio to guarantee
   * @returns {number} scrim alpha 0–1
   */
  function solveScrim(px, opacity, dark, target) {
    const { base, text } = dark ? THEMES.dark : THEMES.light;
    const textL = luminance(...text);
    const n = px.length / 4;

    // Page colour per pixel = mix(base, sample, opacity). Keep only the
    // worst few candidates (brightest for dark theme, darkest for light).
    const cand = [];
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      const r = base[0] + (px[o] - base[0]) * opacity;
      const g = base[1] + (px[o + 1] - base[1]) * opacity;
      const b = base[2] + (px[o + 2] - base[2]) * opacity;
      cand.push([r, g, b, luminance(r, g, b)]);
    }
    cand.sort((a, b) => (dark ? b[3] - a[3] : a[3] - b[3]));
    const worst = cand.slice(0, 24);

    const passes = (a) =>
      worst.every(([r, g, b]) => {
        const L = luminance(
          r + (base[0] - r) * a,
          g + (base[1] - g) * a,
          b + (base[2] - b) * a,
        );
        return ratio(L, textL) >= target;
      });

    if (passes(0)) return 0;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 12; k += 1) {
      const mid = (lo + hi) / 2;
      if (passes(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  // Saturation-weighted average → the colour that "spills" onto glass.
  function dominantColor(px) {
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    let lum = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      const R = px[i];
      const G = px[i + 1];
      const B = px[i + 2];
      const max = Math.max(R, G, B);
      const min = Math.min(R, G, B);
      const weight = 0.05 + (max ? (max - min) / max : 0) * (max / 255);
      r += R * weight;
      g += G * weight;
      b += B * weight;
      w += weight;
      lum += luminance(R, G, B);
    }
    return { rgb: [r / w, g / w, b / w].map(Math.round), lum: lum / n };
  }

  // Mean luminance of a horizontal band (rows [from, to) of a w×h sample).
  function bandLuminance(px, w, from, to) {
    let sum = 0;
    let n = 0;
    for (let y = from; y < to; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        sum += luminance(px[o], px[o + 1], px[o + 2]);
        n += 1;
      }
    }
    return n ? sum / n : 0;
  }

  LG.contrast = { luminance, ratio, solveScrim, dominantColor, bandLuminance, THEMES };
})();
