// Shared definitions for the perf harness: the clips, the settings presets and
// the pass/fail thresholds live here so every tool judges by the same standard.
import { createRequire } from 'node:module';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Times are seconds of media time. `from`/`to` bound the measured window (12 s:
// long enough for steady-state CPU and to cover the interesting stretch; most of a
// run's wall time is these windows, so keep them short); `stills` are the exact media times frozen for the
// pixel comparison. `region` is the part of the page the stills crop to: the
// player and what the extension draws around it, not the recommendation
// column YouTube reshuffles on every load, nor the title row under the player. README explains each pick.
export const SITES = {
  yt: {
    url: 'https://www.youtube.com/watch?v=55moNn0leAU',
    video: 'video.html5-main-video, #movie_player video',
    region: { x: 0, y: 0, width: 1010, height: 640 }, // masthead + player + the light around it; the title row below loads asynchronously and is not ours
    quality: 'hd1080', // pinned: YouTube's auto quality varies per load (480p one run, 1080p the next), which moves CPU and pixels
    clips: [{ name: 'yt-lightshow', from: 101, to: 113, stills: [103, 108, 113] }],
  },
  yt4k: {
    url: 'https://www.youtube.com/watch?v=xb-Oh2z1H88',
    video: 'video.html5-main-video, #movie_player video',
    region: { x: 0, y: 0, width: 1010, height: 640 }, // masthead + player + the light around it; the title row below loads asynchronously and is not ours
    quality: 'hd2160',
    clips: [{ name: 'yt4k-heavy', from: 34, to: 46, stills: [36, 40, 44] }],
  },
  ani: {
    url: 'https://ani.gamer.com.tw/animeVideo.php?sn=12866',
    video: '#video-container video.vjs-tech',
    region: { x: 0, y: 0, width: 1060, height: 710 },
    clips: [
      { name: 'ani-white', from: 1036, to: 1048, stills: [1038, 1042, 1046] },
      { name: 'ani-battle', from: 1199, to: 1211, stills: [1201, 1205, 1209] },
    ],
  },
};

// Keys as in LG.DEFAULTS. The two extremes are corners of the popup's ranges.
export const PRESETS = {
  default: { transparency: 50, intensity: 70, contrastTarget: 4.5 },
  'max-glass': { transparency: 100, intensity: 100, contrastTarget: 1.5 }, // most transparent, brightest light, weakest legibility help
  'solid-glow': { transparency: 0, intensity: 100, contrastTarget: 1.5 }, // most opaque, brightest light, weakest legibility help
};

// A candidate fails (hard) or warns (soft) against the baseline when the change is
// beyond what identical code shows run to run. Calibrated on the full A/A of
// 2026-10-04 (32 base/cand pairs of the same build): worst observed noise was
// main-thread x1.20, CPU +-10.7 pts, GPU process +-7.0 pts, GPU busy +-7.4 pts,
// RAM 0.90-1.05x, long tasks +-335 ms, dropped frames +-4, mostly on 4K.
export const THRESHOLDS = {
  cpuRatio: 1.25, // soft: TaskDuration may be this much higher (or 2x the baseline's own round-to-round spread)
  longTaskMs: 400, // soft: extra long-task milliseconds
  droppedSlack: 6, // hard: extra dropped frames allowed
  lagMs: 100, // hard: extra ambient-follow lag (the sampler resolves 100 ms)
  ambStdRatio: 0.85, // hard: ambient picture must keep this share of the baseline's swing
  visualMean: 2.0, // hard: mean per-channel pixel difference of a frozen frame (0-255)
  visualPct: 3.0, // hard: % of pixels differing by more than 24
  sysCpuPts: 12, // soft: extra CPU, in points of one core, beyond the baseline's own spread
  gpuProcCpuPts: 8, // soft: extra GPU-process CPU points
  gpuUtilPts: 10, // soft: extra system-wide GPU busy % (noisy: the whole machine)
  ramRatio: 1.15, // soft: renderer+GPU+browser RAM may be this much higher
  ramGrowthMB: 150, // soft: extra RAM growth over the window (leak hint); the second full A/A saw +85 MB on identical code
  overheadPts: 5, // soft: the extension's own CPU cost (cand minus no-extension control) may exceed the baseline's by this many points
  stillMean: 0.25, // (HDR + backdrop blur dithers: settled frames still differ by 1-5 levels over ~10% of pixels, mean up to ~0.14) // a frame counts as settled when two shots 700 ms apart differ by at most this mean level...
  stillPct: 0.02, // ...and at most this % of pixels moved more than 8 levels
  followCorr: 0.4, // hard (absolute): video-vs-ambient correlation, when the clip has enough swing
};

export function loadPlaywright() {
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

// Version of the measuring code itself. Results from a different harness (other
// windows, waits or samplers) are not comparable, so the baseline cache and
// compare.mjs both key on it.
export const HARNESS = createHash('sha1').update(['lib.mjs', 'run.mjs'].map((f) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), f), 'utf8')).join('\0')).digest('hex').slice(0, 10);

