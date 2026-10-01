// Page-wide ambient light. The playing video (or a thumbnail when nothing is
// playing) is drawn into a tiny canvas that is stretched over the viewport
// behind all of YouTube. Frame scheduling via requestVideoFrameCallback,
// letterbox cropping and hidden-tab pausing follow the approach of
// WesselKroos/youtube-ambilight (MIT), heavily simplified.
//
// Past the Transparency midpoint (LG.immersion) the light turns into the
// footage itself: a sharper, larger canvas, less blur and less temporal
// smoothing. Legibility then comes from a scrim *map* rather than one scrim
// value: every cell of a coarse grid gets the smallest scrim that keeps text
// over it at the contrast target, so dark water stays vivid and only bright
// shoals are dimmed.
(() => {
  // Display canvas: 96×54 colour wash at the midpoint, up to 384×216 fully
  // immersive (see applyClarity). The glow keeps the small size.
  let W = 96;
  let H = 54;
  const GW = 96;
  const GH = 54;
  const SAMPLE_W = 128; // stats sample of the display canvas (scrim map, tint):
  // ~14 px of viewport each, fine enough to see a fish's real brightness
  const SAMPLE_H = 72;
  const PROBE_W = 32; // raw-frame probe (letterbox, DRM, brightness)
  const PROBE_H = 18;
  const GRID_X = 16; // scrim map cells over the viewport
  const GRID_Y = 9;
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
  let clarity = 0; // LG.immersion(true) applied to the canvases
  let scrimMap; // GRID_X × GRID_Y canvas, stretched over the viewport
  let smctx;
  let scrimImg;
  let stillShown = false; // display holds a thumbnail, not video
  // The stats tick reads the display canvas back from the GPU, which waits for
  // the GPU to drain (tens of ms with many glass surfaces on the page). When
  // nothing is playing the canvas holds still, so it is only re-read after it
  // changes; everything below sets this when the canvas or the inputs change.
  let sampleDirty = true;
  let lastPx = null;

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
    sampleDirty = true;
    scrimMap = document.createElement('canvas');
    scrimMap.width = GRID_X;
    scrimMap.height = GRID_Y;
    scrimMap.id = 'lg-scrim';
    smctx = scrimMap.getContext('2d');
    scrimImg = smctx.createImageData(GRID_X, GRID_Y);
    shownScrim.fill(-1);
    glow = document.createElement('canvas');
    glow.width = GW;
    glow.height = GH;
    glow.id = 'lg-glow';
    gctx = glow.getContext('2d', { alpha: false });
    // The glow sits in an untransformed full-viewport wrapper so it can be
    // clipped in screen coordinates (see placeGlow).
    glowClip = document.createElement('div');
    glowClip.id = 'lg-glow-clip';
    glowClip.append(glow);
    root.append(display, scrimMap, glowClip);
    root.classList.add('lg-still');
    (document.body || document.documentElement).prepend(root);

    sample = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    sctx = sample.getContext('2d', { willReadFrequently: true });
    // Average (not point-sample) the sharper immersive canvas, so a shoal
    // counts with its real area.
    sctx.imageSmoothingQuality = 'high';
    // Two steps on purpose: drawing the video straight into a
    // willReadFrequently (CPU) canvas reads the full-resolution frame back
    // from the GPU (~15 ms for 4K), while getImageData on a GPU canvas trips
    // Chrome's readback warning. Scale on the GPU, then copy 32×18 to CPU.
    probe = new OffscreenCanvas(PROBE_W, PROBE_H);
    pctx = probe.getContext('2d');
    probeRead = new OffscreenCanvas(PROBE_W, PROBE_H);
    prctx = probeRead.getContext('2d', { willReadFrequently: true });
    clarity = -1;
    applyClarity();
  }

  // Resize the display canvas and retune the blur for the current immersion.
  function applyClarity() {
    const k = LG.immersion(true);
    if (k === clarity) return;
    clarity = k;
    const w = Math.round((96 + 288 * k) / 16) * 16; // 96…384, keeps 16:9 exact
    if (w !== W) {
      W = w;
      H = (w * 9) / 16;
      display.width = W; // clears it
      display.height = H;
      dctx.fillStyle = LG.isDarkTheme() ? '#0f0f0f' : '#f9f9fa';
      dctx.fillRect(0, 0, W, H);
      sampleDirty = true;
      if (stillShown) drawStill(1);
      else if (videoLive()) drawOnce();
    }
    root.style.setProperty('--lg-ambient-blur', `${(18 - 15 * k).toFixed(1)}px`);
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
    // Temporal smoothing; immersive footage keeps less of the previous frame
    // so a moving shoal does not smear.
    const alpha = LG.prefersReducedMotion() ? 0.08 : 0.22 + 0.33 * clarity;
    const filter = clarity ? `blur(${(2 - 1.4 * clarity).toFixed(2)}px) saturate(1.35)` : 'blur(2px) saturate(1.35)';
    // Immersive, keep the footage's proportions: crop to cover the canvas
    // rather than stretch (a Short stretched to 16:9 turns every fish into a
    // smear). Eased in with the immersion, so the midpoint wash is unchanged.
    let cx = sx;
    let cy = sy;
    let cw = sw;
    let ch = sh;
    if (clarity) {
      const want = W / H;
      if (sw / sh < want) {
        ch = sh + (sw / want - sh) * clarity;
        cy += (sh - ch) / 2;
      } else {
        cw = sw + (sh * want - sw) * clarity;
        cx += (sw - cw) / 2;
      }
    }
    // Slight overscan so the blurred edges do not fade to black.
    const ox = W / 16;
    const oy = H / 13.5;
    dctx.globalAlpha = alpha;
    dctx.filter = filter;
    dctx.drawImage(video, cx, cy, cw, ch, -ox, -oy, W + ox * 2, H + oy * 2);
    sampleDirty = true;
    dctx.filter = 'none';
    dctx.globalAlpha = 1;
    stillShown = false;
    if (!clarity) {
      gctx.drawImage(display, 0, 0, GW, GH);
      return;
    }
    // The glow frames the player, so it keeps the whole picture.
    gctx.globalAlpha = alpha;
    gctx.filter = 'saturate(1.35)';
    gctx.drawImage(video, sx, sy, sw, sh, -GW / 16, -GH / 13.5, GW + GW / 8, GH + GH / 6.75);
    gctx.filter = 'none';
    gctx.globalAlpha = 1;
  }

  // Keep the glow canvas scaled onto the player's on-screen rect.
  function placeGlow() {
    const player = video?.closest(playerSelector());
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
    const sx = w / GW;
    glow.style.transform = `translate(${r.left - side}px, ${r.top - GLOW_TOP}px) scale(${sx}, ${h / GH})`;
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

  // Site adapters (LG.site, e.g. ani-gamer.js) override these; the defaults
  // are YouTube's: #movie_player / #shorts-player and its side panels.
  const playerSelector = () => LG.site?.playerSelector || '.html5-video-player';
  const SIDE_PANELS = () =>
    LG.site?.sidePanels || ['#secondary.ytd-watch-flexy', '#panels-full-bleed-container.ytd-watch-flexy', 'ytd-live-chat-frame'];

  // Left edge of the nearest visible panel to the right of the player that
  // overlaps it vertically; innerWidth when there is none.
  function panelEdgeRightOf(r) {
    let edge = innerWidth;
    for (const sel of SIDE_PANELS()) {
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
    syncMotion();
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

  // The canvas drift (lg-drift) re-renders a full-viewport blurred layer —
  // and every glass surface over it — on every frame. Moving footage pays
  // that anyway; a still light (thumbnail, paused or no video) doesn't need
  // it, so the drift holds its position until playback resumes.
  function syncMotion() {
    root?.classList.toggle('lg-still', !(videoLive() && !video.paused && !video.ended));
  }

  const videoEvents = {
    play: () => (schedule(), syncMotion()),
    playing: () => (schedule(), syncMotion()),
    seeked: () => drawOnce(),
    pause: () => (drawOnce(), syncMotion()),
    ended: () => syncMotion(),
    loadeddata: () => {
      videoBlocked = false;
      blackTicks = 0;
      crop = { x: 0, y: 0, w: 1, h: 1 };
      drawOnce();
      schedule();
      syncMotion();
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
    const player = video.closest(playerSelector());
    if (player) playerResize.observe(player);
    glowKey = '';
    queueGlow();
    for (const [ev, fn] of Object.entries(videoEvents)) video.addEventListener(ev, fn);
    sampleDirty = true;
    syncMotion();
    if (video.readyState >= 2) drawOnce();
    schedule();
  }

  function unbindVideo() {
    cancel();
    if (!video) return;
    for (const [ev, fn] of Object.entries(videoEvents)) video.removeEventListener(ev, fn);
    video = null;
    sampleDirty = true;
    syncMotion();
  }

  const videoLive = () => !!video && !videoBlocked && video.readyState >= 2;

  // ---- raw frame analysis: letterbox crop, DRM detection, player brightness --

  function analyseRawFrame() {
    if (!videoLive() || !video.videoWidth) return;
    let px;
    try {
      pctx.drawImage(video, 0, 0, PROBE_W, PROBE_H);
      prctx.drawImage(probe, 0, 0);
      px = prctx.getImageData(0, 0, PROBE_W, PROBE_H).data;
    } catch {
      blockVideo();
      return;
    }

    const dark = (o) => px[o] < 14 && px[o + 1] < 14 && px[o + 2] < 14;
    const rowDark = (y) => {
      for (let x = 0; x < PROBE_W; x += 1) if (!dark((y * PROBE_W + x) * 4)) return false;
      return true;
    };
    const colDark = (x) => {
      for (let y = 0; y < PROBE_H; y += 1) if (!dark((y * PROBE_W + x) * 4)) return false;
      return true;
    };

    // All black while playing for ~8s → protected content (or a very long
    // black scene, where the thumbnail is a fine substitute anyway).
    let allDark = true;
    for (let y = 0; y < PROBE_H && allDark; y += 1) allDark = rowDark(y);
    if (allDark && !video.paused && video.currentTime > 2) {
      blackTicks += 1;
      if (blackTicks > 8000 / (STATS_MS * 2)) blockVideo(); // analysed every 2nd tick
      return;
    }
    blackTicks = 0;
    if (allDark) return;

    // Letterbox / pillarbox detection (max 25% per side).
    let top = 0;
    while (top < PROBE_H * 0.25 && rowDark(top)) top += 1;
    let bottom = 0;
    while (bottom < PROBE_H * 0.25 && rowDark(PROBE_H - 1 - bottom)) bottom += 1;
    let left = 0;
    while (left < PROBE_W * 0.25 && colDark(left)) left += 1;
    let right = 0;
    while (right < PROBE_W * 0.25 && colDark(PROBE_W - 1 - right)) right += 1;
    crop = {
      x: left / PROBE_W,
      y: top / PROBE_H,
      w: (PROBE_W - left - right) / PROBE_W,
      h: (PROBE_H - top - bottom) / PROBE_H,
    };

    // Clear-glass player controls need a dimming layer over bright footage.
    const bottomLum = LG.contrast.bandLuminance(px, PROBE_W, Math.floor(PROBE_H * 0.7), PROBE_H);
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
      drawStill(t >= 1 ? 1 : 0.07);
      if (t < 1) fadeRaf = requestAnimationFrame(step);
    };
    fadeRaf = requestAnimationFrame(step);
  }

  function drawStill(alpha) {
    stillShown = true;
    dctx.globalAlpha = alpha;
    // Thumbnails are busier and duller than moving footage: push colour
    // harder. The source is only 32×18, so the blur scales with the canvas
    // and a thumbnail stays a soft wash even when immersive.
    dctx.filter = `blur(${((3 * W) / 96).toFixed(1)}px) saturate(1.9) brightness(1.1)`;
    dctx.drawImage(still, -W / 16, -H / 13.5, W + W / 8, H + H / 6.75);
    sampleDirty = true;
    dctx.filter = 'none';
    dctx.globalAlpha = 1;
  }

  // ---- scrim map ------------------------------------------------------------

  // Stats samples per viewport cell. The display canvas box is inset -6% and
  // 112% large; samples beyond the viewport count for the edge cells, where
  // the drift animation can carry them.
  const cellSamples = (() => {
    const cellOf = (i, n, grid) =>
      Math.min(grid - 1, Math.max(0, Math.floor((-0.06 + (1.12 * (i + 0.5)) / n) * grid)));
    const cells = Array.from({ length: GRID_X * GRID_Y }, () => []);
    for (let y = 0; y < SAMPLE_H; y += 1) {
      for (let x = 0; x < SAMPLE_W; x += 1) {
        cells[cellOf(y, SAMPLE_H, GRID_Y) * GRID_X + cellOf(x, SAMPLE_W, GRID_X)].push(y * SAMPLE_W + x);
      }
    }
    return cells;
  })();
  const cellPx = cellSamples.map((idx) => new Uint8ClampedArray(idx.length * 4));
  const rawScrim = new Float32Array(GRID_X * GRID_Y);
  const cellScrim = new Float32Array(GRID_X * GRID_Y); // dilated + smoothed
  const shownScrim = new Float32Array(GRID_X * GRID_Y); // what the canvas shows
  let scrimRaf = 0;
  let scrimDark = null;

  function solveScrimMap(px, opacity, dark) {
    // Per cell there is no page-wide worst case to hide model error behind
    // (glass shadows, the ¼ s between ticks, the drift): keep 5 % in hand,
    // 10 % for sharp immersive footage, where a fish can cross small text
    // between two ticks.
    const target = LG.settings.contrastTarget * (1.05 + 0.05 * clarity);
    for (let c = 0; c < cellSamples.length; c += 1) {
      const idx = cellSamples[c];
      const buf = cellPx[c];
      for (let i = 0; i < idx.length; i += 1) {
        const o = idx[i] * 4;
        buf[i * 4] = px[o];
        buf[i * 4 + 1] = px[o + 1];
        buf[i * 4 + 2] = px[o + 2];
      }
      rawScrim[c] = LG.contrast.solveScrim(buf, opacity, dark, target);
    }
    // Dilate by one cell: the drift animation and the bilinear stretch of
    // the map must never leave a bright spot under a lighter neighbour.
    // Then smooth asymmetrically: darken (safer) at once, relax slowly.
    for (let y = 0; y < GRID_Y; y += 1) {
      for (let x = 0; x < GRID_X; x += 1) {
        let m = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy >= 0 && yy < GRID_Y && xx >= 0 && xx < GRID_X) m = Math.max(m, rawScrim[yy * GRID_X + xx]);
          }
        }
        const c = y * GRID_X + x;
        cellScrim[c] = m > cellScrim[c] ? m : cellScrim[c] + (m - cellScrim[c]) * 0.15;
      }
    }
  }

  // ---- masthead glass floor --------------------------------------------------

  // Sample rows under the masthead (viewport y 0–8 %, canvas inset -6 %) and
  // the frame's top rows, which the player glow lays under it.
  const MAST_ROWS = [Math.floor((0.06 / 1.12) * SAMPLE_H), Math.ceil((0.14 / 1.12) * SAMPLE_H)];
  const GLOW_ROWS = Math.round(SAMPLE_H * 0.22);
  const mastPx = new Uint8ClampedArray(SAMPLE_W * 4);

  // Smallest glass tint that keeps masthead text at the target over what is
  // really behind it: ambient light → scrim map → player glow. Clear glass
  // thus stays clear over dark water and tints only as much as it must.
  // (The signed-out "Sign in" link blue is weaker still; glass.css gives
  // that one capsule its own fill rather than tinting the whole bar.)
  function mastheadFloor(px, opacity, glowOpacity, dark) {
    const { base } = dark ? LG.contrast.THEMES.dark : LG.contrast.THEMES.light;
    const L = LG.contrast.luminance;
    // Worst pixel of a column: brightest on a dark page, darkest on a light one.
    const worse = (o1, o2) => ((L(px[o1], px[o1 + 1], px[o1 + 2]) > L(px[o2], px[o2 + 1], px[o2 + 2])) === dark ? o1 : o2);
    for (let x = 0; x < SAMPLE_W; x += 1) {
      let a = MAST_ROWS[0] * SAMPLE_W * 4 + x * 4;
      for (let y = MAST_ROWS[0] + 1; y <= MAST_ROWS[1]; y += 1) a = worse(a, (y * SAMPLE_W + x) * 4);
      let g = x * 4;
      for (let y = 1; y < GLOW_ROWS; y += 1) g = worse(g, (y * SAMPLE_W + x) * 4);
      const cell = Math.min(GRID_X - 1, Math.max(0, Math.floor((-0.06 + (1.12 * (x + 0.5)) / SAMPLE_W) * GRID_X)));
      const scrim = cellScrim[cell];
      for (let ch = 0; ch < 3; ch += 1) {
        let v = base[ch] + (px[a + ch] - base[ch]) * opacity;
        v += (base[ch] - v) * scrim;
        v += (px[g + ch] - v) * glowOpacity;
        mastPx[x * 4 + ch] = v;
      }
    }
    return LG.contrast.solveScrim(mastPx, 1, dark, LG.settings.contrastTarget);
  }

  // Ease the canvas to the new map over ~¼ s (the tick interval).
  function paintScrim(dark) {
    let changed = dark !== scrimDark;
    for (let c = 0; c < cellScrim.length && !changed; c += 1) changed = Math.abs(cellScrim[c] - shownScrim[c]) > 0.004;
    if (!changed) return;
    scrimDark = dark;
    const [r, g, b] = dark ? LG.contrast.THEMES.dark.base : LG.contrast.THEMES.light.base;
    const from = shownScrim.slice();
    const t0 = performance.now();
    const d = scrimImg.data;
    cancelAnimationFrame(scrimRaf);
    const step = (now) => {
      const f = from[0] < 0 || LG.prefersReducedMotion() ? 1 : Math.min(1, (now - t0) / 240);
      for (let c = 0; c < cellScrim.length; c += 1) {
        shownScrim[c] = f === 1 ? cellScrim[c] : from[c] + (cellScrim[c] - from[c]) * f;
        d[c * 4] = r;
        d[c * 4 + 1] = g;
        d[c * 4 + 2] = b;
        d[c * 4 + 3] = Math.round(shownScrim[c] * 255);
      }
      smctx.putImageData(scrimImg, 0, 0);
      if (f < 1) scrimRaf = requestAnimationFrame(step);
    };
    step(t0);
  }

  // ---- stats → CSS variables (legibility + light spill) --------------------

  let tickCount = 0;

  let settled = false; // the last tick changed nothing and the tint has converged

  function tick() {
    if (!active()) return;
    // Nothing new on the canvas and the eased values have arrived: the
    // result would be identical, so skip the GPU readback and the solve.
    // Layout can still move the player or open a side panel: keep the glow
    // placed (cheap: a few rects and a key compare).
    if (!sampleDirty && settled) {
      if (video) placeGlow();
      return;
    }
    // Letterbox / brightness / DRM checks don't need 4 Hz.
    if (videoLive() && !video.paused && (tickCount += 1) % 2 === 0) analyseRawFrame();
    // Sample what the page shows: #lg-ambient-canvas has saturate(1.5).
    // Re-read only after the canvas changed; easing towards the target
    // tint reuses the last sample.
    if (sampleDirty || !lastPx) {
      sctx.filter = 'saturate(1.5)';
      sctx.drawImage(display, 0, 0, SAMPLE_W, SAMPLE_H);
      sctx.filter = 'none';
      lastPx = sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      sampleDirty = false;
    }
    const px = lastPx;
    const dark = LG.isDarkTheme();
    const opacity = ambientOpacity();
    solveScrimMap(px, opacity, dark);
    const { rgb, lum } = LG.contrast.dominantColor(px);

    // Navigation glass floats over the unscrimmed glow (masthead sits on its
    // top rows); mastheadFloor solves its tint. Immersive, the backdrop
    // already is the footage: the glow steps back, which also frees the
    // Clear glass from the tint floor it would force.
    let glowOpacity = videoLive() ? opacity * 0.85 * (1 - 0.8 * clarity) : 0;
    // On a light page a dark frame's glow reads as a shadow, not light:
    // lift mid-dark footage so it stays colourful, and fade the glow out as
    // the frame approaches black (brightness can't lift black).
    let glowLift = 1;
    if (!dark) {
      const t = Math.min(1, Math.max(0, (lum - 0.03) / (0.22 - 0.03)));
      glowOpacity *= t * t * (3 - 2 * t); // smoothstep
      glowLift = 1 + 0.8 * (1 - Math.min(1, lum / 0.3));
    }
    // Headroom for the saturate() in the glass backdrop-filter.
    const floor = mastheadFloor(px, opacity, glowOpacity, dark);
    const glass = floor > 0 ? Math.min(0.92, floor + 0.08) : 0;
    glassAlpha = glass > glassAlpha ? glass : glassAlpha + (glass - glassAlpha) * 0.15;
    // Converged once the quantized value (1/50 steps) can no longer move.
    settled = Math.abs(glass - glassAlpha) < 0.005;

    // Read layout before any write below: a write followed by a layout read
    // forces a synchronous style recalc (~50 ms on YouTube's DOM).
    placeGlow();

    // Light-layer values live on #lg-ambient: changing them restyles only
    // its three children, not the whole page. The scrim is a canvas.
    paintScrim(dark);
    const a = root.style;
    setVar(a, '--lg-ambient-opacity', opacity.toFixed(2));
    setVar(a, '--lg-glow-opacity', glowOpacity.toFixed(2));
    setVar(a, '--lg-glow-lift', glowLift.toFixed(2));
    // Values the glass surfaces read go into one rule that matches only the
    // glass elements (see liveRule): an inherited custom property changed on
    // <html> would restyle the entire document every tick. Quantized so an
    // unchanged look writes nothing.
    const g = liveRule();
    setVar(g, '--lg-glass-live', (Math.round(glassAlpha * 50) / 50).toFixed(2));
    setVar(g, '--lg-tint-rgb', rgb.map((c) => Math.round(c / 8) * 8).join(' '));
  }

  // Everything that reads --lg-tint-rgb / --lg-glass-live in glass.css.
  const GLASS_SCOPE = () => [
    ...(LG.site?.glassScope || []),
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
      liveStyle.textContent = `html.lg-on :is(${GLASS_SCOPE()}) {}`;
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
    applyClarity();
    clearInterval(statsTimer);
    statsTimer = setInterval(tick, STATS_MS);
    sampleDirty = true;
    tick();
  }

  function stop() {
    unbindVideo();
    clearInterval(statsTimer);
    cancelAnimationFrame(fadeRaf);
    cancelAnimationFrame(scrimRaf);
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
    /** Recompute now (e.g. after a theme switch changed the inputs). */
    tick: () => {
      sampleDirty = true;
      tick();
    },
  };
})();
