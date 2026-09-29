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
  let probe; // raw-frame canvas for bar / brightness / DRM detection
  let pctx;
  let glow; // unscrimmed light radiating from behind the player
  let gctx;
  let glowKey = '';
  let glassAlpha = 0;

  // Glow margin around the player, px. Portrait players (Shorts) have empty
  // space beside them, so their halo spreads wider.
  const GLOW_SIDE = 72;
  const GLOW_SIDE_PORTRAIT = 140;
  const GLOW_TOP = 72;
  const GLOW_BOTTOM = 20;
  const GLOW_EDGE_PX = 44; // on-screen softness of the halo's side edges

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
    root.append(display, scrim, glow);
    (document.body || document.documentElement).prepend(root);

    sample = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    sctx = sample.getContext('2d', { willReadFrequently: true });
    probe = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    pctx = probe.getContext('2d', { willReadFrequently: true });
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
    placeGlow();
  }

  // Keep the glow canvas scaled onto the player's on-screen rect.
  function placeGlow() {
    const player = video?.closest('.html5-video-player'); // #movie_player or #shorts-player
    if (!glow || !player) return;
    const r = player.getBoundingClientRect();
    const key = `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`;
    if (key === glowKey) return;
    glowKey = key;
    const side = r.height > r.width ? GLOW_SIDE_PORTRAIT : GLOW_SIDE;
    const w = r.width + side * 2;
    const h = r.height + GLOW_TOP + GLOW_BOTTOM;
    const sx = w / W;
    glow.style.transform = `translate(${r.left - side}px, ${r.top - GLOW_TOP}px) scale(${sx}, ${h / H})`;
    // The blur runs in canvas pixels before scaling; size it for the screen.
    glow.style.filter = `blur(${(GLOW_EDGE_PX / sx).toFixed(2)}px) saturate(1.6) brightness(var(--lg-glow-lift, 1))`;
  }

  addEventListener('scroll', () => requestAnimationFrame(placeGlow), { passive: true });
  addEventListener('resize', () => requestAnimationFrame(placeGlow), { passive: true });

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
      px = pctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
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
      if (blackTicks > 8000 / STATS_MS) blockVideo();
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

  function tick() {
    if (!active()) return;
    analyseRawFrame();
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

    const s = document.documentElement.style;
    s.setProperty('--lg-glass-live', glassAlpha.toFixed(3));
    s.setProperty('--lg-ambient-opacity', opacity.toFixed(3));
    s.setProperty('--lg-glow-opacity', glowOpacity.toFixed(3));
    s.setProperty('--lg-glow-lift', glowLift.toFixed(3));
    s.setProperty('--lg-scrim', scrim.toFixed(3));
    s.setProperty('--lg-tint-rgb', rgb.join(' '));
    s.setProperty('--lg-ambient-lum', lum.toFixed(3));
  }

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
