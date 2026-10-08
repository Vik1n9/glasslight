// One run = one site x one theme x one build of the extension. Normally driven
// by suite.mjs; call it directly to debug a single combination:
//
//   node tests/perf/run.mjs --site yt --ref WORKTREE --label cand --theme dark \
//        --presets default,max-glass --layout --out /tmp/lg-perf
//
// The page is loaded once (ads waited out once) and every settings preset is
// applied live through the extension's storage, like the popup does. Per preset
// and clip it records CPU, how the ambient light follows the video, and frozen
// stills for the pixel comparison; it also records pass/fail `checks` that need
// no baseline. Ads are never blocked or scripted away: the run waits for them
// to finish and clicks skip once the site offers it; Bahamut's age gate gets 同意.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CHROMIUM, HARNESS, PRESETS, SITES, THRESHOLDS, args, buildExtension, buildFingerprint, displayAt, loadHooks, loadPlaywright, measureSystem, resolveSha, sleep, startFocusGuard, waitForUserIdle } from './lib.mjs';

const { site, ref = 'WORKTREE', label = ref, round = '1', theme = 'light', presets: presetArg = 'default', out = path.join(os.tmpdir(), 'lg-perf') } = args;
// Where the test window opens, as "x,y" in top-left screen coordinates (e.g.
// "-1920,0" for a display left of the main one). Keeps the run off the screen
// you are working on; also LG_PERF_WINDOW in the environment.
const windowPos = args.window || process.env.LG_PERF_WINDOW || '';
const SETTLE = 2.5; // seconds of playback before a measured window starts, so the ambient light is already tracking
const withLayout = args.layout !== undefined && args.layout !== '0';
const cfg = SITES[site];
if (!cfg) throw new Error('--site must be one of: ' + Object.keys(SITES).join(', '));
if (!['light', 'dark'].includes(theme)) throw new Error('--theme must be light or dark');
const presetNames = presetArg.split(',');
// --clips a,b: only these clips of the site (a targeted dev loop); default all.
const clips = args.clips ? cfg.clips.filter((c) => args.clips.split(',').includes(c.name)) : cfg.clips;
if (!clips.length) throw new Error(`--clips matched none of ${cfg.clips.map((c) => c.name).join(', ')}`);
for (const n of presetNames) if (!PRESETS[n]) throw new Error(`unknown preset ${n}; have ${Object.keys(PRESETS).join(', ')}`);

