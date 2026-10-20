// Default settings: the one definition, loaded by the content scripts (before
// settings.js), the popup and the options page.
(globalThis.LG ||= {}).DEFAULTS = Object.freeze({
  enabled: true,
  intensity: 70, // ambient light strength, 0–100
  blur: 24, // glass frost radius in px
  transparency: 50, // 0 solid glass · 50 designed look · 100 immersive (see LG.immersion)
  refraction: true, // SVG lensing on navigation glass (Chromium only)
  reduceTransparency: false,
  performance: false, // 15 fps sampling, no refraction
  static: false, // one frame per video / pause / seek instead of following playback
  contrastTarget: 4.5, // WCAG AA for body text; the popup offers 1.5–4.5
  backdrop: 'hybrid', // 'enlarged' · 'hybrid' · 'radial' (see ambient.js)
});

// Values stored by older versions can sit outside today's ranges (the
// contrast target once went up to 7).
LG.clampSettings = (s) => {
  s.contrastTarget = Math.min(4.5, Math.max(1.5, Number(s.contrastTarget) || LG.DEFAULTS.contrastTarget));
  return s;
};
