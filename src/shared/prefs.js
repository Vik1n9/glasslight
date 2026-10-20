// Shared by the popup and the options page (extension pages, not content
// scripts): the chosen language, controls bound to chrome.storage.sync both
// ways, and writes kept inside its quota.
(() => {
  const LOCALES = ['en', 'es', 'ja', 'ko', 'zh_CN', 'zh_TW'];

  // 'auto' resolves here rather than through chrome.i18n, so labels and the
  // options page's descriptions always come from the same locale. (Chrome
  // would show English to zh-HK: it has no zh fallback folder to land on.)
  function resolveLocale(language) {
    if (LOCALES.includes(language)) return language;
    const ui = (chrome.i18n.getUILanguage() || 'en').replace('_', '-');
    if (/^zh-(TW|HK|MO|Hant)/i.test(ui)) return 'zh_TW';
    if (/^zh/i.test(ui)) return 'zh_CN';
    const base = ui.split('-')[0].toLowerCase();
    return LOCALES.includes(base) ? base : 'en';
  }

  const jsonCache = new Map();
  function readJson(path) {
    if (!jsonCache.has(path)) {
      jsonCache.set(
        path,
        fetch(chrome.runtime.getURL(path))
          .then((r) => r.json())
          .catch(() => ({})),
      );
    }
    return jsonCache.get(path);
  }

  /**
   * Translate the page: [data-i18n] text, [data-i18n-title] tooltips,
   * [data-i18n-aria] labels and [data-desc] descriptions (options page). A
   * key missing in the locale falls back to English, never to the key name.
   */
  async function localize(language) {
    const locale = resolveLocale(language);
    const [msgs, enMsgs, descs, enDescs] = await Promise.all([
      readJson(`_locales/${locale}/messages.json`),
      readJson('_locales/en/messages.json'),
      document.querySelector('[data-desc]') ? readJson(`src/options/descriptions/${locale}.json`) : {},
      document.querySelector('[data-desc]') ? readJson('src/options/descriptions/en.json') : {},
    ]);
    const t = (key) => msgs[key]?.message ?? enMsgs[key]?.message ?? '';
    document.documentElement.lang = locale.replace('_', '-');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    for (const el of document.querySelectorAll('[data-desc]')) el.textContent = descs[el.dataset.desc] ?? enDescs[el.dataset.desc] ?? '';
    return t;
  }

  // ---- writes -----------------------------------------------------------------
  // chrome.storage.sync allows 120 writes a minute; a slider used to write on
  // every input event, dozens per drag, and past the quota writes fail
  // silently. Values are batched and written WRITE_DELAY after the last
  // change; a released slider or a toggle writes at once, at most every
  // MIN_GAP, so a held arrow key stays inside the quota too.
  const WRITE_DELAY = 400;
  const MIN_GAP = 1000;
  const RETRY_DELAY = 20000;

  /** `onStatus(state, error)`: 'pending' · 'saving' · 'saved' · 'error'. */
  function createSaver(onStatus = () => {}) {
    let pending = {};
    let timer = 0;
    let lastWrite = -Infinity;

    async function flush() {
      clearTimeout(timer);
      timer = 0;
      const batch = pending;
      pending = {};
      if (!Object.keys(batch).length) return;
      lastWrite = performance.now();
      onStatus('saving');
      try {
        await chrome.storage.sync.set(batch);
        if (!timer && !Object.keys(pending).length) onStatus('saved');
      } catch (err) {
        pending = { ...batch, ...pending }; // newer values win
        onStatus('error', err);
        clearTimeout(timer);
        timer = setTimeout(flush, RETRY_DELAY);
      }
    }

    function later(ms) {
      clearTimeout(timer);
      timer = setTimeout(flush, ms);
    }

    // The popup closes the moment it loses focus; try to land what is left.
    addEventListener('pagehide', () => flush());

    return {
      set(key, value) {
        pending[key] = value;
        onStatus('pending');
        later(WRITE_DELAY);
      },
      /** Write now unless the last write was under MIN_GAP ago. */
      soon() {
        if (!Object.keys(pending).length) return;
        const wait = lastWrite + MIN_GAP - performance.now();
        if (wait <= 0) flush();
        else later(Math.max(wait, WRITE_DELAY));
      },
      flush,
      discard() {
        clearTimeout(timer);
        timer = 0;
        pending = {};
      },
      has: (key) => key in pending,
    };
  }

  // ---- controls -----------------------------------------------------------------

  const FORMAT = {
    intensity: (v) => `${v}%`,
    blur: (v) => `${v}px`,
    transparency: (v) => `${v}%`,
    contrastTarget: (v) => `${Number(v).toFixed(1)}:1`,
  };

  /**
   * Bind every [data-key] input to its setting: rendered from storage, saved
   * through `saver`, and kept current when another page (popup ↔ options)
   * changes a setting — except one this page is still about to write.
   */
  function bindControls(saver) {
    const inputs = [...document.querySelectorAll('[data-key]')];
    const show = (key, value) => {
      for (const out of document.querySelectorAll(`output[data-for="${key}"]`)) out.textContent = FORMAT[key](value);
    };
    const valueOf = (input) =>
      input.type === 'checkbox' ? input.checked : input.type === 'radio' ? input.value : Number(input.value);

    function render(settings, keys = Object.keys(settings)) {
      for (const input of inputs) {
        const key = input.dataset.key;
        if (!keys.includes(key)) continue;
        if (input.type === 'checkbox') input.checked = !!settings[key];
        else if (input.type === 'radio') input.checked = input.value === settings[key];
        else input.value = settings[key];
        if (FORMAT[key]) show(key, settings[key]);
      }
      if (keys.includes('enabled')) document.body.classList.toggle('off', !settings.enabled);
    }

    chrome.storage.sync.get(LG.DEFAULTS).then((s) => render(LG.clampSettings(s)));

    for (const input of inputs) {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        const value = valueOf(input);
        if (FORMAT[key]) show(key, value);
        if (key === 'enabled') document.body.classList.toggle('off', !value);
        saver.set(key, value);
      });
      input.addEventListener('change', () => saver.soon());
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const keys = Object.keys(changes).filter((k) => k in LG.DEFAULTS && !saver.has(k));
      if (!keys.length) return;
      const next = {};
      for (const k of keys) next[k] = changes[k].newValue ?? LG.DEFAULTS[k];
      render(LG.clampSettings({ ...LG.DEFAULTS, ...next }), keys);
    });

    return { render };
  }

  /** The language menu: stored apart from the settings, synced the same way. */
  function bindLanguage(select, onChange) {
    chrome.storage.sync.get({ language: 'auto' }).then(({ language }) => {
      select.value = language;
      onChange(language);
    });
    select.addEventListener('change', () => {
      chrome.storage.sync.set({ language: select.value }).catch(() => {});
      onChange(select.value);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.language) return;
      const language = changes.language.newValue ?? 'auto';
      if (select.value === language) return;
      select.value = language;
      onChange(language);
    });
  }

  LG.prefs = { resolveLocale, localize, createSaver, bindControls, bindLanguage };
})();
