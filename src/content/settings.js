// Shared namespace + user settings (chrome.storage.sync).
window.LG = window.LG || {};

LG.DEFAULTS = {
  enabled: true,
  intensity: 70, // ambient light strength, 0–100
  blur: 24, // glass frost radius in px
  refraction: true, // SVG lensing on navigation glass (Chromium only)
  reduceTransparency: false,
  performance: false, // 15 fps sampling, no refraction
  contrastTarget: 4.5, // WCAG AA for body text
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
    for (const [key, { newValue }] of Object.entries(changes)) LG.settings[key] = newValue;
    LG._settingListeners.forEach((fn) => fn(LG.settings));
  });
  return LG.settings;
};

LG.prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
LG.prefersReducedTransparency = () => matchMedia('(prefers-reduced-transparency: reduce)').matches;
LG.isDarkTheme = () => document.documentElement.hasAttribute('dark');