const { chromium } = loadPlaywright();
fs.mkdirSync(out, { recursive: true });
// --ref NONE is the control: the same page and clip with no extension loaded, so
// the extension's own cost is candidate minus control.
const noExt = ref === 'NONE';
const ext = noExt ? null : buildExtension(ref, path.join(out, `ext-${label}`));
const profileDir = path.join(out, `profile-${site}-${theme}-${label}-${round}`);
// How the test browser is started (see lib.mjs, "keep the test browser from taking
// the keyboard"). The default, cdp, starts Chromium with no window and creates the test
// window in the background over CDP: verified to never take focus. --launch playwright
// lets Playwright launch it instead, which grabs focus, so that mode waits for idle first.
const launchMode = args.launch || 'cdp';
await waitForUserIdle(Number(args.idle ?? (launchMode === 'cdp' ? 0 : 8)), 'launching the test browser');
const focusGuard = startFocusGuard();
const chromeFlags = [
  ...(noExt ? [] : [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]),
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled',
  // The window sits unfocused on its own display: keep it rendering at full rate anyway.
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  // No permission bubbles ("youtube.com wants to show notifications", which signed-in pages ask for): deny without asking.
  '--deny-permission-prompts', '--disable-notifications',
  // Scrollbars that take space (a mouse is attached) come and go with the page length and
  // shift the whole layout by their width: one run's player was 1051 px wide, the next 1040.
  '--hide-scrollbars',
];
const [winX, winY] = (windowPos || '0,0').split(',').map(Number);
let ctx, closeBrowser, page;
if (launchMode === 'cdp') {
  // No Playwright launch flags here, so no forced sRGB profile: the display's HDR stays visible to the page.
  const port = await new Promise((res) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); }); });
  const proc = spawn(CHROMIUM, [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, '--no-startup-window', '--no-first-run', '--no-default-browser-check', ...chromeFlags], { stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { up = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false); if (!up) await sleep(500); }
  if (!up) throw new Error('Chromium did not open its debugging port');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  ctx = browser.contexts()[0];
  const bcdp = await browser.newBrowserCDPSession();
  const { targetId } = await bcdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, background: true });
  const { windowId } = await bcdp.send('Browser.getWindowForTarget', { targetId });
  await bcdp.send('Browser.setWindowBounds', { windowId, bounds: { left: winX, top: winY, width: 1440, height: 1000, windowState: 'normal' } });
  // Match the test page by its target id, not its URL: a page the extension opens at
  // launch (the options page on first install) can still be on about:blank here.
  const isTestTarget = async (p) => {
    const s = await ctx.newCDPSession(p).catch(() => null);
    if (!s) return false;
    const info = await s.send('Target.getTargetInfo').catch(() => null);
    await s.detach().catch(() => {});
    return info?.targetInfo?.targetId === targetId;
  };
  for (let i = 0; i < 40 && !page; i++) {
    for (const p of ctx.pages()) if (await isTestTarget(p)) { page = p; break; }
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('the background test window never attached');
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width: 1440, height: 900 });
  const exited = new Promise((res) => proc.once('exit', res));
  closeBrowser = async () => { // wait for Chromium to really go, so no orphan keeps eating CPU into the next run
    await bcdp.send('Browser.close').catch(() => {});
    if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) return;
    proc.kill('SIGKILL');
    await exited;
  };
} else {
  ctx = await chromium.launchPersistentContext(profileDir, {
    executablePath: CHROMIUM,
    headless: false,
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
    // Playwright forces an sRGB colour profile, which also hides the display's HDR
    // from the page (dynamic-range: high = false) so YouTube only sends SDR. With
    // --expect-hdr that flag is dropped for every site, keeping the pipeline identical.
    ignoreDefaultArgs: ['--enable-automation', ...(args['expect-hdr'] ? ['--force-color-profile=srgb'] : [])],
    args: [...chromeFlags, ...(windowPos ? [`--window-position=${windowPos}`] : [])],
  });
  closeBrowser = () => ctx.close();
  page = ctx.pages()[0] || (await ctx.newPage());
}
// Only the test page is measured. Anything else the extension or the browser opens
// (the options page on first install, which every fresh test profile is) has nothing
// to do with what the page shows, but its renderer would count towards RAM/CPU on one
// side only. Close it, now and whenever one appears, and record what was closed.
const strayPages = [];
const closeStray = (p) => {
  if (p === page) return;
  strayPages.push(p.url());
  return p.close().catch(() => {});
};
ctx.on('page', closeStray);
// Wait for these to be gone: context-wide calls below (addInitScript) fail on a page
// that is closing under them.
await Promise.all(ctx.pages().map(closeStray));
await ctx.addInitScript(() => {
  window.__lt = { n: 0, ms: 0, errs: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        __lt.n++;
        __lt.ms += e.duration;
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.addEventListener('error', (e) => __lt.errs.push(String(e.message)));
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { focusGuard.stop(); await closeBrowser().catch(() => {}); process.exit(130); });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const lt = () => page.evaluate(() => ({ ...__lt }));
const VSEL = cfg.video;
const quality = () => page.evaluate((s) => { const q = document.querySelector(s).getVideoPlaybackQuality(); return [q.totalVideoFrames, q.droppedVideoFrames]; }, VSEL);
const seek = (t) => page.evaluate(([s, t]) => { const v = document.querySelector(s); v.muted = true; v.currentTime = t; v.play().catch(() => {}); }, [VSEL, t]);

const result = { schema: 2, harness: HARNESS, build: buildFingerprint(ref), clipsArg: args.clips || '', site, theme, label, ref, sha: resolveSha(ref), round, windowPos, display: displayAt(windowPos), startedAt: new Date().toISOString(), presets: {}, checks: [] };
const T0 = Date.now(), timings = {}; // where the wall time goes: see result.timings
const mark = (k) => { timings[k] = +((Date.now() - T0) / 1000).toFixed(1); };
const check = (name, ok, detail = '') => result.checks.push({ name, ok: !!ok, detail: String(detail) });

// A hidden tab throttles rAF and timers, which would skew every number. Focus does
// not matter (the window is deliberately unfocused), visibility does.
const visible = () => page.evaluate(() => document.visibilityState === 'visible');

// Two shots of a frozen frame never match byte for byte (decoder dithering, GPU
// rounding). They are "the same" when the mean difference is invisible and next
// to no pixel moved by more than 8 levels.
const nearlyIdentical = async (a, b) => {
  const d = await page.evaluate(async ([x, y]) => {
    const decode = async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' })); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height).data; };
    const A = await decode(x), B = await decode(y);
    if (A.length !== B.length) return { mean: 255, pct: 100 };
    let sum = 0, over = 0;
    for (let i = 0; i < A.length; i += 4) { const e = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3; sum += e; if (e > 8) over++; }
    return { mean: sum / (A.length / 4), pct: (100 * over) / (A.length / 4) };
  }, [a.toString('base64'), b.toString('base64')]);
  return d.mean <= THRESHOLDS.stillMean && d.pct <= THRESHOLDS.stillPct;
};

// Promo / prompt dialogs the site layers over the page (more of them when signed
// in: notification nudges, Premium offers, "try this feature"). They are not ads,
// a viewer would just close them, and left open they cover the frames we compare.
// Closed through their own dismiss button, falling back to Escape; counted.
let popupsDismissed = 0;
async function dismissPopups() {
  if (!site.startsWith('yt')) return;
  const n = await page.evaluate(() => {
    const open = [...document.querySelectorAll('ytd-popup-container tp-yt-paper-dialog, ytd-popup-container tp-yt-iron-dropdown, yt-mealbar-promo-renderer, ytd-mealbar-promo-renderer, tp-yt-paper-toast#toast, yt-notification-action-renderer')].filter((el) => el.offsetParent || getComputedStyle(el).display !== 'none' && el.getClientRects().length);
    let closed = 0;
    for (const el of open) {
      const btn = [...el.querySelectorAll('button, yt-button-shape button, tp-yt-paper-button, #dismiss-button, [aria-label]')].find((b) => /不用了|不，謝謝|No thanks|Not now|稍後|關閉|Close|Dismiss|略過|知道了|Got it/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '')));
      if (btn) { btn.click(); closed++; }
    }
    return { open: open.length, closed };
  });
  if (n.open > n.closed) await page.keyboard.press('Escape');
  popupsDismissed += n.open;
  if (n.open) await sleep(400);
}

