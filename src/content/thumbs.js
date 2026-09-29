// Ambient colour when no video is playing: the hovered thumbnail, or the one
// nearest the centre of the viewport. Thumbnails live on i.ytimg.com and would
// taint a canvas, so the service worker fetches and downsamples them.
(() => {
  const ITEM = [
    'ytd-rich-item-renderer',
    'yt-lockup-view-model',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-playlist-video-renderer',
  ].join(',');

  const cache = new Map(); // videoId -> { pixels, w, h }
  let current = '';
  let hoverTimer = 0;
  let enabled = false;

  function videoIdOf(item) {
    const a = item.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
    const href = a?.getAttribute('href') || '';
    return href.match(/[?&]v=([\w-]{11})/)?.[1] || href.match(/\/shorts\/([\w-]{11})/)?.[1] || '';
  }

  async function pixelsFor(id) {
    if (cache.has(id)) return cache.get(id);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'lg-thumb', url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` });
    } catch {
      return null; // extension reloaded underneath us
    }
    if (!res?.pixels) return null;
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    cache.set(id, res);
    return res;
  }

  async function show(id) {
    if (!id || id === current) return;
    current = id;
    const data = await pixelsFor(id);
    if (data && current === id) LG.ambient.showPixels(data.pixels, data.w, data.h);
  }

  function centreItem() {
    const cx = innerWidth / 2;
    const cy = innerHeight * 0.45;
    let best = null;
    let bestD = Infinity;
    for (const item of document.querySelectorAll(ITEM)) {
      const r = item.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) continue;
      const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  function pickCentre() {
    if (!enabled) return;
    const item = centreItem();
    if (item) show(videoIdOf(item));
  }

  function onPointerOver(e) {
    if (!enabled) return;
    const item = e.target.closest?.(ITEM);
    if (!item) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => show(videoIdOf(item)), 180);
  }

  let scrollTimer = 0;
  function onScroll() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(pickCentre, 300);
  }

  document.addEventListener('pointerover', onPointerOver, { passive: true });
  addEventListener('scroll', onScroll, { passive: true });

  LG.thumbs = {
    /** Follow hovered / centred thumbnails (browse pages). */
    enable() {
      enabled = true;
      current = '';
      // The grid renders lazily after navigation; retry briefly.
      [100, 700, 1800].forEach((ms) => setTimeout(pickCentre, ms));
    },
    disable() {
      enabled = false;
      clearTimeout(hoverTimer);
    },
    /** Use a specific video's thumbnail (watch page before play / DRM). */
    showVideo(id) {
      current = '';
      show(id);
    },
  };
})();