// Local, untracked customisations of a run live outside version control: a module
// at LG_PERF_HOOKS, or tests/perf/local/hooks.mjs when present. It may export
// `session` (a label: runs with different sessions are never compared or reused
// as baselines), `beforeNavigate({ ctx, site, url })` and `afterRun({ ctx, site })`
// (called before the browser closes). Without one: 'anonymous'.
export async function loadHooks() {
  const p = process.env.LG_PERF_HOOKS || path.join(path.dirname(fileURLToPath(import.meta.url)), 'local', 'hooks.mjs');
  const mod = fs.existsSync(p) ? await import(pathToFileURL(p).href) : {};
  return { session: mod.session || 'anonymous', beforeNavigate: mod.beforeNavigate || (async () => {}), afterRun: mod.afterRun || (async () => {}) };
}

export const CHROMIUM = process.env.CHROMIUM_PATH || '/Applications/Chromium.app/Contents/MacOS/Chromium';

export const resolveSha = (ref) => (ref === 'WORKTREE' || ref === 'NONE' ? ref : execFileSync('git', ['-C', ROOT, 'rev-parse', ref], { encoding: 'utf8' }).trim());

// What code a run measured: the commit for a ref, a hash of the shipped files for
// the working tree (which changes with every edit). Debug mode uses it to tell
// which candidate results predate the latest fix.
export function buildFingerprint(ref) {
  if (ref === 'NONE') return 'NONE';
  if (ref !== 'WORKTREE') return resolveSha(ref);
  const h = createHash('sha1');
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
    else h.update(path.relative(ROOT, p)).update('\0').update(fs.readFileSync(p));
  };
  for (const item of ['manifest.json', '_locales', 'icons', 'src']) walk(path.join(ROOT, item));
  return 'worktree:' + h.digest('hex').slice(0, 10);
}

// Unpacked build of `ref` (or the working tree) without dev-reload, so the
// extension never reloads itself mid-run.
export function buildExtension(ref, dir) {
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

// --key value, --key=value, or a bare --flag (= "1"). Values may start with "-"
// (a window position like -1920,0) but not with "--".
export const args = (() => {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const eq = a[i].indexOf('=');
    if (eq > 0) out[a[i].slice(2, eq)] = a[i].slice(eq + 1);
    else if (a[i + 1] !== undefined && !a[i + 1].startsWith('--')) out[a[i].slice(2)] = a[++i];
    else out[a[i].slice(2)] = '1';
  }
  return out;
})();

