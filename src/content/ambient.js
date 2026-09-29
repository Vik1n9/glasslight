// Page-wide ambient light. The playing video (or a thumbnail when nothing is
// playing) is drawn into a tiny canvas that is stretched over the viewport
// behind all of YouTube. Frame scheduling via requestVideoFrameCallback,
// letterbox cropping and hidden-tab pausing follow the approach of
// WesselKroos/youtube-ambilight (MIT), heavily simplified.
(() => {
  const W = 96;
  const H = 54;
  const SAMPLE_W = 32;
  const SAMPLE_H = 18;
  const STATS_MS = 250;

  let root;
  let display;
  let dctx;
  let sample;
  let sctx;
  let probe; // raw-frame canvas for bar / brightness / DRM detection (GPU)
  let pctx;
  let probeRead; // CPU copy of the 32×18 probe, the only one read back
  let prctx;
  let glow; // unscrimmed light radiating from behind the player
  let gctx;
  let glowKey = '';
  let glowClip; // screen-space clip so the glow never half-covers side panels
  let glassAlpha = 0;

  // Glow margin around the player, px. Portrait players (Shorts) have empty
  // space beside them, so their halo spreads wider.
  const GLOW_SIDE = 72;
  const GLOW_SIDE_PORTRAIT = 140;
  const GLOW_TOP = 72;
  const GLOW_BOTTOM = 20;
  const GLOW_EDGE_PX = 44; // on-screen softness of the halo's side edges
  const GLOW_FADE_PX = 32; // fade before a side panel instead of a hard cut

  let video = null;
  let frameCb = 0;
  let lastDraw = 0;
  let statsTimer = 0;
  let fadeRaf = 0;
  let blackTicks = 0;
  let videoBlocked = false;
  let crop = { x: 0, y: 0, w: 1, h: 1 }; // fraction of the frame to use
  let onBlocked = () => {};

  const fps = () => (LG.settings.performance ? 15 : 30);
  const active = () => LG.settings.enabled && !document.hidden && !document.fullscreenElement;

  function mount() {
    if (root?.isConnected) return;
    root = document.createElement('div');
    root.id = 'lg-ambient';
    root.setAttribute('aria-hidden', 'true');
    display = document.createElement('canvas');
    display.width = W;
    display.height = H;
    display.id = 'lg-ambient-canvas';
    dctx = display.getContext('2d', { alpha: false });
    dctx.fillStyle = LG.isDarkTheme() ? '#0f0f0f' : '#f9f9fa';
    dctx.fillRect(0, 0, W, H);
    const scrim = document.createElement('div');
    scrim.id = 'lg-scrim';
    glow = document.createElement('canvas');
    glow.width = W;
    glow.height = H;
    glow.id = 'lg-glow';
    gctx = glow.getContext('2d', { alpha: false });
    // The glow sits in an untransformed full-viewport wrapper so it can be
    // clipped in screen coordinates (see placeGlow).
    glowClip = document.createElement('div');
    glowClip.id = 'lg-glow-clip';
    glowClip.append(glow);
    root.append(display, scrim, glowClip);
    (document.body || document.documentElement).prepend(root);

    sample = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    sctx = sample.getContext('2d', { willReadFrequently: true });
    // Two steps on purpose: drawing the video straight into a
    // willReadFrequently (CPU) canvas reads the full-resolution frame back
    // from the GPU (~15 ms for 4K), while getImageData on a GPU canvas trips
    // Chrome's readback warning. Scale on the GPU, then copy 32×18 to CPU.
    probe = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    pctx = probe.getContext('2d');
    probeRead = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    prctx = probeRead.getContext('2d', { willReadFrequently: true });
  }

  // ---- video source --------------------------------------------------------

  function drawVideo() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const sx = crop.x * vw;
    const sy = crop.y * vh;
    const sw = crop.w * vw;
    const sh = crop.h * vh;
    dctx.globalAlpha = LG.prefersReducedMotion() ? 0.08 : 0.22; // temporal smoothing
    dctx.filter = 'blur(2px) saturate(1.35)';
    // Slight overscan so the blurred edges do not fade to black.
    dctx.drawImage(video, sx, sy, sw, sh, -6, -4, W + 12, H + 8);
    dctx.filter = 'none';
    dctx.globalAlpha = 1;
    gctx.drawImage(display, 0, 0);
  }

  // Keep the glow canvas scaled onto the player's on-screen rect.
  function placeGlow() {
    const player = video?.closest('.html5-video-player'); // #movie_player or #shorts-player
    if (!glow || !player) return;
    const r = player.getBoundingClientRect();
    // Side panels right of the player (playlist, live chat, recommendations
    // column; theater-mode chat) are content: the halo stops at their edge
    // instead of washing over part of them.
    const clipAt = panelEdgeRightOf(r);
    const key = `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0},${clipAt | 0}`;
    if (key === glowKey) return;
    glowKey = key;
    const side = r.height > r.width ? GLOW_SIDE_PORTRAIT : GLOW_SIDE;
    const w = r.width + side * 2;
    const h = r.height + GLOW_TOP + GLOW_BOTTOM;
    const sx = w / W;
    glow.style.transform = `translate(${r.left - side}px, ${r.top - GLOW_TOP}px) scale(${sx}, ${h / H})`;
    // The blur runs in canvas pixels before scaling; size it for the screen.
    glow.style.filter = `blur(${(GLOW_EDGE_PX / sx).toFixed(2)}px) saturate(1.6) brightness(var(--lg-glow-lift, 1))`;
    // Masks live on the full-viewport wrapper, never on the glow itself: a
    // mask clips an element to its own box, which would cut off the blur's
    // spill and leave hard vertical edges. Two soft stops, intersected:
    //  - bottom: fade out just under the player, where the title sits;
    //  - side panel: fade out before it instead of a hard seam.
    const glowTop = r.top - GLOW_TOP;
    const bottom = `linear-gradient(to bottom, #000 ${glowTop + h * 0.82}px, transparent ${glowTop + h}px)`;
    const sideFade =
      clipAt < innerWidth
        ? `linear-gradient(to right, #000 ${Math.max(0, clipAt - GLOW_FADE_PX)}px, transparent ${clipAt}px)`
        : 'linear-gradient(#000, #000)';
    const mask = `${bottom}, ${sideFade}`;
    glowClip.style.maskImage = mask;
    glowClip.style.maskComposite = 'intersect';
    glowClip.style.webkitMaskImage = mask;
    glowClip.style.webkitMaskComposite = 'source-in';
  }

  const SIDE_PANELS = [
    '#secondary.ytd-watch-flexy',
    '#panels-full-bleed-container.ytd-watch-flexy',
    'ytd-live-chat-frame',
  ];

  // Left edge of the nearest visible panel to the right of the player that
  // overlaps it vertically; innerWidth when there is none.
  function panelEdgeRightOf(r) {
    let edge = innerWidth;
    for (const sel of SIDE_PANELS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const p = el.getBoundingClientRect();
      if (!p.width || !p.height) continue;
      const beside = p.left >= r.right - 1 && p.top < r.bottom && p.bottom > r.top;
      if (beside) edge = Math.min(edge, p.left);
    }
    return edge;
  }

  // Reposition only when geometry can change — never per video frame, which
  // would force a layout on YouTube's large DOM 30 times a second.
  let glowRaf = 0;
  const queueGlow = () => {
    if (!glowRaf) glowRaf = requestAnimationFrame(() => ((glowRaf = 0), placeGlow()));
  };
  addEventListener('scroll', queueGlow, { passive: true });
  addEventListener('resize', queueGlow, { passive: true });
  const playerResize = new ResizeObserver(queueGlow);

  function onFrame(now) {
    frameCb = 0;
    if (!video || videoBlocked) return;
    if (active() && now - lastDraw >= 1000 / fps() - 2) {
      lastDraw = now;
      try {
        drawVideo();
      } catch {
        // Tainted / protected media: fall back to the thumbnail.
        blockVideo();
        return;
      }
    }
    schedule();
  }

  function schedule() {
    if (!video || frameCb || videoBlocked) return;
    if (video.paused || video.ended || !active()) return;
    frameCb = video.requestVideoFrameCallback(onFrame);
  }

  function cancel() {
    if (frameCb && video) video.cancelVideoFrameCallback(frameCb);
    frameCb = 0;
  }

  function blockVideo() {
    cancel();
    videoBlocked = true;
    onBlocked();
  }

  // Draw a single frame when paused/seeked so the light matches the picture.
  function drawOnce() {
    if (!video || videoBlocked || !active()) return;
    try {
      for (let i = 0; i < 6; i += 1) drawVideo(); // converge the smoothing
    } catch {
      blockVideo();
    }
  }

  const videoEvents = {
    play: () => schedule(),
    playing: () => schedule(),
    seeked: () => drawOnce(),
    pause: () => drawOnce(),
    loadeddata: () => {
      videoBlocked = false;
      blackTicks = 0;
      crop = { x: 0, y: 0, w: 1, h: 1 };
      drawOnce();
      schedule();
    },
  };

  function bindVideo(el) {
    if (el === video) {
      schedule();
      return;
    }
    unbindVideo();
    video = el;
    videoBlocked = false;
    blackTicks = 0;
    playerResize.disconnect();
    const player = video.closest('.html5-video-player');
    if (player) playerResize.observe(player);
    glowKey = '';
    queueGlow();
    for (const [ev, fn] of Object.entries(videoEvents)) video.addEventListener(ev, fn);
    if (video.readyState >= 2) drawOnce();
    schedule();
  }

  function unbindVideo() {
    cancel();
    if (!video) return;
    for (const [ev, fn] of Object.entries(videoEvents)) video.removeEventListener(ev, fn);
    video = null;
  }

  const videoLive = () => !!video && !videoBlocked && video.readyState >= 2;

  // ---- raw frame analysis: letterbox crop, DRM detection, player brightness --

  function analyseRawFrame() {
    if (!videoLive() || !video.videoWidth) return;
    let px;
    try {
      pctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      prctx.drawImage(probe, 0, 0);
      px = prctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    } catch {
      blockVideo();
      return;
    }

    const dark = (o) => px[o] < 14 && px[o + 1] < 14 && px[o + 2] < 14;
    const rowDark = (y) => {
      for (let x = 0; x < SAMPLE_W; x += 1) if (!dark((y * SAMPLE_W + x) * 4)) return false;
      return true;
    };
    const colDark = (x) => {
      for (let y = 0; y < SAMPLE_H; y += 1) if (!dark((y * SAMPLE_W + x) * 4)) return false;
      return true;
    };

    // All black while playing for ~8s → protected content (or a very long
    // black scene, where the thumbnail is a fine substitute anyway).
    let allDark = true;
    for (let y = 0; y < SAMPLE_H && allDark; y += 1) allDark = rowDark(y);
    if (allDark && !video.paused && video.currentTime > 2) {
      blackTicks += 1;
      if (blackTicks > 8000 / (STATS_MS * 2)) blockVideo(); // analysed every 2nd tick
      return;
    }
    blackTicks = 0;
    if (allDark) return;

    // Letterbox / pillarbox detection (max 25% per side).
    let top = 0;
    while (top < SAMPLE_H * 0.25 && rowDark(top)) top += 1;
    let bottom = 0;
    while (bottom < SAMPLE_H * 0.25 && rowDark(SAMPLE_H - 1 - bottom)) bottom += 1;
    let left = 0;
    while (left < SAMPLE_W * 0.25 && colDark(left)) left += 1;
    let right = 0;
    while (right < SAMPLE_W * 0.25 && colDark(SAMPLE_W - 1 - right)) right += 1;
    crop = {
      x: left / SAMPLE_W,
      y: top / SAMPLE_H,
      w: (SAMPLE_W - left - right) / SAMPLE_W,
      h: (SAMPLE_H - top - bottom) / SAMPLE_H,
    };

    // Clear-glass player controls need a dimming layer over bright footage.
    const bottomLum = LG.contrast.bandLuminance(px, SAMPLE_W, Math.floor(SAMPLE_H * 0.7), SAMPLE_H);
    document.documentElement.classList.toggle('lg-video-bright', bottomLum > 0.42);
  }

  // ---- still-image source (thumbnails) ------------------------------------

  const still = new OffscreenCanvas(1, 1);
  const stillCtx = still.getContext('2d');

  /** Crossfade the ambient light to an RGBA pixel buffer (w×h). */
  function showPixels(pixels, w, h) {
    if (videoLive() && !video.paused) return; // the video wins
    still.width = w;
    still.height = h;
    stillCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
    cancelAnimationFrame(fadeRaf);
    const start = performance.now();
    const duration = LG.prefersReducedMotion() ? 1 : 1400;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      dctx.globalAlpha = t >= 1 ? 1 : 0.07;
      // Thumbnails are busier and duller than moving footage: push colour harder.
      dctx.filter = 'blur(3px) saturate(1.9) brightness(1.1)';
      dctx.drawImage(still, -6, -4, W + 12, H + 8);
      dctx.filter = 'none';
      dctx.globalAlpha = 1;
      if (t < 1) fadeRaf = requestAnimationFrame(step);
    };
    fadeRaf = requestAnimationFrame(step);
  }

  // ---- stats → CSS variables (legibility + light spill) --------------------

  let tickCount = 0;

  function tick() {
    if (!active()) return;
    // Letterbox / brightness / DRM checks don't need 4 Hz.
    if ((tickCount += 1) % 2 === 0) analyseRawFrame();
    sctx.drawImage(display, 0, 0, SAMPLE_W, SAMPLE_H);
    const px = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    const dark = LG.isDarkTheme();
    const opacity = ambientOpacity();
    const scrim = LG.contrast.smoothScrim(
      LG.contrast.solveScrim(px, opacity, dark, LG.settings.contrastTarget),
    );
    const { rgb, lum } = LG.contrast.dominantColor(px);

    // Navigation glass floats over the unscrimmed glow (masthead sits on its
    // top rows). Solve its tint density the same way, with some headroom for
    // the saturate() in the glass backdrop-filter.
    let glowOpacity = videoLive() ? opacity * 0.85 : 0;
    // On a light page a dark frame's glow reads as a shadow, not light:
    // lift mid-dark footage so it stays colourful, and fade the glow out as
    // the frame approaches black (brightness can't lift black).
    let glowLift = 1;
    if (!dark) {
      const t = Math.min(1, Math.max(0, (lum - 0.03) / (0.22 - 0.03)));
      glowOpacity *= t * t * (3 - 2 * t); // smoothstep
      glowLift = 1 + 0.8 * (1 - Math.min(1, lum / 0.3));
    }
    let glass = 0;
    if (glowOpacity > 0) {
      const top = px.subarray(0, SAMPLE_W * 4 * 4); // top 4 rows
      glass = Math.min(0.92, LG.contrast.solveScrim(top, glowOpacity, dark, LG.settings.contrastTarget) + 0.08);
    }
    glassAlpha = glass > glassAlpha ? glass : glassAlpha + (glass - glassAlpha) * 0.15;

    // Read layout before any write below: a write followed by a layout read
    // forces a synchronous style recalc (~50 ms on YouTube's DOM).
    placeGlow();

    // Light-layer values live on #lg-ambient: changing them restyles only
    // its three children, not the whole page.
    const a = root.style;
    setVar(a, '--lg-ambient-opacity', opacity.toFixed(2));
    setVar(a, '--lg-glow-opacity', glowOpacity.toFixed(2));
    setVar(a, '--lg-glow-lift', glowLift.toFixed(2));
    setVar(a, '--lg-scrim', scrim.toFixed(2));
    // Values the glass surfaces read go into one rule that matches only the
    // glass elements (see liveRule): an inherited custom property changed on
    // <html> would restyle the entire document every tick. Quantized so an
    // unchanged look writes nothing.
    const g = liveRule();
    setVar(g, '--lg-glass-live', (Math.round(glassAlpha * 50) / 50).toFixed(2));
    setVar(g, '--lg-tint-rgb', rgb.map((c) => Math.round(c / 8) * 8).join(' '));
  }

  // Everything that reads --lg-tint-rgb / --lg-glass-live in glass.css.
  const GLASS_SCOPE = [
    '.lg-glass',
    '.lg-clear',
    'ytd-menu-popup-renderer',
    'ytd-multi-page-menu-renderer',
    'tp-yt-paper-dialog',
    'yt-sheet-view-model',
    '.ytSearchboxComponentSuggestionsContainer',
    'ytd-notification-renderer',
    'tp-yt-paper-toast',
    'tp-yt-app-drawer#guide #contentContainer',
    '[class*="ytwReelActionBarViewModelHost"] button',
    '.expand-collapse-button button',
    '.ytdMiniplayerComponentContent',
  ].join(',');

  let liveStyle = null;
  function liveRule() {
    if (!liveStyle?.isConnected) {
      liveStyle = document.createElement('style');
      liveStyle.id = 'lg-live-vars';
      liveStyle.textContent = `html.lg-on :is(${GLASS_SCOPE}) {}`;
      (document.head || document.documentElement).append(liveStyle);
    }
    return liveStyle.sheet.cssRules[0].style;
  }

  const setVar = (style, name, value) => {
    if (style.getPropertyValue(name) !== value) style.setProperty(name, value);
  };

  const ambientOpacity = () =>
    LG.settings.reduceTransparency || LG.prefersReducedTransparency()
      ? 0.25 * (LG.settings.intensity / 100)
      : 0.95 * (LG.settings.intensity / 100);

  function start(opts = {}) {
    onBlocked = opts.onBlocked || onBlocked;
    mount();
    clearInterval(statsTimer);
    statsTimer = setInterval(tick, STATS_MS);
    tick();
  }

  function stop() {
    unbindVideo();
    clearInterval(statsTimer);
    cancelAnimationFrame(fadeRaf);
    root?.remove();
    root = null;
    glow = null;
    glowKey = '';
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) schedule();
  });

  LG.ambient = {
    start,
    stop,
    mount,
    bindVideo,
    unbindVideo,
    showPixels,
    isVideoLive: () => videoLive() && !video.paused,
    isVideoBlocked: () => videoBlocked,
    tick,
  };
})();
