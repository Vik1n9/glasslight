// Real-site performance + experience harness. One run = one site, one build of
// the extension, one round. See README.md for why the clips below were chosen.
//
//   node tests/perf/run.mjs --site yt  --ref c58326b --label old --round 1 --out /tmp/lg-perf
//   node tests/perf/run.mjs --site yt  --ref HEAD    --label new --round 1 --out /tmp/lg-perf
//   node tests/perf/compare.mjs /tmp/lg-perf
//
// Ads are never blocked or scripted away: the run waits for them to finish and
// clicks the skip button once the site offers it. Bahamut's age-rating gate is
// answered with 同意.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const { site, ref = 'WORKTREE', label = ref, round = '1', out = path.join(os.tmpdir(), 'lg-perf') } = args;

// The two clips and the reasons behind them live in README.md. Times are
// seconds of media time; each window is the clip itself plus a lead-in so the
// extension is already tracking when the interesting part starts.
const SITES = {
  yt: {
    url: 'https://www.youtube.com/watch?v=55moNn0leAU',
    video: 'video.html5-main-video, #movie_player video',
    clips: [{ name: 'yt-lightshow', from: 99, to: 123 }], // core: 1:41 onward
  },
  ani: {
    url: 'https://ani.gamer.com.tw/animeVideo.php?sn=12866',
    video: '#video-container video.vjs-tech',
    clips: [
      { name: 'ani-white', from: 1034, to: 1050 }, // core: 17:18–17:27, black into full white
      { name: 'ani-battle', from: 1198, to: 1214 }, // core: 20:00–20:10, violent fight
    ],
  },
};
const cfg = SITES[site];
if (!cfg) throw new Error('--site must be one of: ' + Object.keys(SITES).join(', '));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  const roots = [process.cwd() + '/', process.env.PLAYWRIGHT_CORE_DIR && process.env.PLAYWRIGHT_CORE_DIR + '/'];
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim() + '/@playwright/cli/package.json');
  } catch {}
  for (const r of roots.filter(Boolean)) {
    try {
      return createRequire(r)('playwright-core');
    } catch {}
  }
  throw new Error('playwright-core not found: npm i -g @playwright/cli, or set PLAYWRIGHT_CORE_DIR');
}
const { chromium } = loadPlaywright();

