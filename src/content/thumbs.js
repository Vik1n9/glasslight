// Ambient colour when no video is playing: the hovered thumbnail, or the one
// nearest the centre of the viewport. YouTube thumbnails live on i.ytimg.com
// and would taint a canvas, so the service worker fetches and downsamples
// them. Site adapters (LG.site.thumbItems / thumbUrl, e.g. ani-gamer.js) point
// at image hosts that serve CORS, which the content script reads directly.
(() => {
  const W = 32;
  const H = 18;
  const YT_ITEM = [
    'ytd-rich-item-renderer',
    'yt-lockup-view-model',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytd-playlist-video-renderer',
  ].join(',');
  const ITEM = () => LG.site?.thumbItems || YT_ITEM;
  const ytThumb = (id) => (id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '');
  const thumbOf = (item) => (LG.site?.thumbUrl ? LG.site.thumbUrl(item) : ytThumb(videoIdOf(item)));

  const cache = new Map(); // thumbnail URL -> { pixels, w, h }
  let current = '';
  let hoverTimer = 0;
  let enabled = false;

  function videoIdOf(item) {
    const a = item.querySelector('a[href*="/watch?v="], a[href^="/shorts/"]');
    const href = a?.getAttribute('href') || '';
    return href.match(/[?&]v=([\w-]{11})/)?.[1] || href.match(/\/shorts\/([\w-]{11})/)?.[1] || '';
  }

  // Same 32×18 downsample as background.js, for CORS-enabled image hosts.
  async function directPixels(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, W, H);
    bitmap.close();
    return { pixels: ctx.getImageData(0, 0, W, H).data, w: W, h: H };
  }

  async function pixelsFor(url) {
    if (cache.has(url)) return cache.get(url);
    let res;
    try {
      res = new URL(url).hostname === 'i.ytimg.com'
        ? await chrome.runtime.sendMessage({ type: 'lg-thumb', url })
        : await directPixels(url);
    } catch {
      return null; // extension reloaded underneath us, or the image failed
    }
    if (!res?.pixels) return null;
    if (cache.size > 120) cache.delete(cache.keys().next().value);
    cache.set(url, res);
    return res;
  }

  async function show(url) {
    if (!url || url === current) return;
    current = url;
    const data = await pixelsFor(url);
    if (data && current === url) LG.ambient.showPixels(data.pixels, data.w, data.h);
  }

  function centreItem() {
    const cx = innerWidth / 2;
    const cy = innerHeight * 0.45;
    let best = null;
    let bestD = Infinity;
    for (const item of document.querySelectorAll(ITEM())) {
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
    if (item) show(thumbOf(item));
  }

  function onPointerOver(e) {
    if (!enabled) return;
    const item = e.target.closest?.(ITEM());
    if (!item) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => show(thumbOf(item)), 180);
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
      show(ytThumb(id));
    },
  };
})();
