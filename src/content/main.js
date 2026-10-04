// Entry point: settings → html classes, SPA routing, glass decoration.
(() => {
  const html = document.documentElement;

  const NAV_GLASS = [
    // [selector, refraction options]
    ['ytd-masthead #container.ytd-masthead', { radius: 28, bezel: 16, scale: 30 }],
    ['ytd-feed-filter-chip-bar-renderer #chips-wrapper', { radius: 24, bezel: 14, scale: 26 }],
    ['ytd-tabbed-page-header #tabs-inner-container', { radius: 24, bezel: 14, scale: 26 }],
  ];

  const isWatch = () => location.pathname === '/watch' || location.pathname.startsWith('/live/');
  const isShorts = () => location.pathname.startsWith('/shorts/');
  const videoId = () =>
    new URLSearchParams(location.search).get('v') || location.pathname.match(/\/shorts\/([\w-]{11})/)?.[1] || '';

  function mainVideo() {
    if (isShorts()) return document.querySelector('#shorts-player video, ytd-reel-video-renderer[is-active] video');
    return document.querySelector('#movie_player video.html5-main-video');
  }

  // Towards solid the glass frosts harder (thicker glass); Clear glass frosts
  // less so the footage behind stays recognisable, but never under 8 px, so
  // it still reads as glass. Over scrolled content the frost is full
  // (scroll edge effect).
  let frost = '';
  const fullFrost = (s) => s.blur * (1 + 0.25 * Math.max(0, (50 - s.transparency) / 50));
  function applyFrost() {
    const s = LG.settings;
    const full = fullFrost(s);
    // Clear glass (past the midpoint) frosts less, down to a quarter at 100 —
    // a light 2–6 px that reads as glass, not frosted glass. Content
    // scrolling underneath keeps the full frost (text under text).
    const px = scrolled ? full : full * (1 - 0.75 * LG.immersion());
    const next = `${px.toFixed(1)}px`;
    if (next === frost) return;
    frost = next;
    html.style.setProperty('--lg-blur', next);
    LG.refract.setBlur(px);
  }

  const refractionOn = () =>
    LG.settings.refraction && !LG.settings.performance && !LG.settings.reduceTransparency;

  function applySettings() {
    const s = LG.settings;
    html.classList.toggle('lg-on', s.enabled);
    html.classList.toggle('lg-reduce-transparency', s.reduceTransparency);
    html.classList.toggle('lg-perf', s.performance);
    html.classList.toggle('lg-refract', refractionOn());
    // Past the midpoint only as far as LG.immersion allows (Reduce
    // Transparency pins it there).
    const t = s.transparency > 50 ? 50 + 50 * LG.immersion() : s.transparency;
    html.style.setProperty('--lg-transparency', (t / 100).toFixed(2));
    html.style.setProperty('--lg-blur-full', `${fullFrost(s).toFixed(1)}px`);
    applyFrost();
    if (!refractionOn()) LG.refract.detachAll();
    if (!s.enabled) {
      LG.ambient.stop();
      LG.thumbs.disable();
      restoreMastheadTheme();
      fitPlaylist();
      return;
    }
    LG.ambient.start({ onBlocked: () => LG.thumbs.showVideo(videoId()) });
    route();
  }

  // Player controls: tag the pill groups YouTube paints with a translucent
  // fill (delhi-modern player) as Clear-variant glass.
  // Runs every 2 s, and getComputedStyle forces a style resolve on YouTube's
  // large DOM, so decisions are cached per element: re-rendered chrome nodes
  // are new elements and still get scanned, and hidden ones (width 0, e.g.
  // mode-specific buttons) stay open for a later pass. A pill's fill is
  // static once measurable, so a decided element is never read again.
  const controlDecided = new WeakSet();
  function tagPlayerControls() {
    for (const el of document.querySelectorAll('.ytp-chrome-controls *:not(.lg-clear)')) {
      if (controlDecided.has(el) || el.closest('.lg-clear')) continue;
      if (el.offsetWidth < 24) continue; // not laid out yet — decide later
      controlDecided.add(el);
      const bg = getComputedStyle(el).backgroundColor;
      const alpha = bg.startsWith('rgba') ? parseFloat(bg.split(',')[3]) : bg === 'transparent' ? 0 : 1;
      if (alpha > 0.05 && alpha < 1) {
        el.classList.add('lg-clear');
        if (refractionOn()) LG.refract.attach(el, { radius: el.offsetHeight / 2, bezel: 10, scale: 18, blur: 8, saturate: 1.6 });
      }
    }
  }

  function decorate() {
    if (!LG.settings.enabled) return;
    LG.refract.prune();
    for (const [sel, opts] of NAV_GLASS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.classList.add('lg-glass');
      if (refractionOn()) LG.refract.attach(el, opts);
    }
    if (isWatch()) tagPlayerControls();
  }

  // Light watch page: dark text needs a bright backdrop, which washed the
  // whole page out. Its content becomes frosted cards instead (glass.css,
  // ambient.js); the backdrop between them keeps the footage's colour.
  function syncCards() {
    html.classList.toggle('lg-cards', isWatch() && !html.hasAttribute('dark'));
  }

  // Playlist beside the player (not theater): end it level with the player's
  // bottom. YouTube caps it at its own panel height, 33-74 px taller than the
  // player depending on the window width, so only the player's real rect
  // gives the number. Layout reads only on resize / navigation / the 2 s
  // re-decoration, never per frame.
  const playlistFit = new ResizeObserver(() => fitPlaylist());
  let fitPlayer = null;
  function fitPlaylist() {
    const pl = document.querySelector('ytd-playlist-panel-renderer#playlist');
    if (!pl) return;
    const flexy = pl.closest('ytd-watch-flexy');
    const player = flexy?.querySelector('#player');
    if (player && player !== fitPlayer) {
      playlistFit.disconnect();
      playlistFit.observe(player);
      fitPlayer = player;
    }
    let h = '';
    if (LG.settings.enabled && isWatch() && player && !flexy.hasAttribute('theater') && !flexy.hasAttribute('fullscreen')) {
      const p = player.getBoundingClientRect();
      // Only when the playlist starts level with the player (no panel above it).
      if (p.height > 200 && Math.abs(pl.getBoundingClientRect().top - p.top) < 2) h = `${Math.round(p.height)}px`;
    }
    if (pl.style.getPropertyValue('max-height') === h) return;
    if (h) pl.style.setProperty('max-height', h, 'important');
    else pl.style.removeProperty('max-height');
  }

  function route() {
    if (!LG.settings.enabled) return;
    if (isWatch() || isShorts()) {
      LG.thumbs.disable();
      const v = mainVideo();
      if (v) LG.ambient.bindVideo(v);
      if (!LG.ambient.isVideoLive()) LG.thumbs.showVideo(videoId());
    } else {
      LG.ambient.unbindVideo();
      LG.thumbs.enable();
    }
    html.classList.toggle('lg-watch', isWatch());
    syncCards();
    fitPlaylist();
    html.classList.toggle('lg-player-page', isWatch() || isShorts());
    syncMastheadTheme();
    decorate();
  }

  // ---- masthead theme --------------------------------------------------------
  // In theater mode YouTube flags the masthead [dark] because it normally sits
  // on the black theater backdrop. Ours floats as glass over the page, so on a
  // light page it must stay light (same look as the home page).
  let mastheadObserver = null;

  // The searchbox also gets its own *Dark classes (ytSearchboxComponentHostDark…).
  const DARK_CLASS = /^ytSearchboxComponent\w*Dark$/;

  // What we stripped, so turning the extension off hands YouTube its own
  // masthead back.
  const stripped = { dark: null, classes: [] };

  function restoreMastheadTheme() {
    if (stripped.dark?.isConnected) stripped.dark.setAttribute('dark', '');
    for (const [el, c] of stripped.classes) if (el.isConnected) el.classList.add(c);
    stripped.dark = null;
    stripped.classes = [];
  }

  function syncMastheadTheme() {
    const masthead = document.querySelector('ytd-masthead');
    if (!masthead) return;
    if (LG.settings.enabled && !html.hasAttribute('dark')) {
      if (masthead.hasAttribute('dark')) {
        masthead.removeAttribute('dark');
        stripped.dark = masthead;
      }
      for (const el of masthead.querySelectorAll('[class*="Dark"]')) {
        for (const c of [...el.classList]) {
          if (!DARK_CLASS.test(c)) continue;
          el.classList.remove(c);
          stripped.classes.push([el, c]);
        }
      }
      // Our own attribute writes retrigger the observer below; drop those
      // records so one theater-mode toggle costs one scan, not two.
      mastheadObserver?.takeRecords();
    }
    if (mastheadObserver?.target === masthead) return;
    mastheadObserver?.disconnect();
    mastheadObserver = new MutationObserver(syncMastheadTheme);
    mastheadObserver.target = masthead;
    mastheadObserver.observe(masthead, { attributes: true, attributeFilter: ['dark', 'class'], subtree: true });
  }

  // ---- vibrancy for design tokens ----------------------------------------------
  // glass.css raises secondary text (#aaa → #c6c6c6 dark, #606060 → #4a4a4a
  // light) so the light behind it can stay brighter; contrast.js solves the
  // scrim for that raised colour. Newer YouTube components colour it through
  // hashed design tokens instead of --yt-spec-text-secondary, with names that
  // can change between builds, so they are found by value: a token that is
  // #aaa under [dark] and #606060 under [light] (likewise the link blue, see
  // TOKEN_VIBRANCY). (Tokens the other way round
  // are inverse colours for dark overlays and stay as they are.) The scan
  // walks YouTube's ~30k CSS rules in idle-time slices, once per sheet.
  const THEME_RULE = /^(?:html)?\[(dark|light)\]$/;
  const TOKEN_DECL = /(--t[0-9a-f]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi;
  const tokenValues = new Map(); // name -> { dark: Set, light: Set }
  const scannedSheets = new WeakSet();
  let tokenStyle = null;
  let tokenCss = '';
  let scanning = false;

  function collectTokens(rule, theme) {
    for (const [, name, value] of rule.style.cssText.matchAll(TOKEN_DECL)) {
      let seen = tokenValues.get(name);
      if (!seen) tokenValues.set(name, (seen = { dark: new Set(), light: new Set() }));
      seen[theme].add(value.toLowerCase());
    }
  }

  // [YouTube's dark value(s), its light value, our dark, our light]. Link blue
  // sits on the wrong side of the protected grey in both themes (lighter on a
  // light page, darker on a dark one), so it is deepened / lifted the same way.
  const TOKEN_VIBRANCY = [
    [['#aaa', '#aaaaaa'], '#606060', '#c6c6c6', '#4a4a4a'], // secondary text
    [['#3ea6ff'], '#065fd4', '#b0dbff', '#0b3fa0'], // links (call to action)
  ];

  function writeTokens() {
    const dark = [];
    const light = [];
    for (const [name, v] of tokenValues) {
      for (const [ytDark, ytLight, ours, oursLight] of TOKEN_VIBRANCY) {
        if (!ytDark.some((c) => v.dark.has(c)) || !v.light.has(ytLight)) continue;
        dark.push(`${name}: ${ours} !important;`);
        light.push(`${name}: ${oursLight} !important;`);
      }
    }
    // Components re-declare the tokens under their own [dark] / [light]
    // attribute; override those too (same theme only — an inverse overlay,
    // [light] inside a dark page, keeps its colours).
    const css = dark.length
      ? `html.lg-on[dark], html.lg-on[dark] ytd-app, html.lg-on[dark] [dark] { ${dark.join(' ')} }\n` +
        `html.lg-on:not([dark]), html.lg-on:not([dark]) ytd-app, html.lg-on:not([dark]) [light] { ${light.join(' ')} }`
      : '';
    if (css === tokenCss) return;
    tokenCss = css;
    tokenStyle ??= document.createElement('style');
    tokenStyle.id = 'lg-token-vibrancy';
    tokenStyle.textContent = css;
    if (!tokenStyle.isConnected) (document.head || html).append(tokenStyle);
  }

  function raiseSecondaryTokens() {
    if (scanning) return;
    const sheets = [...document.styleSheets, ...document.adoptedStyleSheets].filter((s) => !scannedSheets.has(s));
    if (!sheets.length) return;
    scanning = true;
    const stack = []; // [rules, next index] per nesting level
    const step = (deadline) => {
      while (deadline.timeRemaining() > 2) {
        if (!stack.length) {
          const sheet = sheets.shift();
          if (!sheet) {
            scanning = false;
            writeTokens();
            return;
          }
          scannedSheets.add(sheet);
          try {
            stack.push([sheet.cssRules, 0]);
          } catch {
            // cross-origin sheet
          }
          continue;
        }
        const level = stack[stack.length - 1];
        const rule = level[0][level[1]];
        if (!rule) {
          stack.pop();
          continue;
        }
        level[1] += 1;
        if (rule.cssRules?.length) stack.push([rule.cssRules, 0]); // @media, @layer, nesting
        const theme = rule.selectorText && THEME_RULE.exec(rule.selectorText)?.[1];
        if (theme) collectTokens(rule, theme);
      }
      requestIdleCallback(step);
    };
    requestIdleCallback(step);
  }

  // ---- adaptive shadow + specular highlight --------------------------------

  let scrolled = false;
  addEventListener(
    'scroll',
    () => {
      const next = scrollY > 4;
      if (next === scrolled) return;
      html.classList.toggle('lg-scrolled', (scrolled = next));
      applyFrost();
    },
    { passive: true },
  );

  // The rim highlight faces the pointer, like a light source. Written on the
  // few glass elements only (not <html>, which would restyle the whole page),
  // in 3° steps so small pointer moves cost nothing.
  let specRaf = 0;
  let specAngle = '';
  addEventListener(
    'pointermove',
    (e) => {
      if (specRaf || LG.prefersReducedMotion() || !LG.settings.enabled) return;
      specRaf = requestAnimationFrame(() => {
        specRaf = 0;
        const deg = (Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2) * 180) / Math.PI + 90;
        const next = `${Math.round(deg / 3) * 3}deg`;
        if (next === specAngle) return;
        specAngle = next;
        for (const el of document.querySelectorAll('.lg-glass, .lg-clear')) el.style.setProperty('--lg-spec-angle', next);
      });
    },
    { passive: true },
  );

  // ---- boot ------------------------------------------------------------------

  async function boot() {
    await LG.loadSettings();
    if (!document.body) await new Promise((r) => addEventListener('DOMContentLoaded', r, { once: true }));
    LG.onSettings(applySettings);
    applySettings();

    document.addEventListener('yt-navigate-finish', route);
    // YouTube's stylesheets load after document_start; late ones on navigation.
    if (document.readyState === 'complete') raiseSecondaryTokens();
    else addEventListener('load', raiseSecondaryTokens, { once: true });
    document.addEventListener('yt-navigate-finish', raiseSecondaryTokens);
    // The player's <video> can be created after navigation finishes.
    document.addEventListener('yt-player-updated', route);
    // Light/dark theme switches change the base colour.
    new MutationObserver(() => {
      syncCards();
      LG.ambient.tick();
      syncMastheadTheme();
    }).observe(html, { attributes: true, attributeFilter: ['dark'] });
    // YouTube re-renders chrome lazily; cheap periodic re-decoration.
    setInterval(() => {
      if (document.hidden) return;
      decorate();
      fitPlaylist();
      const v = isWatch() || isShorts() ? mainVideo() : null;
      if (v) LG.ambient.bindVideo(v);
    }, 2000);
  }

  boot();
})();
