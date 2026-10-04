// Lensing for navigation glass: an SVG displacement map used as a
// backdrop-filter (Chromium only). Chromium ignores CSS filter functions that
// follow a url() in backdrop-filter, so frost (blur) and saturation live
// inside the SVG filter too: blur → displace → saturate. The map is generated from the signed
// distance to a rounded rectangle, so only the rim bends light — the way a
// convex glass bezel does. Technique after the kube.io article "Liquid Glass
// in the Browser" and sven1577/liquid-glass (MIT).
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let defs = null;
  let seq = 0;
  const attached = new Map(); // el -> { id, ro, opts, key }

  function ensureDefs() {
    if (defs?.isConnected) return defs;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.id = 'lg-refract-defs';
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defs);
    document.documentElement.appendChild(svg);
    return defs;
  }

  // Signed distance to a rounded rect centred at the origin (negative inside).
  function sdRoundRect(px, py, hw, hh, r) {
    const qx = Math.abs(px) - (hw - r);
    const qy = Math.abs(py) - (hh - r);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
  }

  function buildMap(w, h, radius, bezel) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const hw = w / 2;
    const hh = h / 2;
    const r = Math.min(radius, hw, hh);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const px = x + 0.5 - hw;
        const py = y + 0.5 - hh;
        const dist = -sdRoundRect(px, py, hw, hh, r); // >0 inside
        const o = (y * w + x) * 4;
        let dx = 0;
        let dy = 0;
        if (dist > 0 && dist < bezel) {
          // Inward normal = -gradient of the SDF.
          const gx = sdRoundRect(px + 0.5, py, hw, hh, r) - sdRoundRect(px - 0.5, py, hw, hh, r);
          const gy = sdRoundRect(px, py + 0.5, hw, hh, r) - sdRoundRect(px, py - 0.5, hw, hh, r);
          const len = Math.hypot(gx, gy) || 1;
          // Convex squircle bezel: steep at the rim, flat towards the centre.
          const t = 1 - dist / bezel;
          const m = t ** 2.2;
          dx = (-gx / len) * m;
          dy = (-gy / len) * m;
        }
        d[o] = 128 + dx * 127;
        d[o + 1] = 128 + dy * 127;
        d[o + 2] = 128;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // toDataURL is a synchronous PNG encode (~ms on bar-sized maps), and the
  // same few sizes come back whenever the player toggles theater mode or the
  // window returns to a previous width: keep the encoded maps around.
  const mapCache = new Map(); // `${w}x${h}x${radius}x${bezel}` -> data URL
  function mapFor(w, h, opts) {
    const key = `${w}x${h}x${opts.radius}x${opts.bezel}`;
    let url = mapCache.get(key);
    if (!url) {
      url = buildMap(w, h, opts.radius, opts.bezel);
      if (mapCache.size >= 48) mapCache.delete(mapCache.keys().next().value); // drag-resizes
      mapCache.set(key, url);
    }
    return url;
  }

  function writeFilter(id, w, h, opts) {
    const root = ensureDefs();
    let filter = root.querySelector(`#${id}`);
    if (!filter) {
      filter = document.createElementNS(SVG_NS, 'filter');
      filter.id = id;
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.setAttribute('filterUnits', 'userSpaceOnUse');
      filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
      filter.innerHTML = `
        <feGaussianBlur in="SourceGraphic" edgeMode="duplicate" result="frost"/>
        <feImage result="map" preserveAspectRatio="none" x="0" y="0"/>
        <feDisplacementMap in="frost" in2="map" xChannelSelector="R" yChannelSelector="G" result="lens"/>
        <feColorMatrix in="lens" type="saturate"/>`;
      root.appendChild(filter);
    }
    for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) filter.setAttribute(k, v);
    const image = filter.querySelector('feImage');
    image.setAttribute('width', w);
    image.setAttribute('height', h);
    image.setAttribute('href', mapFor(w, h, opts));
    filter.querySelector('feDisplacementMap').setAttribute('scale', opts.scale);
    filter.querySelector('feColorMatrix').setAttribute('values', opts.saturate);
    filter.querySelector('feGaussianBlur').setAttribute('stdDeviation', frostOf(opts));
  }

  // Glass follows the user's blur setting unless the caller fixed a value.
  let frost = 24;
  const frostOf = (opts) => opts.blur ?? frost; // = CSS blur() radius

  function setBlur(px) {
    frost = px;
    for (const entry of attached.values()) {
      defs?.querySelector(`#${entry.id} feGaussianBlur`)?.setAttribute('stdDeviation', frostOf(entry.opts));
    }
  }

  let resizeTimer = 0;
  const pending = new Set();

  function refresh(el) {
    const entry = attached.get(el);
    if (!entry) return;
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return;
    const key = `${w}x${h}`;
    if (key === entry.key) return;
    entry.key = key;
    writeFilter(entry.id, w, h, entry.opts);
    el.style.setProperty('--lg-refract', `url(#${entry.id})`);
  }

  /** Give `el` a refracting rim. Size changes rebuild the map (debounced). */
  function attach(el, opts = {}) {
    if (!el || attached.has(el)) return;
    const entry = {
      id: `lg-refract-${(seq += 1)}`,
      opts: { radius: 28, bezel: 18, scale: 36, saturate: 1.8, blur: null, ...opts },
      key: '',
      ro: new ResizeObserver(() => {
        pending.add(el);
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          pending.forEach(refresh);
          pending.clear();
        }, 160);
      }),
    };
    attached.set(el, entry);
    entry.ro.observe(el);
    refresh(el);
  }

  function detachAll() {
    for (const [el, entry] of attached) {
      entry.ro.disconnect();
      el.style.removeProperty('--lg-refract');
      defs?.querySelector(`#${entry.id}`)?.remove();
    }
    attached.clear();
  }

  // Drop entries whose element YouTube has thrown away (SPA re-renders).
  function prune() {
    for (const [el, entry] of attached) {
      if (el.isConnected) continue;
      entry.ro.disconnect();
      defs?.querySelector(`#${entry.id}`)?.remove();
      attached.delete(el);
    }
  }

  LG.refract = { attach, detachAll, prune, setBlur };
})();
