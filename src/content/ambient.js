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
  // Display canvas: 96×54 colour wash at the midpoint, up to 768×432 fully
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
  let drawnSrc = ''; // source of the last video frame drawn
  // The stats tick reads the display canvas back from the GPU, which waits for
  // the GPU to drain (tens of ms with many glass surfaces on the page). When
  // nothing is playing the canvas holds still, so it is only re-read after it
  // changes; everything below sets this when the canvas or the inputs change.
  let sampleDirty = true;
  let lastPx = null;
  let lastGlowPx = null; // the glow's top rows, when it isn't the display's (radial)

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
    radialShown = false;
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
    const w = Math.round((96 + 672 * k) / 16) * 16; // 96…768, keeps 16:9 exact
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
    root.style.setProperty('--lg-ambient-blur', `${(18 - 17 * k).toFixed(1)}px`);
  }

  // ---- radial extension ------------------------------------------------------

  // Three backdrops, picked in the popup (LG.settings.backdrop):
  //  - 'enlarged': the frame enlarged over the whole canvas (drawEnlarged);
  //  - 'radial': the picture continued past the player's edges, each ray
  //    smeared inwards from where it leaves the frame;
  //  - 'hybrid' (default), described below.
  //
  // Hybrid draws two layers in one pass, both anchored to the picture on screen:
  //  - behind the player, the frame enlarged around the picture's centre, out
  //    to a box fitted to the page (see enlargedBox): each side of the box is
  //    reached by scaling that half of the frame, so the frame stays
  //    continuous while e.g. stopping at a side panel on one side only;
  //  - past the box, radial light: every pixel takes the colour of the
  //    frame's outermost band where its ray leaves the box, spread along that
  //    edge more and more with distance.
  // Burned-in subtitles (動畫瘋, many YouTube uploads) sit ~10-25 % above the
  // frame's bottom edge. The radial light never reaches further into the frame
  // than its outer band, and straight under the player — where the enlarged
  // frame would put the subtitle line right over the title — the box shows
  // the frame's bottom band (below the subtitles) stretched down instead.
  // A per-pixel mapping needs a shader; without WebGL the backdrop falls back
  // to the enlarged frame.
  const radial = (() => {
    // The frame is downscaled to SRC×SRC first (prefilter). Square and a power
    // of two so WebGL 1 can mipmap it: the radial taps spread wider than the
    // texels they skip, and point-sampling them full size leaves comb-like
    // streaks. Stretching to a square is harmless; the shader samples in
    // frame-relative coordinates.
    const SRC = 256;
    const TAPS_JS = 9;
    const VERT = `
      attribute vec2 p;
      varying vec2 uv;
      void main() {
        uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // y down, like the page
        gl_Position = vec4(p, 0.0, 1.0);
      }`;
    const FRAG = `
      #extension GL_EXT_shader_texture_lod : require
      precision mediump float;
      uniform sampler2D tex;
      uniform vec4 rect; // picture in canvas uv: centre.xy, half size.zw
      uniform vec4 box; // enlarged frame's edges in picture halves: left, top, right, bottom
      uniform float reach; // box-relative t at the canvas edge
      uniform bool hybrid; // false: plain radial extension
      varying vec2 uv;
      const int TAPS = ${TAPS_JS};
      const float BAND = 0.06; // how far inside the edge the light is taken from
      // Bottom band stretched under the player. Subtitles can sit low: on a
      // YouTube upload measured live they reached 96 % of the way down.
      const float SUB = 0.025;
      void main() {
        vec2 d = (uv - rect.xy) / rect.zw; // ±1 on the picture's edges
        if (!hybrid) {
          float t = max(abs(d.x), abs(d.y));
          if (t <= 1.0) {
            gl_FragColor = vec4(texture2DLodEXT(tex, d * 0.5 + 0.5, 0.0).rgb, 1.0);
            return;
          }
          // Each ray averaged over a stretch inwards from where it leaves the
          // picture, growing steeply with distance: the canvas only reaches
          // t ~1.5-2 past a typical player, and must be a soft wash by then.
          vec2 r = d / t;
          float len = clamp(0.03 + 0.7 * (t - 1.0), 0.03, 0.92);
          vec3 sum = vec3(0.0);
          for (int i = 0; i < TAPS; i++) {
            float f = 1.0 - len * float(i) / float(TAPS - 1);
            sum += texture2DLodEXT(tex, r * f * 0.5 + 0.5, 0.0).rgb;
          }
          gl_FragColor = vec4(sum / float(TAPS), 1.0);
          return;
        }
        // Box-relative position: each half of the frame is scaled to its own
        // side of the box, so n is ±1 on the box's edges.
        vec2 k = vec2(d.x < 0.0 ? box.x : box.z, d.y < 0.0 ? box.y : box.w);
        vec2 n = d / k;
        float t = max(abs(n.x), abs(n.y));
        if (t <= 1.0) {
          // Straight under the player the frame's bottom band, stretched from
          // the player's edge to the box's; eased in across its corners.
          float under = smoothstep(0.98, 1.0, d.y) * (1.0 - smoothstep(0.8, 1.2, abs(d.x)));
          float band = 1.0 - SUB * (1.0 - clamp((d.y - 1.0) / max(k.y - 1.0, 0.001), 0.0, 1.0));
          vec2 s = vec2(n.x, mix(n.y, band, under));
          gl_FragColor = vec4(texture2DLodEXT(tex, s * 0.5 + 0.5, 0.0).rgb, 1.0);
          return;
        }
        vec2 e = n / t; // unit ray (Chebyshev): where it leaves the box
        // Along the edge the ray leaves through: horizontal on the top and
        // bottom edges, vertical on the sides, eased across the corners.
        float side = smoothstep(-0.12, 0.12, abs(e.x) - abs(e.y));
        vec2 along = normalize(mix(vec2(1.0, 0.0), vec2(0.0, 1.0), side));
        // Spread measured as a fraction of what is left to the canvas edge, so
        // it reaches the cap at the page edge in every layout.
        float u = clamp((t - 1.0) / max(reach - 1.0, 0.001), 0.0, 1.0);
        float spread = mix(0.03, 0.7, u);
        vec2 q = e * (1.0 - BAND * min(1.0, u * 8.0)); // starts at the very edge: no seam
        vec3 acc = vec3(0.0);
        // Read the mip level whose texels are as wide as the gap between taps.
        float lod = log2(max(1.0, spread * ${(SRC / (TAPS_JS - 1)).toFixed(1)}));
        for (int i = 0; i < TAPS; i++) {
          float s = spread * (float(i) / float(TAPS - 1) * 2.0 - 1.0);
          acc += texture2DLodEXT(tex, (q + along * s) * 0.5 + 0.5, lod).rgb; // clamped
        }
        gl_FragColor = vec4(acc / float(TAPS), 1.0);
      }`;

    let canvas;
    let gl;
    let rectLoc;
    let boxLoc;
    let reachLoc;
    let hybridLoc;
    let src;
    let sctx2;
    let failed = false;

    function init() {
      canvas = new OffscreenCanvas(W, H);
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
      // Mip levels are chosen explicitly: implicit selection reads how fast the
      // coordinates change between neighbouring pixels, and they jump where
      // the enlarged frame meets the radial light, which drew a 1 px line of
      // the frame's average colour round the enlarged frame.
      if (!gl || !gl.getExtension('EXT_shader_texture_lod')) return false;
      const shader = (type, text) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, text);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle
      const p = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(p);
      gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      // Clamp at the edges: the radial taps run off them.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      rectLoc = gl.getUniformLocation(prog, 'rect');
      boxLoc = gl.getUniformLocation(prog, 'box');
      reachLoc = gl.getUniformLocation(prog, 'reach');
      hybridLoc = gl.getUniformLocation(prog, 'hybrid');
      src = new OffscreenCanvas(SRC, SRC);
      sctx2 = src.getContext('2d');
      sctx2.imageSmoothingQuality = 'medium';
      return true;
    }

    /**
     * Render the cropped frame (sx, sy, sw, sh of the video) radiating from
     * `rect` (canvas uv: cx, cy, half w, half h). `zone` is enlargedBox():
     * the enlarged frame's edges and how far the canvas reaches past them;
     * `hybrid` false draws the plain radial extension instead. False when WebGL is unavailable or lost;
     * tainted media throws, like any other draw path.
     */
    function render(el, sx, sy, sw, sh, rect, zone, hybrid) {
      if (failed) return false;
      if (!gl && !init()) {
        failed = true;
        return false;
      }
      if (gl.isContextLost()) {
        failed = true;
        return false;
      }
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      gl.viewport(0, 0, W, H);
      sctx2.drawImage(el, sx, sy, sw, sh, 0, 0, SRC, SRC);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform4f(rectLoc, rect[0], rect[1], rect[2], rect[3]);
      gl.uniform4f(boxLoc, ...zone.box);
      gl.uniform1f(reachLoc, zone.reach);
      gl.uniform1i(hybridLoc, hybrid ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }

    return {
      render,
      get canvas() {
        return canvas;
      },
    };
  })();

  // The picture inside the video element (object-fit: contain) in viewport
  // px, and the viewport it is measured in. Measured with the other layout
  // reads (placeGlow), never per frame.
  let picBox = null;
  let viewW = 1;
  let viewH = 1;
  let radialShown = false;

  function measurePicture() {
    if (!video?.videoWidth || !video.videoHeight) {
      picBox = null;
      return false;
    }
    const r = video.getBoundingClientRect();
    const de = document.documentElement;
    viewW = de.clientWidth || innerWidth;
    viewH = de.clientHeight || innerHeight;
    if (!r.width || !r.height) {
      picBox = null;
      return false;
    }
    const k = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
    const w = video.videoWidth * k;
    const h = video.videoHeight * k;
    const next = { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
    // What the enlarged frame stops at (enlargedBox): a side panel right of
    // the player, and the description under it.
    const player = video.closest(playerSelector());
    const panel = player ? panelEdgeRightOf(player.getBoundingClientRect()) : innerWidth;
    next.panel = panel < innerWidth ? panel : null;
    const desc = document.querySelector(DESCRIPTION());
    const dr = desc?.getBoundingClientRect();
    const edge = LG.site?.descriptionEdge === 'bottom' ? dr?.bottom : dr?.top;
    next.desc = dr?.height && dr.top >= next.y + h - 1 ? edge : null;
    const moved =
      !picBox ||
      Math.abs(next.x - picBox.x) + Math.abs(next.y - picBox.y) + Math.abs(next.w - picBox.w) + Math.abs(next.h - picBox.h) > 1 ||
      Math.abs((next.panel ?? -1) - (picBox.panel ?? -1)) > 1 ||
      Math.abs((next.desc ?? -1) - (picBox.desc ?? -1)) > 1;
    picBox = next;
    return moved;
  }

  // Letterbox-cropped picture in display-canvas uv (the canvas box is inset
  // -6 % and 112 % large, see glass.css); null when there is none to anchor to.
  function radialRect() {
    if (!picBox) return null;
    const w = picBox.w * crop.w;
    const h = picBox.h * crop.h;
    if (w < 8 || h < 8) return null;
    const x = picBox.x + picBox.w * crop.x;
    const y = picBox.y + picBox.h * crop.y;
    return [
      ((x + w / 2) / viewW + 0.06) / 1.12,
      ((y + h / 2) / viewH + 0.06) / 1.12,
      w / 2 / viewW / 1.12,
      h / 2 / viewH / 1.12,
    ];
  }

  // The enlarged frame's box behind the player, as its left, top, right and
  // bottom edges in picture halves from the picture's centre (1 = the
  // picture's own edge), and how far the canvas reaches past the box.
  //
  // Beside a side panel (YouTube's playlist / recommendations column, 動畫瘋's
  // danmu column) the box is fitted to the page: right edge at the panel,
  // bottom edge at the description under the player (YouTube: its top;
  // 動畫瘋: the bottom of the title block), top and left at the viewport's
  // edges. Radial light takes over past the panel and below the
  // description.
  //
  // Otherwise (theater, Shorts) the frame is enlarged K:1 on every side. K
  // cannot be a constant: the canvas only reaches ~106 % past the picture's
  // own edges (the -6 %/112 % inset in glass.css), and that reach varies a lot
  // with layout — tMax ~2.4 on a default watch page, ~1.5 in theater, ~5 on a
  // portrait Short. So K is capped by the reach, floored so the enlarged frame
  // still shows past the player, and MIN_RADIAL keeps room for the light.
  const K_WANT = 1.5; // enlargement of the frame behind the player
  const K_MIN = 1.1;
  const MIN_RADIAL = 0.25; // t kept for the radial light past the frame

  function enlargedBox(rect) {
    const [cx, cy, hw, hh] = rect;
    // Viewport px → canvas uv (the canvas box is inset -6 % and 112 % large).
    const ux = (px) => (px / viewW + 0.06) / 1.12;
    const uy = (px) => (px / viewH + 0.06) / 1.12;
    let box;
    if (picBox.panel != null) {
      const side = (k) => Math.max(1.001, k);
      box = [
        side((cx - ux(0)) / hw),
        side((cy - uy(0)) / hh),
        side((ux(picBox.panel) - cx) / hw),
        side(((picBox.desc != null ? uy(picBox.desc) : uy(viewH)) - cy) / hh),
      ];
    } else {
      // The shader's t is a Chebyshev norm, so the canvas corners bound it.
      let tMax = 0;
      for (const u of [0, 1]) {
        for (const v of [0, 1]) tMax = Math.max(tMax, Math.abs((u - cx) / hw), Math.abs((v - cy) / hh));
      }
      const k = Math.max(K_MIN, Math.min(K_WANT, tMax - MIN_RADIAL));
      box = [k, k, k, k];
    }
    // Box-relative t of the canvas corners, as the shader measures it.
    let reach = 0;
    for (const u of [0, 1]) {
      for (const v of [0, 1]) {
        const dx = (u - cx) / hw;
        const dy = (v - cy) / hh;
        reach = Math.max(reach, Math.abs(dx) / (dx < 0 ? box[0] : box[2]), Math.abs(dy) / (dy < 0 ? box[1] : box[3]));
      }
    }
    return { box, reach };
  }

  // The drift would slide the backdrop out of line with the player.
  function setRadialShown(on) {
    if (on === radialShown) return;
    radialShown = on;
    root.classList.toggle('lg-radial', on);
  }

  // ---- video source --------------------------------------------------------

  // `alpha` overrides the temporal smoothing (1: show this frame as is).
  function drawVideo(alpha = LG.prefersReducedMotion() ? 0.08 : 0.22 + 0.33 * clarity) {
    // Temporal smoothing above; immersive footage keeps less of the previous
    // frame so a moving shoal does not smear.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const sx = crop.x * vw;
    const sy = crop.y * vh;
    const sw = crop.w * vw;
    const sh = crop.h * vh;
    const filter = clarity ? `blur(${(2 - 1.4 * clarity).toFixed(2)}px) saturate(1.35)` : 'blur(2px) saturate(1.35)';
    const mode = LG.settings.backdrop;
    const rect = mode !== 'enlarged' && radialRect();
    const zone = rect && enlargedBox(rect);
    if (rect && radial.render(video, sx, sy, sw, sh, rect, zone, mode !== 'radial')) {
      dctx.globalAlpha = alpha;
      dctx.filter = filter;
      dctx.drawImage(radial.canvas, 0, 0, W, H);
      setRadialShown(true);
    } else {
      drawEnlarged(sx, sy, sw, sh, alpha, filter);
      setRadialShown(false);
    }
    sampleDirty = true;
    dctx.filter = 'none';
    dctx.globalAlpha = 1;
    stillShown = false;
    drawnSrc = video.currentSrc;
    // At the midpoint the smoothed display is the frame itself; the radial
    // backdrop is not (enlarged, then the edge light), so the halo draws its own.
    if (!clarity && !radialShown) {
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

  // The 'enlarged' backdrop, and the fallback of the other two (no WebGL, or
  // no picture on screen to anchor to): the frame enlarged over the canvas.
  function drawEnlarged(sx, sy, sw, sh, alpha, filter) {
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
  }

  // Re-measure the layout the light depends on: the picture the radial
  // backdrop is anchored to, and the player the glow frames.
  function placeGlow() {
    const moved = measurePicture();
    placeHalo();
    // A paused frame doesn't redraw by itself: re-anchor it after scrolling.
    // After the reads above, so its class toggle can't force a layout.
    if (moved && videoLive() && video.paused && active()) {
      try {
        drawVideo(1);
      } catch {
        blockVideo();
      }
    }
  }

  // Keep the glow canvas scaled onto the player's on-screen rect.
  function placeHalo() {
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
  const DESCRIPTION = () => LG.site?.description || '#description.ytd-watch-metadata';
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
    // The video wins, also paused once its frame is on the canvas: a settings
    // change re-routes, and must not swap a paused frame for the thumbnail.
    if (videoLive() && (!video.paused || (!stillShown && drawnSrc === video.currentSrc))) return;
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
    setRadialShown(false);
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
  const NO_SCRIM = new Float32Array(GRID_X * GRID_Y);
  let scrimRaf = 0;
  let scrimDark = null;

  function solveScrimMap(px, opacity, dark, cards) {
    // Per cell there is no page-wide worst case to hide model error behind
    // (glass shadows, the ¼ s between ticks, the drift): keep 5 % in hand,
    // 10 % for sharp immersive footage, where a fish can cross small text
    // between two ticks. On content cards YouTube's own black fills sit on
    // top as well (description box 5 %, playing playlist row ~11 %), which
    // darken the card under the text: 12 % more for those.
    const target = LG.settings.contrastTarget * (1.05 + 0.05 * clarity) * (cards ? 1.12 : 1);
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
  // The glow's own top rows, read when the display is not the frame (radial).
  let glowSample;
  let glowSctx;

  function readGlowRows() {
    if (!glowSample) {
      glowSample = new OffscreenCanvas(SAMPLE_W, GLOW_ROWS);
      glowSctx = glowSample.getContext('2d', { willReadFrequently: true });
    }
    glowSctx.filter = 'saturate(1.6)'; // as #lg-glow
    glowSctx.drawImage(glow, 0, 0, GW, (GH * GLOW_ROWS) / SAMPLE_H, 0, 0, SAMPLE_W, GLOW_ROWS);
    glowSctx.filter = 'none';
    return glowSctx.getImageData(0, 0, SAMPLE_W, GLOW_ROWS).data;
  }

  // Smallest glass tint that keeps masthead text at the target over what is
  // really behind it: ambient light → scrim map → player glow. Clear glass
  // thus stays clear over dark water and tints only as much as it must.
  // (The signed-out "Sign in" link blue is weaker still; glass.css gives
  // that one capsule its own fill rather than tinting the whole bar.)
  // `gpx` holds the glow's top rows in the layout of `px` (by default the
  // display, which is the frame everywhere but in the radial backdrop).
  function mastheadFloor(px, gpx, opacity, glowOpacity, dark, scrimMap) {
    const { base } = dark ? LG.contrast.THEMES.dark : LG.contrast.THEMES.light;
    const L = LG.contrast.luminance;
    // Worst pixel of a column: brightest on a dark page, darkest on a light one.
    const worseIn = (b) => (o1, o2) => ((L(b[o1], b[o1 + 1], b[o1 + 2]) > L(b[o2], b[o2 + 1], b[o2 + 2])) === dark ? o1 : o2);
    const worse = worseIn(px);
    const worseG = worseIn(gpx);
    for (let x = 0; x < SAMPLE_W; x += 1) {
      let a = MAST_ROWS[0] * SAMPLE_W * 4 + x * 4;
      for (let y = MAST_ROWS[0] + 1; y <= MAST_ROWS[1]; y += 1) a = worse(a, (y * SAMPLE_W + x) * 4);
      let g = x * 4;
      for (let y = 1; y < GLOW_ROWS; y += 1) g = worseG(g, (y * SAMPLE_W + x) * 4);
      const cell = Math.min(GRID_X - 1, Math.max(0, Math.floor((-0.06 + (1.12 * (x + 0.5)) / SAMPLE_W) * GRID_X)));
      const scrim = scrimMap[cell];
      for (let ch = 0; ch < 3; ch += 1) {
        let v = base[ch] + (px[a + ch] - base[ch]) * opacity;
        v += (base[ch] - v) * scrim;
        v += (gpx[g + ch] - v) * glowOpacity;
        mastPx[x * 4 + ch] = v;
      }
    }
    return LG.contrast.solveScrim(mastPx, 1, dark, LG.settings.contrastTarget);
  }

  // Ease the canvas to the new map over ~¼ s (the tick interval).
  function paintScrim(dark, target) {
    let changed = dark !== scrimDark;
    for (let c = 0; c < target.length && !changed; c += 1) changed = Math.abs(target[c] - shownScrim[c]) > 0.004;
    if (!changed) return;
    scrimDark = dark;
    const [r, g, b] = dark ? LG.contrast.THEMES.dark.base : LG.contrast.THEMES.light.base;
    const from = shownScrim.slice();
    const t0 = performance.now();
    const d = scrimImg.data;
    cancelAnimationFrame(scrimRaf);
    const step = (now) => {
      const f = from[0] < 0 || LG.prefersReducedMotion() ? 1 : Math.min(1, (now - t0) / 240);
      for (let c = 0; c < target.length; c += 1) {
        shownScrim[c] = f === 1 ? target[c] : from[c] + (target[c] - from[c]) * f;
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
      lastGlowPx = radialShown ? readGlowRows() : null;
      sampleDirty = false;
    }
    const px = lastPx;
    const dark = LG.isDarkTheme();
    const opacity = ambientOpacity();
    // Content cards (main.js sets lg-cards: YouTube's light watch page): the
    // text sits on frosted cards instead, each tinted at least the scrim the
    // worst cell would need, and the backdrop between them stays unwashed.
    const cards = document.documentElement.classList.contains('lg-cards');
    solveScrimMap(px, opacity, dark, cards);
    let cardTint = 0;
    if (cards) for (let c = 0; c < cellScrim.length; c += 1) cardTint = Math.max(cardTint, cellScrim[c]);
    const scrimShown = cards ? NO_SCRIM : cellScrim;
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
    const gpx = lastGlowPx || px;
    const floor = mastheadFloor(px, gpx, opacity, glowOpacity, dark, scrimShown);
    const glass = floor > 0 ? Math.min(0.92, floor + 0.08) : 0;
    glassAlpha = glass > glassAlpha ? glass : glassAlpha + (glass - glassAlpha) * 0.15;
    // Converged once the quantized value (1/50 steps) can no longer move.
    settled = Math.abs(glass - glassAlpha) < 0.005;

    // Read layout before any write below: a write followed by a layout read
    // forces a synchronous style recalc (~50 ms on YouTube's DOM).
    placeGlow();

    // Light-layer values live on #lg-ambient: changing them restyles only
    // its three children, not the whole page. The scrim is a canvas.
    paintScrim(dark, scrimShown);
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
    // Rounded up, never below what the text needs.
    setVar(g, '--lg-card-live', (Math.ceil(cardTint * 50) / 50).toFixed(2));
  }

  // Everything that reads --lg-tint-rgb / --lg-glass-live / --lg-card-live in
  // glass.css (the cards are YouTube's light-theme content cards, lg-cards).
  const GLASS_SCOPE = () => [
    ...(LG.site?.glassScope || []),
    ...(LG.site ? [] : YT_CARDS),
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

  const YT_CARDS = [
    'ytd-watch-metadata',
    'ytd-comments#comments',
    'ytd-playlist-panel-renderer#playlist',
    'yt-related-chip-cloud-renderer',
    '#related yt-lockup-view-model',
    '#related ytd-compact-video-renderer',
    '#related ytd-compact-radio-renderer',
    '#related ytd-compact-playlist-renderer',
    '#related ytd-reel-shelf-renderer', // Shorts shelf in the related list
    'ytd-engagement-panel-section-list-renderer',
    'ytd-live-chat-frame',
    'ytd-ad-slot-renderer', // sponsored items in the related list
  ];

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

  let backdrop = null;

  function start(opts = {}) {
    onBlocked = opts.onBlocked || onBlocked;
    mount();
    applyClarity();
    // Switching the backdrop redraws at once, also under a paused frame.
    if (backdrop !== LG.settings.backdrop) {
      if (backdrop !== null && videoLive() && !stillShown) drawOnce();
      backdrop = LG.settings.backdrop;
    }
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