// Wait out pre-roll ads and the age gate; returns once the episode itself plays.
async function waitPlayable() {
  for (let i = 0; i < 60; i++) {
    if (site === 'ani') {
      const agree = page.getByText('同意', { exact: true }).first();
      if (await agree.isVisible().catch(() => false)) await agree.click().catch(() => {});
      const skip = page.getByText(/跳過廣告|略過廣告|Skip/).first();
      if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
      const st = await page.evaluate((s) => { const v = document.querySelector(s); return v ? { d: v.duration, p: v.paused } : null; }, VSEL);
      if (st && st.d > 600) return true; // the 7 s pre-roll is over, the episode is loaded
      if (st && st.d < 100 && st.p) await page.evaluate((s) => document.querySelector(s).play().catch(() => {}), VSEL);
    } else {
      if (!(await page.$('.ad-showing')) && (await page.$(VSEL))) return true;
      const skip = await page.$('.ytp-skip-ad-button, .ytp-ad-skip-button-modern');
      if (skip) await skip.click().catch(() => {});
    }
    await sleep(site === 'ani' ? 2000 : 1500);
  }
  return false;
}

// An ad that starts in the middle of a measured window (mid-rolls on long videos)
// would be measured as if it were the clip: detect it, wait it out, redo that pass.
const adPlaying = () => page.evaluate(([s, ani]) => {
  if (!ani) return !!document.querySelector('.ad-showing');
  const v = document.querySelector(s);
  return !v || v.duration < 100;
}, [VSEL, site === 'ani']);
async function withoutAds(name, pass) {
  for (let attempt = 1; ; attempt++) {
    const out = await pass();
    if (!(await adPlaying())) return out;
    check(`${name}:ad-interrupted`, attempt < 3, `an ad played during the pass (attempt ${attempt})`);
    if (attempt >= 3) return out;
    await waitPlayable();
  }
}

