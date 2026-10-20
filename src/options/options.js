// The options page: every setting with a description of what it does, and
// the voluntary support button. Opened from the popup, the extension's
// context menu (Options), or once after installing (background.js).

// Hosted checkout (TapPay Link Pay, see TODO.md). Opened in a new tab: the
// wallets (Apple Pay / Google Pay) can only run on that HTTPS page, never on
// a chrome-extension:// one. The extension loads no payment code and reads
// nothing back. scripts/build.py refuses to package the test link.
const DONATE_URL = 'https://example.com/glasslight/donate-test';
const DONATE_IS_TEST = new URL(DONATE_URL).hostname === 'example.com';

let t = () => '';
const status = document.getElementById('status');
const STATUS_KEY = { saving: 'statusSaving', saved: 'statusSaved' };

const saver = LG.prefs.createSaver((state, err) => {
  if (state === 'error') status.textContent = t(/QUOTA|MAX_WRITE/i.test(err?.message) ? 'statusQuota' : 'statusError');
  else status.textContent = STATUS_KEY[state] ? t(STATUS_KEY[state]) : '';
  status.dataset.state = state;
});
const controls = LG.prefs.bindControls(saver);

LG.prefs.bindLanguage(document.getElementById('language'), async (language) => {
  t = await LG.prefs.localize(language);
  if (resetArmed) reset.textContent = t('resetConfirm');
});

// Reset asks twice: the first click arms it for a few seconds.
const reset = document.getElementById('reset');
let resetArmed = 0;
reset.addEventListener('click', async () => {
  if (!resetArmed) {
    reset.textContent = t('resetConfirm');
    reset.classList.add('armed');
    resetArmed = setTimeout(disarm, 4000);
    return;
  }
  disarm();
  saver.discard();
  await chrome.storage.sync.set(LG.DEFAULTS);
  controls.render(LG.DEFAULTS);
  status.textContent = t('statusSaved');
});
function disarm() {
  clearTimeout(resetArmed);
  resetArmed = 0;
  reset.textContent = t('resetAction');
  reset.classList.remove('armed');
}

document.getElementById('donate').addEventListener('click', () => chrome.tabs.create({ url: DONATE_URL }));
document.getElementById('donate-test').hidden = !DONATE_IS_TEST;
