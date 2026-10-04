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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROMIUM, PRESETS, SITES, THRESHOLDS, args, buildExtension, displayAt, loadPlaywright, resolveSha, sleep } from './lib.mjs';

const { site, ref = 'WORKTREE', label = ref, round = '1', theme = 'light', presets: presetArg = 'default', out = path.join(os.tmpdir(), 'lg-perf') } = args;
// Where the test window opens, as "x,y" in top-left screen coordinates (e.g.
// "-1920,0" for a display left of the main one). Keeps the run off the screen
// you are working on; also LG_PERF_WINDOW in the environment.
const windowPos = args.window || process.env.LG_PERF_WINDOW || '';
const withLayout = args.layout !== undefined && args.layout !== '0';
const cfg = SITES[site];
if (!cfg) throw new Error('--site must be one of: ' + Object.keys(SITES).join(', '));
if (!['light', 'dark'].includes(theme)) throw new Error('--theme must be light or dark');
const presetNames = presetArg.split(',');
for (const n of presetNames) if (!PRESETS[n]) throw new Error(`unknown preset ${n}; have ${Object.keys(PRESETS).join(', ')}`);

const { chromium } = loadPlaywright();
fs.mkdirSync(out, { recursive: true });
const ext = buildExtension(ref, path.join(out, `ext-${label}`));
const ctx = await chromium.launchPersistentContext(path.join(out, `profile-${site}-${theme}-${label}-${round}`), {
  executablePath: CHROMIUM,
  headless: false,
  viewport: { width: 1440, height: 900 },
  colorScheme: theme,
  ignoreDefaultArgs: ['--enable-automation'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled', ...(windowPos ? [`--window-position=${windowPos}`] : [])],
});
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
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await ctx.close().catch(() => {}); process.exit(130); });
const page = ctx.pages()[0] || (await ctx.newPage());
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const lt = () => page.evaluate(() => ({ ...__lt }));
const VSEL = cfg.video;
const quality = () => page.evaluate((s) => { const q = document.querySelector(s).getVideoPlaybackQuality(); return [q.totalVideoFrames, q.droppedVideoFrames]; }, VSEL);
const seek = (t) => page.evaluate(([s, t]) => { const v = document.querySelector(s); v.muted = true; v.currentTime = t; v.play().catch(() => {}); }, [VSEL, t]);

const result = { schema: 2, site, theme, label, ref, sha: resolveSha(ref), round, windowPos, display: displayAt(windowPos), startedAt: new Date().toISOString(), presets: {}, checks: [] };
const check = (name, ok, detail = '') => result.checks.push({ name, ok: !!ok, detail: String(detail) });

// A hidden or unfocused tab throttles rAF and timers, which would skew every number.
const foreground = () => page.evaluate(() => document.visibilityState === 'visible' && document.hasFocus());

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

await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
await sleep(4000);
check('ads-cleared', await waitPlayable(), 'waited for pre-roll ads / age gate, never blocked');

// Site theme. YouTube follows the emulated colour scheme from page load; the
// Bahamut switch rewrites html[data-theme], which the content script mirrors.
if (site === 'ani') await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
if (cfg.quality) {
  await page.evaluate((q) => document.getElementById('movie_player').setPlaybackQualityRange(q, q), cfg.quality);
  await seek(cfg.clips[0].from - 4);
  for (let i = 0; i < 20; i++) { // let the stream switch up to the pinned quality
    const h = await page.evaluate((s) => document.querySelector(s).videoHeight, VSEL);
    if (h >= Number(cfg.quality.replace('hd', ''))) break;
    await sleep(1500);
  }
  await sleep(3000);
}
await sleep(1500);
result.ready = await page.evaluate((s) => {
  const v = document.querySelector(s), p = document.getElementById('movie_player');
  let stats = null;
  try { const st = p?.getStatsForNerds?.(); stats = st && { res: st.resolution, codecs: st.codecs, color: st.color }; } catch {}
  return { env: { dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, hdr: matchMedia('(dynamic-range: high)').matches, screenX: screenX, screenY: screenY }, dur: v?.duration, w: v?.videoWidth, h: v?.videoHeight, stats, dark: document.documentElement.hasAttribute('dark'), canvases: document.querySelectorAll('#lg-ambient canvas').length, lgClear: document.querySelectorAll('.lg-clear').length };
}, VSEL);
check('extension-active', result.ready.canvases === 3, `ambient canvases=${result.ready.canvases}`);
check('theme-applied', result.ready.dark === (theme === 'dark'), `wanted ${theme}, html[dark]=${result.ready.dark}`);
// --expect-hdr: the point of the run is the HDR path, so the stream must really be HDR.
if (args['expect-hdr']) check('hdr-stream', /smpte2084|pq|arib|hlg/i.test(result.ready.stats?.color || ''), `stream color ${result.ready.stats?.color || 'unknown'}, display HDR ${result.ready.env.hdr}`);
if (cfg.quality) check('quality-reached', result.ready.h >= Number(cfg.quality.replace('hd', '')), `${result.ready.w}x${result.ready.h} wanted ${cfg.quality}`);

