// Shared namespace + user settings (chrome.storage.sync).
window.LG = window.LG || {};

LG.DEFAULTS = {
  enabled: true,
  intensity: 70, // ambient light strength, 0–100
  blur: 24, // glass frost radius in px
  transparency: 50, // 0 solid glass · 50 designed look · 100 immersive (see LG.immersion)
  refraction: true, // SVG lensing on navigation glass (Chromium only)
  reduceTransparency: false,
  performance: false, // 15 fps sampling, no refraction
  contrastTarget: 4.5, // WCAG AA for body text
  backdrop: 'hybrid', // 'enlarged' · 'hybrid' · 'radial' (see ambient.js)
};

LG.settings = { ...LG.DEFAULTS };
LG._settingListeners = [];

LG.onSettings = (fn) => LG._settingListeners.push(fn);

LG.loadSettings = async () => {
  try {
    const stored = await chrome.storage.sync.get(LG.DEFAULTS);
    Object.assign(LG.settings, stored);
  } catch {
    // Extension context invalidated (reloaded) — keep defaults.
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    // A removed key (storage cleared, or synced away) falls back to its default.
    for (const [key, { newValue }] of Object.entries(changes)) LG.settings[key] = newValue ?? LG.DEFAULTS[key];
    LG._settingListeners.forEach((fn) => fn(LG.settings));
  });
  return LG.settings;
};

LG.prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
LG.prefersReducedTransparency = () => matchMedia('(prefers-reduced-transparency: reduce)').matches;
LG.isDarkTheme = () => document.documentElement.hasAttribute('dark');

// How far the Transparency slider is past its designed midpoint, 0–1: glass
// turns into the Clear variant and the backdrop from a colour wash into the
// footage itself. Reduce Transparency (either switch) turns it off; with
// `motion` set, Reduce Motion does too — full-page moving footage is the
// kind of large-area motion that setting exists to avoid.
LG.immersion = (motion = false) => {
  const s = LG.settings;
  if (s.reduceTransparency || LG.prefersReducedTransparency()) return 0;
  if (motion && LG.prefersReducedMotion()) return 0;
  return Math.min(1, Math.max(0, (s.transparency - 50) / 50));
};
