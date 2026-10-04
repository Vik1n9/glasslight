// Shared definitions for the perf harness: the clips, the settings presets and
// the pass/fail thresholds live here so every tool judges by the same standard.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Times are seconds of media time. `from`/`to` bound the measured window (the
// clip plus a lead-in); `stills` are the exact media times frozen for the
// pixel comparison. `region` is the part of the page the stills crop to: the
// player and what the extension draws around it, not the recommendation
// column YouTube reshuffles on every load, nor the title row under the player. README explains each pick.
export const SITES = {
  yt: {
    url: 'https://www.youtube.com/watch?v=55moNn0leAU',
    video: 'video.html5-main-video, #movie_player video',
    region: { x: 0, y: 0, width: 1010, height: 640 }, // masthead + player + the light around it; the title row below loads asynchronously and is not ours
    quality: 'hd1080', // pinned: YouTube's auto quality varies per load (480p one run, 1080p the next), which moves CPU and pixels
    clips: [{ name: 'yt-lightshow', from: 99, to: 123, stills: [103, 111, 119] }],
  },
  yt4k: {
    url: 'https://www.youtube.com/watch?v=xb-Oh2z1H88',
    video: 'video.html5-main-video, #movie_player video',
    region: { x: 0, y: 0, width: 1010, height: 640 }, // masthead + player + the light around it; the title row below loads asynchronously and is not ours
    quality: 'hd2160',
    clips: [{ name: 'yt4k-heavy', from: 34, to: 58, stills: [38, 46, 54] }],
  },
  ani: {
    url: 'https://ani.gamer.com.tw/animeVideo.php?sn=12866',
    video: '#video-container video.vjs-tech',
    region: { x: 0, y: 0, width: 1060, height: 710 },
    clips: [
      { name: 'ani-white', from: 1034, to: 1050, stills: [1038, 1042, 1046] },
      { name: 'ani-battle', from: 1198, to: 1214, stills: [1201, 1205, 1209] },
    ],
  },
};

// Keys as in LG.DEFAULTS. The two extremes are corners of the popup's ranges.
export const PRESETS = {
  default: { transparency: 50, intensity: 70, contrastTarget: 4.5 },
  'max-glass': { transparency: 100, intensity: 100, contrastTarget: 1.5 }, // most transparent, brightest light, weakest legibility help
  'solid-glow': { transparency: 0, intensity: 100, contrastTarget: 1.5 }, // most opaque, brightest light, weakest legibility help
};

// A candidate fails (hard) or warns (soft) against the baseline when:
export const THRESHOLDS = {
  cpuRatio: 1.1, // soft: TaskDuration may be this much higher (or 2x the baseline's own round-to-round spread)
  longTaskMs: 150, // soft: extra long-task milliseconds
  droppedSlack: 3, // hard: extra dropped frames allowed
  lagMs: 100, // hard: extra ambient-follow lag (the sampler resolves 100 ms)
  ambStdRatio: 0.85, // hard: ambient picture must keep this share of the baseline's swing
  visualMean: 2.0, // hard: mean per-channel pixel difference of a frozen frame (0-255)
  visualPct: 3.0, // hard: % of pixels differing by more than 24
  sysCpuPts: 8, // soft: extra CPU, in points of one core, beyond the baseline's own spread
  gpuProcCpuPts: 5, // soft: extra GPU-process CPU points
  gpuUtilPts: 10, // soft: extra system-wide GPU busy % (noisy: the whole machine)
  ramRatio: 1.15, // soft: renderer+GPU+browser RAM may be this much higher
  ramGrowthMB: 80, // soft: extra RAM growth over the window (leak hint)
  overheadPts: 5, // soft: the extension's own CPU cost (cand minus no-extension control) may exceed the baseline's by this many points
  stillMean: 0.02, // a frame counts as settled when two shots 700 ms apart differ by at most this mean level...
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

export const CHROMIUM = process.env.CHROMIUM_PATH || '/Applications/Chromium.app/Contents/MacOS/Chromium';

export const resolveSha = (ref) => (ref === 'WORKTREE' || ref === 'NONE' ? ref : execFileSync('git', ['-C', ROOT, 'rev-parse', ref], { encoding: 'utf8' }).trim());

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