// Unpacked build of `ref` (or the working tree) without dev-reload, so the
// extension never reloads itself mid-run.
function buildExtension() {
  const dir = path.join(out, `ext-${label}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (ref === 'WORKTREE') {
    for (const item of ['manifest.json', '_locales', 'icons', 'src']) fs.cpSync(path.join(ROOT, item), path.join(dir, item), { recursive: true });
  } else {
    const tar = execFileSync('git', ['-C', ROOT, 'archive', ref], { maxBuffer: 256 << 20 });
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
  }
  const mp = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  for (const cs of manifest.content_scripts) cs.js = cs.js.filter((j) => !j.includes('dev-reload'));
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 1));
  return dir;
}

fs.mkdirSync(out, { recursive: true });
const ext = buildExtension();
const ctx = await chromium.launchPersistentContext(path.join(out, `profile-${site}-${label}-${round}`), {
  executablePath: process.env.CHROMIUM_PATH || '/Applications/Chromium.app/Contents/MacOS/Chromium',
  headless: false,
  viewport: { width: 1440, height: 900 },
  ignoreDefaultArgs: ['--enable-automation'],
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-blink-features=AutomationControlled'],
});
await ctx.addInitScript(() => {
  window.__lt = { n: 0, ms: 0, max: 0, errs: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        __lt.n++;
        __lt.ms += e.duration;
        __lt.max = Math.max(__lt.max, e.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  window.addEventListener('error', (e) => __lt.errs.push(String(e.message)));
});
const page = ctx.pages()[0] || (await ctx.newPage());
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'];
const lt = () => page.evaluate(() => ({ ...__lt }));
const VSEL = cfg.video;
const quality = () => page.evaluate((s) => { const q = document.querySelector(s).getVideoPlaybackQuality(); return [q.totalVideoFrames, q.droppedVideoFrames]; }, VSEL);
const result = { site, label, ref, round, clips: {} };

// ---- get to a playing, ad-free video --------------------------------------
await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
await sleep(4000);
for (let i = 0; i < 60; i++) {
  if (site === 'ani') {
    const agree = page.getByText('同意', { exact: true }).first();
    if (await agree.isVisible().catch(() => false)) await agree.click().catch(() => {});
    const skip = page.getByText(/跳過廣告|略過廣告|Skip/).first();
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
    const st = await page.evaluate((s) => { const v = document.querySelector(s); return v ? { d: v.duration, p: v.paused } : null; }, VSEL);
    if (st && st.d > 600) break; // the 7 s pre-roll is over, the episode is loaded
    if (st && st.d < 100 && st.p) await page.evaluate((s) => document.querySelector(s).play().catch(() => {}), VSEL);
  } else {
    if (!(await page.$('.ad-showing'))) break;
    const skip = await page.$('.ytp-skip-ad-button, .ytp-ad-skip-button-modern');
    if (skip) await skip.click().catch(() => {});
  }
  await sleep(site === 'ani' ? 2000 : 1500);
}
result.ready = await page.evaluate((s) => ({ dur: document.querySelector(s)?.duration, canvases: document.querySelectorAll('#lg-ambient canvas').length, lgClear: document.querySelectorAll('.lg-clear').length }), VSEL);
const seek = (t) => page.evaluate(([s, t]) => { const v = document.querySelector(s); v.muted = true; v.currentTime = t; v.play().catch(() => {}); }, [VSEL, t]);

// ---- per clip: pass A = CPU only, pass B = response sampler + screenshots ---
for (const clip of cfg.clips) {
  const r = {};
  await seek(clip.from - 4);
  await sleep(4500);
  const m0 = await metrics(), l0 = await lt(), q0 = await quality();
  await sleep((clip.to - clip.from) * 1000);
  const m1 = await metrics(), l1 = await lt(), q1 = await quality();
  r.cpu = Object.fromEntries(KEYS.map((k) => [k, +(m1[k] - m0[k]).toFixed(4)]));
  Object.assign(r.cpu, { longTasks: l1.n - l0.n, longTaskMs: +(l1.ms - l0.ms).toFixed(0), frames: q1[0] - q0[0], dropped: q1[1] - q0[1] });

  // The sampler reads the extension's own canvases at 10 Hz: the small ambient
  // picture (#lg-ambient-canvas), the text-legibility scrim alpha (#lg-scrim)
  // and the halo (#lg-glow), next to the source video's own luminance.
  await seek(clip.from - 4);
  await sleep(4500);
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
  }, [VSEL, (clip.to - clip.from + 4) * 1000]);
  const end = Date.now() + (clip.to - clip.from + 4) * 1000;
  let shot = 0;
  while (Date.now() < end) {
    await sleep(2500);
    const vt = await page.evaluate((s) => document.querySelector(s).currentTime, VSEL);
    if (vt >= clip.from + 4 && vt <= clip.to) await page.screenshot({ path: path.join(out, `shot-${clip.name}-${label}-${round}-${shot++}-${Math.round(vt)}s.png`) });
  }
  r.series = await page.evaluate(() => window.__series);
  result.clips[clip.name] = r;
}

// ---- layout churn on the watch page (YouTube only) ------------------------
if (site === 'yt') {
  const snap = () => page.evaluate(() => ({
    lgClear: document.querySelectorAll('.lg-clear').length,
    refractFilters: document.querySelectorAll('filter[id^="lg-refract"]').length,
    refractMaps: [...document.querySelectorAll('filter[id^="lg-refract"] feImage')].filter((i) => (i.getAttribute('href') || '').startsWith('data:')).length,
    canvases: document.querySelectorAll('canvas').length,
    rootClass: document.documentElement.className,
  }));
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
  result.state = await snap();
}
result.errs = (await lt()).errs;
fs.writeFileSync(path.join(out, `result-${site}-${label}-${round}.json`), JSON.stringify(result));
await ctx.close();
