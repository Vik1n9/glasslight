const DEFAULTS = {
  enabled: true,
  intensity: 70,
  blur: 24,
  refraction: true,
  reduceTransparency: false,
  performance: false,
  contrastTarget: 4.5,
};

const format = {
  intensity: (v) => `${v}%`,
  blur: (v) => `${v}px`,
  contrastTarget: (v) => `${Number(v).toFixed(1)}:1`,
};

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
