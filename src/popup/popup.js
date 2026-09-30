const DEFAULTS = {
  enabled: true,
  intensity: 70,
  blur: 24,
  transparency: 50,
  refraction: true,
  reduceTransparency: false,
  performance: false,
  contrastTarget: 4.5,
};

const format = {
  intensity: (v) => `${v}%`,
  blur: (v) => `${v}px`,
  transparency: (v) => `${v}%`,
  contrastTarget: (v) => `${Number(v).toFixed(1)}:1`,
};

// ---- localization -----------------------------------------------------------
// chrome.i18n always follows the browser language and cannot be overridden,
// so a user-chosen language is read from its _locales/<lang>/messages.json.
// "auto" keeps chrome.i18n. (The manifest name/description stay on the
// browser language — Chrome gives extensions no way to change those.)

async function messagesFor(language) {
  if (language === 'auto') return (key) => chrome.i18n.getMessage(key);
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${language}/messages.json`));
    const messages = await res.json();
    return (key) => messages[key]?.message ?? chrome.i18n.getMessage(key);
  } catch {
    return (key) => chrome.i18n.getMessage(key);
  }
}

async function localize(language) {
  const t = await messagesFor(language);
  document.documentElement.lang = language === 'auto' ? chrome.i18n.getUILanguage() : language.replace('_', '-');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

const languageSelect = document.getElementById('language');

chrome.storage.sync.get({ language: 'auto' }).then(({ language }) => {
  languageSelect.value = language;
  localize(language);
});

languageSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ language: languageSelect.value });
  localize(languageSelect.value);
});

const inputs = [...document.querySelectorAll('[data-key]')];

function render(settings) {
  for (const input of inputs) {
    const key = input.dataset.key;
    if (input.type === 'checkbox') input.checked = !!settings[key];
    else input.value = settings[key];
    const out = document.querySelector(`output[data-for="${key}"]`);
    if (out) out.textContent = format[key](settings[key]);
  }
  document.body.classList.toggle('off', !settings.enabled);
}

chrome.storage.sync.get(DEFAULTS).then(render);

for (const input of inputs) {
  input.addEventListener('input', () => {
    const key = input.dataset.key;
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    const out = document.querySelector(`output[data-for="${key}"]`);
    if (out) out.textContent = format[key](value);
    if (key === 'enabled') document.body.classList.toggle('off', !value);
    chrome.storage.sync.set({ [key]: value });
  });
}

document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.sync.set(DEFAULTS);
  render(DEFAULTS);
});
