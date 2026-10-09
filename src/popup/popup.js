// The popup: quick controls. Every setting, explained, lives on the options
// page (src/options/); both share src/shared/prefs.js.

// chrome.i18n always follows the browser language and cannot be overridden,
// so a user-chosen language is read from its _locales/<lang>/messages.json
// (LG.prefs.localize). The manifest name/description stay on the browser
// language — Chrome gives extensions no way to change those.
let t = () => '';
const status = document.getElementById('status');
const STATUS_KEY = { saving: 'statusSaving', saved: 'statusSaved' };

const saver = LG.prefs.createSaver((state, err) => {
  if (state === 'error') status.textContent = t(/QUOTA|MAX_WRITE/i.test(err?.message) ? 'statusQuota' : 'statusError');
  else status.textContent = STATUS_KEY[state] ? t(STATUS_KEY[state]) : '';
});
const controls = LG.prefs.bindControls(saver);

LG.prefs.bindLanguage(document.getElementById('language'), async (language) => {
  t = await LG.prefs.localize(language);
});

document.getElementById('reset').addEventListener('click', async () => {
  saver.discard();
  await chrome.storage.sync.set(LG.DEFAULTS);
  controls.render(LG.DEFAULTS);
});

// openOptionsPage honours the manifest's options_ui (opens it in a tab, or
// focuses the one already open); the popup would otherwise linger behind it.
document.getElementById('open-options').addEventListener('click', async () => {
  await saver.flush();
  await chrome.runtime.openOptionsPage();
  window.close();
});
