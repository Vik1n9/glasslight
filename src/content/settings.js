// Shared namespace + user settings (chrome.storage.sync). LG.DEFAULTS comes
// from src/shared/defaults.js, loaded first.
window.LG = window.LG || {};

LG.settings = { ...LG.DEFAULTS };
LG._settingListeners = [];

LG.onSettings = (fn) => LG._settingListeners.push(fn);

const clampSettings = () => LG.clampSettings(LG.settings);

LG.loadSettings = async () => {
  try {
    const stored = await chrome.storage.sync.get(LG.DEFAULTS);
    Object.assign(LG.settings, stored);
    clampSettings();
  } catch {
    // Extension context invalidated (reloaded) — keep defaults.
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    // A removed key (storage cleared, or synced away) falls back to its default.
    for (const [key, { newValue }] of Object.entries(changes)) LG.settings[key] = newValue ?? LG.DEFAULTS[key];
    clampSettings();
    LG._settingListeners.forEach((fn) => fn(LG.settings));
  });
  return LG.settings;
};

// Cached MediaQueryLists: prefersReducedMotion is read on every video frame
// (drawVideo's default) and on every animation frame, and matchMedia()
// allocates a fresh list per call. `.matches` on an existing list is a cheap
// property read; the platform keeps it current.
const mqMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mqTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
LG.prefersReducedMotion = () => mqMotion.matches;
LG.prefersReducedTransparency = () => mqTransparency.matches;
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