// The physical displays (macOS), in the top-left coordinates Chromium's
// --window-position uses. A display that silently changed resolution or scale
// moves every number, so runs record this and the suite refuses to continue
// when it changes underneath it.
export function displays() {
  if (process.platform !== 'darwin') return null;
  try {
    const js = 'ObjC.import("AppKit"); JSON.stringify($.NSScreen.screens.js.map(s=>({x:s.frame.origin.x,y:s.frame.origin.y,w:s.frame.size.width,h:s.frame.size.height,scale:s.backingScaleFactor,edr:s.maximumPotentialExtendedDynamicRangeColorComponentValue})))';
    const list = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', js], { encoding: 'utf8' }));
    const H0 = list[0].h; // screens[0] is the menu-bar display; Cocoa's y grows upward
    return list.map((d, i) => ({ index: i, x: d.x, y: H0 - (d.y + d.h), w: d.w, h: d.h, scale: d.scale, hdr: d.edr > 1.5 }));
  } catch {
    return null;
  }
}

/** The display a window placed at "x,y" opens on, or null when unknown. */
export function displayAt(pos) {
  const all = displays();
  if (!all || !pos) return null;
  const [px, py] = pos.split(',').map(Number);
  return all.find((d) => px >= d.x && px < d.x + d.w && py >= d.y && py < d.y + d.h) || null;
}
export const displayLabel = (d) => (d ? `${d.w}x${d.h}@${d.scale}x${d.hdr ? ' HDR' : ''} (display ${d.index})` : 'unknown display');

/** Mark `file` as part of a stopped/paused suite: `touch <out>/PAUSE` stops it between runs. */
export const pauseFile = (out) => path.join(out, 'PAUSE');

// ---- process-level resource usage --------------------------------------------
// CDP's main-thread metrics miss the GPU process, the browser process and
// memory. Chromium's processes are found through ps by their --user-data-dir,
// split by --type, and sampled from outside the page so the page stays clean.
const cpuSeconds = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0); // [H:]MM:SS.ss

export function procSnapshot(profileDir) {
  const kinds = { browser: { cpu: 0, rss: 0, n: 0 }, renderer: { cpu: 0, rss: 0, n: 0 }, gpu: { cpu: 0, rss: 0, n: 0 }, other: { cpu: 0, rss: 0, n: 0 } };
  const ps = execFileSync('ps', ['-axo', 'rss=,cputime=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const line of ps.split('\n')) {
    if (!line.includes(profileDir)) continue;
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const type = /--type=([\w-]+)/.exec(m[3])?.[1];
    const k = kinds[!type ? 'browser' : type === 'renderer' ? 'renderer' : type === 'gpu-process' ? 'gpu' : 'other'];
    k.cpu += cpuSeconds(m[2]);
    k.rss += Number(m[1]) / 1024; // MB
    k.n++;
  }
  return kinds;
}

/** System-wide GPU busy % from the accelerator driver (Apple Silicon / AMD / Intel on macOS), or null. */
export function gpuUtilization() {
  if (process.platform !== 'darwin') return null;
  try {
    const t = execFileSync('ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator', '-w0'], { encoding: 'utf8' });
    const m = /"Device Utilization %"=(\d+)/.exec(t);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Sample every `everyMs` while `during()` runs. Returns the CPU used per process
 * kind over the window as a percentage of one core, the RAM mean/peak/growth per
 * kind in MB, and the GPU utilisation mean/peak.
 */
export async function measureSystem(profileDir, during, everyMs = 1000) {
  const t0 = Date.now(), s0 = procSnapshot(profileDir);
  const rss = [], gpu = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      await sleep(everyMs);
      const s = procSnapshot(profileDir);
      rss.push(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.rss])));
      const g = gpuUtilization();
      if (g != null) gpu.push(g);
    }
  })();
  await during();
  running = false;
  await loop;
  const s1 = procSnapshot(profileDir), secs = (Date.now() - t0) / 1000;
  const out = { cpuPct: {}, rssMB: {}, rssGrowthMB: {}, gpuUtil: gpu.length ? { mean: gpu.reduce((a, b) => a + b, 0) / gpu.length, max: Math.max(...gpu) } : null, procs: Object.fromEntries(Object.entries(s1).map(([k, v]) => [k, v.n])) };
  for (const k of Object.keys(s0)) {
    out.cpuPct[k] = (100 * (s1[k].cpu - s0[k].cpu)) / secs;
    const series = rss.map((r) => r[k]).concat(s1[k].rss);
    out.rssMB[k] = { mean: series.reduce((a, b) => a + b, 0) / series.length, max: Math.max(...series) };
    out.rssGrowthMB[k] = s1[k].rss - s0[k].rss;
  }
  out.cpuPct.total = Object.values(out.cpuPct).reduce((a, b) => a + b, 0);
  out.rssMB.total = { mean: Object.values(out.rssMB).reduce((a, b) => a + b.mean, 0), max: Object.values(out.rssMB).reduce((a, b) => a + b.max, 0) };
  return out;
}