// Settings go through chrome.storage.sync from an extension page, which the
// content script's onChanged listener applies live, exactly like the popup.
const extId = new URL((ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }))).url()).host;
const setterPage = await ctx.newPage();
await setterPage.goto(`chrome-extension://${extId}/src/popup/popup.html`);
async function applyPreset(name) {
  await setterPage.evaluate((v) => chrome.storage.sync.set(v), PRESETS[name]);
  await page.bringToFront(); // a background tab would throttle rAF and skew everything
  await sleep(2500);
  check(`${name}:foreground`, await foreground(), 'page visible and focused');
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
  check(`${name}:preset-applied`, rootVars['--lg-transparency'] === (PRESETS[name].transparency / 100).toFixed(2), `--lg-transparency=${rootVars['--lg-transparency']}`);
  for (const clip of cfg.clips) {
    const r = { stills: [] };
    const dur = clip.to - clip.from;
    // A: CPU, nothing of ours in the page
    await seek(clip.from - 4);
    await sleep(3500);
    const m0 = await metrics(), l0 = await lt(), q0 = await quality();
    const t0 = await page.evaluate((s) => document.querySelector(s).currentTime, VSEL);
    await sleep(dur * 1000);
    const m1 = await metrics(), l1 = await lt(), q1 = await quality();
    const t1 = await page.evaluate((s) => document.querySelector(s).currentTime, VSEL);
    r.cpu = Object.fromEntries(KEYS.map((k) => [k, +(m1[k] - m0[k]).toFixed(4)]));
    Object.assign(r.cpu, { longTasks: l1.n - l0.n, longTaskMs: +(l1.ms - l0.ms).toFixed(0), frames: q1[0] - q0[0], dropped: q1[1] - q0[1] });
    check(`${name}/${clip.name}:playing`, t1 - t0 >= dur * 0.9, `media advanced ${(t1 - t0).toFixed(1)}s of ${dur}s`);

    // B: 10 Hz sampler of the extension's own canvases (#lg-ambient-canvas the
    // small ambient picture, #lg-scrim the legibility scrim alpha, #lg-glow the
    // halo) next to the source video's own luminance.
    await seek(clip.from - 4);
    await sleep(3500);
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
    }, [VSEL, (dur + 4) * 1000]);
    await sleep((dur + 4.5) * 1000);
    r.series = await page.evaluate(() => window.__series);
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
      await page.evaluate(([s, t]) => new Promise((res) => { const v = document.querySelector(s); v.pause(); v.addEventListener('seeked', () => res(), { once: true }); v.currentTime = t; }), [VSEL, t]);
      await page.mouse.move(1300, 880);
      await sleep(1500);
      let buf = null, stable = false;
      for (let attempt = 0; attempt < 4 && !stable; attempt++) {
        const a = await page.screenshot({ clip: cfg.region });
        await sleep(700);
        const b = await page.screenshot({ clip: cfg.region });
        buf = b;
        stable = a.equals(b);
      }
      const file = `still-${site}-${theme}-${name}-${clip.name}-${i}-${label}-${round}.png`;
      fs.writeFileSync(path.join(out, file), buf);
      r.stills.push({ key: `${name}/${clip.name}/${i}@${t}s`, file, stable });
      check(`${name}/${clip.name}/${i}:still-stable`, stable, `frame at ${t}s ${stable ? 'settled' : 'kept changing'}`);
    }
    preset.clips[clip.name] = r;
  }
}

// ---- YouTube only, default settings: layout churn and SPA navigation --------
if (site.startsWith('yt') && withLayout) {
  await applyPreset('default');
  await seek(cfg.clips[0].from);
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
    canvases: document.querySelectorAll('canvas').length,
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

await applyPreset('default'); // leave the profile as we found it
result.errs = (await lt()).errs;
check('no-page-errors', result.errs.length === 0, result.errs.slice(0, 3).join(' | '));
result.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, `result-${site}-${theme}-${label}-${round}.json`), JSON.stringify(result));
const failed = result.checks.filter((c) => !c.ok);
console.log(`${site}/${theme}/${label}/${round}: ${result.checks.length - failed.length}/${result.checks.length} checks ok${failed.length ? ' — FAILED: ' + failed.map((c) => c.name).join(', ') : ''}`);
await ctx.close();
