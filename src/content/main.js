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

  const refractionOn = () =>
    LG.settings.refraction && !LG.settings.performance && !LG.settings.reduceTransparency;

  function applySettings() {
    const s = LG.settings;
    html.classList.toggle('lg-on', s.enabled);
    html.classList.toggle('lg-reduce-transparency', s.reduceTransparency);
    html.classList.toggle('lg-perf', s.performance);
    html.classList.toggle('lg-refract', refractionOn());
    html.style.setProperty('--lg-blur', `${s.blur}px`);
    LG.refract.setBlur(s.blur);
    if (!refractionOn()) LG.refract.detachAll();
    if (!s.enabled) {
      LG.ambient.stop();
      LG.thumbs.disable();
      return;
    }
    LG.ambient.start({ onBlocked: () => LG.thumbs.showVideo(videoId()) });
    route();
  }

  // Player controls: tag the pill groups YouTube paints with a translucent
  // fill (delhi-modern player) as Clear-variant glass.
  function tagPlayerControls() {
    for (const el of document.querySelectorAll('.ytp-chrome-controls *:not(.lg-clear)')) {
      if (el.closest('.lg-clear')) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const alpha = bg.startsWith('rgba') ? parseFloat(bg.split(',')[3]) : bg === 'transparent' ? 0 : 1;
      if (alpha > 0.05 && alpha < 1 && el.offsetWidth >= 24) {
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

  function syncMastheadTheme() {
    const masthead = document.querySelector('ytd-masthead');
    if (!masthead) return;
    if (LG.settings.enabled && !html.hasAttribute('dark')) {
      if (masthead.hasAttribute('dark')) masthead.removeAttribute('dark');
      for (const el of masthead.querySelectorAll('[class*="Dark"]')) {
        for (const c of [...el.classList]) if (DARK_CLASS.test(c)) el.classList.remove(c);
      }
    }
    if (mastheadObserver?.target === masthead) return;
    mastheadObserver?.disconnect();
    mastheadObserver = new MutationObserver(syncMastheadTheme);
    mastheadObserver.target = masthead;
    mastheadObserver.observe(masthead, { attributes: true, attributeFilter: ['dark', 'class'], subtree: true });
  }

  // ---- adaptive shadow + specular highlight --------------------------------

  let scrolled = false;
  addEventListener(
    'scroll',
    () => {
      const next = scrollY > 4;
      if (next !== scrolled) html.classList.toggle('lg-scrolled', (scrolled = next));
    },
    { passive: true },
  );

  let specRaf = 0;
  addEventListener(
    'pointermove',
    (e) => {
      if (specRaf || LG.prefersReducedMotion()) return;
      specRaf = requestAnimationFrame(() => {
        specRaf = 0;
        // The rim highlight faces the pointer, like a light source.
        const angle = (Math.atan2(e.clientY - innerHeight / 2, e.clientX - innerWidth / 2) * 180) / Math.PI;
        html.style.setProperty('--lg-spec-angle', `${(angle + 90).toFixed(1)}deg`);
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
    // The player's <video> can be created after navigation finishes.
    document.addEventListener('yt-player-updated', route);
    // Light/dark theme switches change the base colour.
    new MutationObserver(() => {
      LG.ambient.tick();
      syncMastheadTheme();
    }).observe(html, { attributes: true, attributeFilter: ['dark'] });
    // YouTube re-renders chrome lazily; cheap periodic re-decoration.
    setInterval(() => {
      if (document.hidden) return;
      decorate();
      if ((isWatch() || isShorts()) && mainVideo()) LG.ambient.bindVideo(mainVideo());
    }, 2000);
  }

  boot();
})();