// ---- keep the test browser from taking the keyboard ---------------------------
// The test window lives on its own display and must never take typing away from
// the work on the other one. Three layers (macOS only; elsewhere no-ops):
//  1. waitForUserIdle: a browser is only launched while the keyboard and mouse have
//     been idle for a few seconds, because launching is the moment Chromium grabs
//     app focus.
//  2. --launch cdp (run.mjs): Chromium starts with no window and the test window
//     is created in the background over CDP, which is meant not to activate the app.
//  3. startFocusGuard: whenever the test browser still ends up in front, the app
//     that had focus is brought back within a quarter of a second.
const osa = (script) => new Promise((resolve) => execFile('osascript', ['-e', script], { encoding: 'utf8' }, (err, out) => resolve(err ? null : out.trim())));
const sh = (cmd, a) => new Promise((resolve) => execFile(cmd, a, { encoding: 'utf8' }, (err, out) => resolve(err ? null : out)));

/** Seconds since the last keyboard/mouse event, or null when unreadable. */
export async function userIdleSeconds() {
  if (process.platform !== 'darwin') return null;
  const t = await sh('ioreg', ['-c', 'IOHIDSystem', '-d', '4']);
  const m = t && /"HIDIdleTime" = (\d+)/.exec(t);
  return m ? Number(m[1]) / 1e9 : null;
}

/** Block until the user has been idle for `seconds`, or `timeoutMs` passes (then go on, with a warning). */
export async function waitForUserIdle(seconds, label = 'launch', timeoutMs = 30 * 60 * 1000) {
  if (!seconds || process.platform !== 'darwin') return;
  const t0 = Date.now();
  let told = 0;
  for (;;) {
    const idle = await userIdleSeconds();
    if (idle == null || idle >= seconds) return;
    if (Date.now() - t0 > timeoutMs) { console.warn(`[idle] still no ${seconds}s of idle after ${timeoutMs / 60000} min; ${label} anyway`); return; }
    if (Date.now() - told > 30000) { console.log(`[idle] waiting for ${seconds}s without keyboard/mouse before ${label} (idle ${idle.toFixed(1)}s)`); told = Date.now(); }
    await sleep(700);
  }
}

export function startFocusGuard(testApp = 'Chromium') {
  if (process.platform !== 'darwin') return { stop() {}, steals: 0 };
  const g = { steals: 0, busy: false, stop: () => clearInterval(timer) };
  let prevAsn = null, prevName = null;
  const nameOf = async (asn) => /^"([^"]+)"/.exec((await sh('lsappinfo', ['info', '-only', 'name', asn])) || '')?.[1] || null;
  const tick = async () => {
    if (g.busy) return;
    g.busy = true;
    const asn = ((await sh('lsappinfo', ['front'])) || '').trim();
    if (asn && asn !== prevAsn) {
      const name = await nameOf(asn);
      if (name && name !== testApp) { prevAsn = asn; prevName = await osa('tell application "System Events" to get name of first application process whose frontmost is true'); } // the process name System Events and `activate` use
      else if (name === testApp && prevName) { await osa(`tell application "${prevName}" to activate`); g.steals++; }
    }
    g.busy = false;
  };
  const timer = setInterval(tick, 250);
  tick();
  return g;
}