// Pin the visitor. A fresh profile is a new visitor, and YouTube buckets new
// visitors into layout experiments at random (one run got a 989x556 player, the
// next 926x521, same code), which moves every frame. The first run of a site in an
// --out directory saves its cookies; every later run (base, cand, control) starts
// with them, so all of them sit in the same bucket.
// A local session hook (see lib.mjs loadHooks) replaces the pinned visitor; its
// cookies are never written into --out.
const hooks = await loadHooks();
result.session = hooks.session;
await hooks.beforeNavigate({ ctx, site, url: cfg.url });
const cookieSeed = hooks.session === 'anonymous' ? path.join(out, `cookies-${new URL(cfg.url).hostname}.json`) : null;
if (cookieSeed && fs.existsSync(cookieSeed)) await ctx.addCookies(JSON.parse(fs.readFileSync(cookieSeed, 'utf8')));
await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(VSEL, { state: 'attached', timeout: 30000 }).catch(() => {});
await sleep(1500);
check('ads-cleared', await waitPlayable(), 'waited for pre-roll ads / age gate, never blocked');
await dismissPopups();
if (cookieSeed && !fs.existsSync(cookieSeed)) fs.writeFileSync(cookieSeed, JSON.stringify(await ctx.cookies(cfg.url)));
result.visitorPinned = true;

// Site theme. YouTube follows the emulated colour scheme from page load; the
// Bahamut switch rewrites html[data-theme], which the content script mirrors.
if (site === 'ani') await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
if (cfg.quality) {
  await page.evaluate((q) => document.getElementById('movie_player').setPlaybackQualityRange(q, q), cfg.quality);
  await seek(clips[0].from - 4);
  for (let i = 0; i < 20; i++) { // let the stream switch up to the pinned quality
    const h = await page.evaluate((s) => document.querySelector(s).videoHeight, VSEL);
    if (h >= Number(cfg.quality.replace('hd', ''))) break;
    await sleep(1500);
  }
  await sleep(3000);
}
// YouTube's responsive layout can settle at different widths depending on load
// timing. Nudge the viewport so it relays out against the final size, then wait.
await page.setViewportSize({ width: 1439, height: 900 });
await sleep(400);
await page.setViewportSize({ width: 1440, height: 900 });
await sleep(1200);
result.ready = await page.evaluate((s) => {
  const v = document.querySelector(s), p = document.getElementById('movie_player');
  let stats = null;
  try { const st = p?.getStatsForNerds?.(); stats = st && { res: st.resolution, codecs: st.codecs, color: st.color }; } catch {}
  const vr = v?.getBoundingClientRect();
  return { layout: { inner: `${innerWidth}x${innerHeight}`, video: vr ? `${Math.round(vr.left)},${Math.round(vr.top)} ${Math.round(vr.width)}x${Math.round(vr.height)}` : null }, env: { dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, hdr: matchMedia('(dynamic-range: high)').matches, screenX: screenX, screenY: screenY }, dur: v?.duration, w: v?.videoWidth, h: v?.videoHeight, stats, dark: document.documentElement.hasAttribute('dark') || document.documentElement.getAttribute('data-theme') === 'dark', canvases: document.querySelectorAll('#lg-ambient canvas').length, lgClear: document.querySelectorAll('.lg-clear').length };
}, VSEL);
if (!noExt) check('extension-active', result.ready.canvases === 3, `ambient canvases=${result.ready.canvases}`);
check('theme-applied', result.ready.dark === (theme === 'dark'), `wanted ${theme}, html[dark]=${result.ready.dark}`);
// --expect-hdr: the point of the run is the HDR path, so the stream must really be HDR.
if (args['expect-hdr'] && site === 'yt4k') check('hdr-stream', /smpte2084|pq|arib|hlg/i.test(result.ready.stats?.color || ''), `stream color ${result.ready.stats?.color || 'unknown'}, display HDR ${result.ready.env.hdr}`);
if (cfg.quality) check('quality-reached', result.ready.h >= Number(cfg.quality.replace('hd', '')), `${result.ready.w}x${result.ready.h} wanted ${cfg.quality}`);

