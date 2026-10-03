// Entry point for ani.gamer.com.tw (巴哈姆特動畫瘋): the same glass + ambient
// engine as main.js, wired to Bahamut's markup. The player is Video.js inside
// #video-container; the bars (.sky, .mainmenu) are fixed, and the theme lives
// in html[data-theme] — mirrored to html[dark] so glass.css and contrast.js
// (which key off [dark]) work unchanged.
(() => {
  const html = document.documentElement;

  // Bahamut's image CDN answers with Access-Control-Allow-Origin: *, so the
  // covers can be read without a host permission. Nothing else is fetched.
  const THUMB_HOST = /^https:\/\/p2\.bahamut\.com\.tw\//;

  LG.site = {
    // The rounded player card. Not .video-js: Bahamut's <video-js> element is
    // display: inline and measures 0×0 (the <video> inside is positioned
    // against .video), so the glow would be placed around nothing.
    playerSelector: '.videoframe .video',
    // The danmu / episode column beside the player.
    sidePanels: ['.container-player .subtitle'],
    // The enlarged backdrop stops at the bottom of the title block under the
    // player (title + release date); the description block itself is far
    // below the fold (ambient.js enlargedBox).
    description: '.anime_name',
    descriptionEdge: 'bottom',
    glassScope: ['.user-setting-toolbox', '.anime_search .anime_search-content', '.app-download-toolbox', '.btn-newanime-filter .filter-items'],
    // Browse pages: the anime cards whose cover lights the page (thumbs.js).
    // Home: new episodes, continue watching, extended cards; lists / search:
    // .theme-list-main; watch history: the whole row (a .click-area link covers it).
    thumbItems: '.anime-card-block, .continue-watch-card .img-block, .extend-card, .theme-list-main, .user-watch-list .anime-card',
    thumbUrl: (item) => {
      for (const img of item.querySelectorAll('img')) {
        // Lazy images keep the real URL in data-src until they scroll in.
        const url = [img.currentSrc, img.dataset.src, img.src].find((u) => THUMB_HOST.test(u || ''));
        if (url) return url;
      }
      return '';
    },
  };

  const NAV_GLASS = [
    // [selector, refraction options]
    ['.top_sky .sky', { radius: 22, bezel: 12, scale: 22 }],
    ['.mainmenu', { radius: 22, bezel: 12, scale: 22 }],
  ];

  const isWatch = () => location.pathname.endsWith('/animeVideo.php');
  const mainVideo = () => document.querySelector('#video-container video.vjs-tech, #video-container .video-js video');

  // ---- settings (same recipe as main.js) ---------------------------------------

  let frost = '';
  let scrolled = false;
  const fullFrost = (s) => s.blur * (1 + 0.25 * Math.max(0, (50 - s.transparency) / 50));
  function applyFrost() {
    const full = fullFrost(LG.settings);
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

  function syncTheme() {
    html.toggleAttribute('dark', html.getAttribute('data-theme') === 'dark');
  }

  function applySettings() {
    const s = LG.settings;
    html.classList.toggle('lg-on', s.enabled);
    html.classList.toggle('lg-ani', s.enabled);
    html.classList.toggle('lg-reduce-transparency', s.reduceTransparency);
    html.classList.toggle('lg-perf', s.performance);
    html.classList.toggle('lg-refract', refractionOn());
    const t = s.transparency > 50 ? 50 + 50 * LG.immersion() : s.transparency;
    html.style.setProperty('--lg-transparency', (t / 100).toFixed(2));
    html.style.setProperty('--lg-blur-full', `${fullFrost(s).toFixed(1)}px`);
    applyFrost();
    if (!refractionOn()) LG.refract.detachAll();
    if (!s.enabled) {
      LG.ambient.stop();
      LG.thumbs.disable();
      return;
    }
    LG.ambient.start();
    route();
  }

  // ---- decoration ------------------------------------------------------------------

  function decorate() {
    if (!LG.settings.enabled) return;
    LG.refract.prune();
    for (const [sel, opts] of NAV_GLASS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      el.classList.add('lg-glass');
      if (refractionOn()) LG.refract.attach(el, opts);
    }
    const bar = document.querySelector('.video-js .vjs-control-bar');
    if (bar && !bar.classList.contains('lg-clear')) {
      bar.classList.add('lg-clear');
      if (refractionOn()) LG.refract.attach(bar, { radius: 16, bezel: 10, scale: 18, blur: 8, saturate: 1.6 });
    }
  }

  function route() {
    if (!LG.settings.enabled) return;
    const v = isWatch() ? mainVideo() : null;
    if (v) LG.ambient.bindVideo(v);
    else LG.ambient.unbindVideo();
    if (isWatch()) LG.thumbs.disable();
    else LG.thumbs.enable();
    html.classList.toggle('lg-watch', isWatch());
    html.classList.toggle('lg-player-page', isWatch());
    decorate();
  }

  // ---- adaptive shadow + specular highlight ---------------------------------------

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

  // ---- boot --------------------------------------------------------------------------

  async function boot() {
    await LG.loadSettings();
    if (!document.body) await new Promise((r) => addEventListener('DOMContentLoaded', r, { once: true }));
    syncTheme();
    LG.onSettings(applySettings);
    applySettings();

    // The site's light / dark switch rewrites html[data-theme].
    new MutationObserver(() => {
      syncTheme();
      LG.ambient.tick();
    }).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    // Video.js creates its <video> after load, and recreates it between ads
    // and the episode; cheap periodic re-binding and re-decoration.
    setInterval(() => {
      if (document.hidden) return;
      decorate();
      const v = isWatch() ? mainVideo() : null;
      if (v) LG.ambient.bindVideo(v);
    }, 1500);
  }

  boot();
})();