mark('loadedAndReady');
// Settings go through chrome.storage.sync, which the content script's onChanged
// listener applies live, exactly like the popup does. The call runs inside the
// content script's own JS world (over CDP), so no extra tab is opened and the
// test window never needs to be raised or focused.
const isolated = [];
cdp.on('Runtime.executionContextCreated', ({ context }) => { if (context.auxData?.type === 'isolated' && context.origin.startsWith('chrome-extension://')) isolated.push(context.id); });
cdp.on('Runtime.executionContextsCleared', () => { isolated.length = 0; });
await cdp.send('Runtime.enable');
async function setStorage(values) {
  for (const id of [...isolated].reverse()) {
    const top = await cdp.send('Runtime.evaluate', { contextId: id, expression: 'window === window.top', returnByValue: true }).catch(() => null);
    if (!top?.result?.value) continue;
    const r = await cdp.send('Runtime.evaluate', { contextId: id, expression: `chrome.storage.sync.set(${JSON.stringify(values)}).then(() => true)`, awaitPromise: true, returnByValue: true });
    if (r.result?.value === true) return;
  }
  throw new Error('could not reach the extension content script to set storage');
}
async function applyPreset(name) {
  await dismissPopups();
  if (noExt) { await sleep(1000); return {}; }
  await setStorage(PRESETS[name]);
  await sleep(1500); // the scrim eases in over 240 ms
  check(`${name}:visible`, await visible(), 'page is rendering (not hidden)');
  return page.evaluate(() => Object.fromEntries([...document.documentElement.style].filter((p) => p.startsWith('--lg')).map((p) => [p, document.documentElement.style.getPropertyValue(p).slice(0, 40)])));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (x, y) => { const mx = mean(x), my = mean(y); return mean(x.map((e, i) => (e - mx) * (y[i] - my))) / (std(x) * std(y) || 1); };

// ---- per preset, per clip: A = CPU only, B = ambient sampler, C = frozen stills
for (const name of presetNames) {
  const rootVars = await applyPreset(name);
  const preset = { settings: PRESETS[name], rootVars, clips: {} };
  result.presets[name] = preset;
  if (!noExt) check(`${name}:preset-applied`, rootVars['--lg-transparency'] === (PRESETS[name].transparency / 100).toFixed(2), `--lg-transparency=${rootVars['--lg-transparency']}`);
  for (const clip of clips) {
    const r = { stills: [] };
    const dur = clip.to - clip.from;
    // A: CPU, nothing of ours in the page
    await withoutAds(`${name}/${clip.name}/cpu`, async () => {
      // Coming out of the previous preset's paused stills, a 4K HDR decoder needs longer
      // to warm up: without the extra 2 s the second preset of every run dropped 2-4
      // frames on both builds, whichever preset it was, and the first preset none.
      const warm = SETTLE + ((await page.evaluate((s) => document.querySelector(s).paused, VSEL)) ? 2 : 0);
      await seek(clip.from - warm);
      await sleep(warm * 1000);
      const m0 = await metrics(), l0 = await lt(), q0 = await quality();
      const t0 = await page.evaluate((s) => document.querySelector(s).currentTime, VSEL);
      r.sys = await measureSystem(profileDir, () => sleep(dur * 1000));
      const m1 = await metrics(), l1 = await lt(), q1 = await quality();
      const t1 = await page.evaluate((s) => document.querySelector(s).currentTime, VSEL);
      r.cpu = Object.fromEntries(KEYS.map((k) => [k, +(m1[k] - m0[k]).toFixed(4)]));
      Object.assign(r.cpu, { longTasks: l1.n - l0.n, longTaskMs: +(l1.ms - l0.ms).toFixed(0), frames: q1[0] - q0[0], dropped: q1[1] - q0[1] });
      r.mediaAdvanced = t1 - t0;
    });
    check(`${name}/${clip.name}:playing`, r.mediaAdvanced >= dur * 0.9, `media advanced ${r.mediaAdvanced.toFixed(1)}s of ${dur}s`);

    if (noExt) { preset.clips[clip.name] = r; continue; }

    // B: 10 Hz sampler of the extension's own canvases (#lg-ambient-canvas the
    // small ambient picture, #lg-scrim the legibility scrim alpha, #lg-glow the
    // halo) next to the source video's own luminance.
    await withoutAds(`${name}/${clip.name}/response`, async () => {
      await seek(clip.from - SETTLE);
      await sleep(SETTLE * 1000);
      await page.evaluate(([s, ms]) => {
        const v = document.querySelector(s);
        const amb = document.getElementById('lg-ambient-canvas'), scr = document.getElementById('lg-scrim'), glow = document.getElementById('lg-glow');
        const tmp = document.createElement('canvas');
        tmp.width = 8; tmp.height = 4;
        const tc = tmp.getContext('2d', { willReadFrequently: true });
        const read = (src, alpha) => {
          try {
            tc.clearRect(0, 0, 8, 4);
            tc.drawImage(src, 0, 0, 8, 4);
            const d = tc.getImageData(0, 0, 8, 4).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += alpha ? d[i + 3] : 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            return sum / 32;
          } catch { return null; }
        };
        window.__series = [];
        const t0 = performance.now();
        const id = setInterval(() => {
          window.__series.push({ vt: +v.currentTime.toFixed(2), vl: read(v), amb: read(amb), sa: read(scr, true), gl: read(glow) });
          if (performance.now() - t0 > ms) clearInterval(id);
        }, 100);
      }, [VSEL, (dur + 1) * 1000]);
      await sleep((dur + 1.5) * 1000);
      r.series = await page.evaluate(() => window.__series);
    });
    const ok = r.series.filter((p) => p.vl != null && p.amb != null);
    if (ok.length > 20 && std(ok.map((p) => p.vl)) > 3) {
      const c = corr(ok.map((p) => p.vl), ok.map((p) => p.amb));
      check(`${name}/${clip.name}:ambient-follows`, c >= THRESHOLDS.followCorr, `corr(video, ambient)=${c.toFixed(2)}`);
    }

    // C: frozen stills at fixed media times, for a deterministic pixel diff. A
    // still only counts once two shots 700 ms apart are byte-identical, so the
    // scrim ease, control fades and the like have finished; otherwise it is
    // retried and finally flagged unstable instead of poisoning the diff.
    for (const [i, t] of clip.stills.entries()) {
      await page.evaluate(([s, t]) => new Promise((res) => { const v = document.querySelector(s); v.pause(); v.addEventListener('seeked', () => res(), { once: true }); v.currentTime = t + 0.02; }), [VSEL, t]); // +0.02 s: the middle of a frame, so a seek can't land on either side of a boundary
      await dismissPopups();
      // Pinned scroll: one run's page had scrolled the player to the very top before a still,
      // so the frame, and where the video sat in it, no longer matched the other run's.
      await page.evaluate(() => scrollTo(0, 0));
      await page.mouse.move(1300, 880);
      await sleep(1500); // the ambient glow converges slowly after a seek: 1 s once left it ~7 levels short in one run
      let pair = null, stable = false;
      for (let attempt = 0; attempt < 4 && !stable; attempt++) {
        const a = await page.screenshot({ clip: cfg.region });
        await sleep(1000); // long enough for a slow drift to exceed the tolerance, not only fast fades
        const b = await page.screenshot({ clip: cfg.region });
        pair = [a, b];
        stable = a.equals(b) || (await nearlyIdentical(a, b));
      }
      const file = `still-${site}-${theme}-${name}-${clip.name}-${i}-${label}-${round}.png`;
      fs.writeFileSync(path.join(out, file), pair[1]);
      const vr = await page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}` : null; }, VSEL);
      const entry = { key: `${name}/${clip.name}/${i}@${t}s`, file, stable, video: vr }; // where the video sat in this very shot: compare.mjs masks it
      if (!stable) { // keep both shots: compare.mjs prints where they differ
        entry.pair = [file.replace('.png', '-a.png'), file.replace('.png', '-b.png')];
        pair.forEach((buf, k) => fs.writeFileSync(path.join(out, entry.pair[k]), buf));
      }
      r.stills.push(entry);
      check(`${name}/${clip.name}/${i}:still-stable`, stable, `frame at ${t}s ${stable ? 'settled' : 'kept changing'}`);
    }
    preset.clips[clip.name] = r;
  }
  mark(`preset:${name}`);
}

// ---- YouTube only, default settings: layout churn and SPA navigation --------
if (site.startsWith('yt') && withLayout && !noExt) {
  await applyPreset('default');
  await seek(clips[0].from);
  await sleep(2000);
  const run = async (name, fn) => {
    const m0 = await metrics(), l0 = await lt();
    await fn();
    const m1 = await metrics(), l1 = await lt();
    result[name] = Object.fromEntries(KEYS.map((k) => [k, +(m1[k] - m0[k]).toFixed(4)]));
    Object.assign(result[name], { longTasks: l1.n - l0.n, longTaskMs: +(l1.ms - l0.ms).toFixed(0) });
  };
  await run('theater x8', async () => { for (let i = 0; i < 8; i++) { await page.keyboard.press('t'); await sleep(2200); } });
  await run('scroll x10', async () => { for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, i % 2 ? -700 : 700); await sleep(900); } await page.evaluate(() => scrollTo(0, 0)); });
  await run('resize x6', async () => { for (const w of [1200, 1000, 1440, 900, 1300, 1440]) { await page.setViewportSize({ width: w, height: 900 }); await sleep(1500); } });
  result.state = await page.evaluate(() => ({
    lgClear: document.querySelectorAll('.lg-clear').length,
    refractFilters: document.querySelectorAll('filter[id^="lg-refract"]').length,
    refractMaps: [...document.querySelectorAll('filter[id^="lg-refract"] feImage')].filter((i) => (i.getAttribute('href') || '').startsWith('data:')).length,
    canvases: document.querySelectorAll('#lg-ambient canvas').length, // ours only: YouTube adds canvases of its own now and then
  }));
  check('refract-maps-set', result.state.refractFilters > 0 && result.state.refractMaps === result.state.refractFilters, JSON.stringify(result.state));

  // Client-side navigation to another video must rebind the ambient light to
  // the new <video> without duplicating or losing the layer.
  const before = await page.evaluate(() => location.search);
  const clicked = await page.evaluate(() => {
    const here = new URLSearchParams(location.search).get('v');
    const a = [...document.querySelectorAll('a[href^="/watch?v="]')].find((x) => x.offsetParent && new URL(x.href).searchParams.get('v') !== here && x.closest('#secondary, ytd-watch-next-secondary-results-renderer'));
    a?.click();
    return a ? new URL(a.href).searchParams.get('v') : null;
  });
  await sleep(3000);
  await waitPlayable();
  await sleep(5000);
  const nav = await page.evaluate(([s]) => ({
    search: location.search,
    layers: document.querySelectorAll('#lg-ambient').length,
    canvases: document.querySelectorAll('#lg-ambient canvas').length,
    glass: document.querySelectorAll('.lg-glass, .lg-clear').length,
    playing: !!document.querySelector(s) && document.querySelector(s).currentTime > 0,
  }), [VSEL]);
  check('spa-navigation', clicked && nav.search !== before && nav.layers === 1 && nav.canvases === 3 && nav.playing, JSON.stringify({ clicked, ...nav }));
}

mark('layoutAndSpa');
await applyPreset('default'); // leave the profile as we found it
result.errs = (await lt()).errs;
await hooks.afterRun({ ctx, site }).catch((e) => console.warn(`afterRun hook: ${e.message}`));
result.popupsDismissed = popupsDismissed;
result.focusSteals = focusGuard.steals; // times the test browser took focus and the guard gave it back
result.strayPages = strayPages; // pages other than the test page, closed before they could be measured
focusGuard.stop();
check('no-page-errors', result.errs.length === 0, result.errs.slice(0, 3).join(' | '));
result.finishedAt = new Date().toISOString();
result.timings = timings; // seconds since the run began, at each stage's end
fs.writeFileSync(path.join(out, `result-${site}-${theme}-${label}-${round}.json`), JSON.stringify(result));
const failed = result.checks.filter((c) => !c.ok);
console.log(`${site}/${theme}/${label}/${round}: ${result.checks.length - failed.length}/${result.checks.length} checks ok${failed.length ? ' — FAILED: ' + failed.map((c) => c.name).join(', ') : ''}`);
await closeBrowser();
// Each profile is ~70 MB and only the result and stills are needed afterwards.
if (args['keep-profile'] === undefined) fs.rmSync(profileDir, { recursive: true, force: true });
