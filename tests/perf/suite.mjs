// Runs the whole matrix and ends with a verdict.
//
//   node tests/perf/suite.mjs --window -1920,0       # quick: HEAD vs working tree, ~6 min
//   node tests/perf/suite.mjs --mode full            # everything, 2 rounds, ~2 h
//   node tests/perf/suite.mjs --base c58326b --cand HEAD --mode full
//   node tests/perf/suite.mjs --aa                   # A/A: base against itself, must PASS
//
// Dev loop: edit, run quick, read the verdict, fix, repeat. The baseline only
// reruns when its commit (and display) changes; the candidate always reruns.
// Runs alternate base/cand inside every site x theme so network and time-of-day
// drift lands on both sides. Exit code 1 means a hard failure.
//
//   --off               also run a no-extension control (default in full mode) so the extension's own CPU/GPU/RAM cost is separated from the page's
//   --clips a,b         only these clips (e.g. ani-white), for a targeted loop
//   --window x,y        open the test window on another display (or LG_PERF_WINDOW)
//   --expect-display WxH  refuse to run unless that display has this resolution
//   --expect-hdr        the display must be in HDR mode and the 4K stream must really be HDR
//   --launch playwright  let Playwright launch the browser (default: cdp, a background window that never takes focus)
//   --idle N            only launch a browser after N seconds without keyboard/mouse (default 0 for cdp, 8 for playwright)
//   touch <out>/PAUSE   finish the current run, then stop; delete the file and rerun to resume
//   Ctrl-C / SIGTERM    stop now, closing the browser; finished runs are kept
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS, args, displayAt, displayLabel, pauseFile, resolveSha } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODES = {
  // quick: the dev loop. One site, default settings, no layout churn: about 1 min when the baseline is cached.
  // Dark, because on YouTube the legibility scrim only engages in dark (in light it stays at 0), so a
  // light-only loop would never exercise it.
  quick: { sites: 'yt', themes: 'dark', presets: 'default', rounds: 1, layout: false, off: false },
  // full: every site, both themes, all settings in round 1; later rounds repeat only the default
  // settings (they calibrate noise and CPU variance; the display of the extremes needs one look).
  // Layout churn and SPA navigation run once, on YouTube light.
  full: { sites: 'yt,yt4k,ani', themes: 'light,dark', presets: 'default,max-glass,solid-glow', laterRoundPresets: 'default', rounds: 2, layout: true, off: true },
};
const mode = MODES[args.mode || 'quick'];
if (!mode) throw new Error('--mode must be quick or full');
const sites = (args.sites || mode.sites).split(',');
const themes = (args.themes || mode.themes).split(',');
const presets = args.presets || mode.presets;
const withOff = args.off !== undefined ? args.off !== '0' : mode.off; // control runs with no extension: gives the extension's own cost
const rounds = Number(args.rounds || mode.rounds);
const presetsFor = (round) => (round > 1 && mode.laterRoundPresets && !args.presets ? mode.laterRoundPresets : presets);
const layoutFor = (site, theme) => (args.layout !== undefined ? args.layout !== '0' : mode.layout) && site === 'yt' && theme === 'light';
const out = args.out || path.join(os.tmpdir(), 'lg-perf');
const BASE = args.base || 'HEAD';
const CAND = args.aa ? BASE : args.cand || 'WORKTREE';
const windowPos = args.window || process.env.LG_PERF_WINDOW || '';
const baseSha = resolveSha(BASE);
fs.mkdirSync(out, { recursive: true });

// ---- the display must be the one we think it is, and stay that way ----------
const sig = (d) => (d ? `${d.w}x${d.h}@${d.scale}${d.hdr ? 'h' : ''}` : 'unknown');
const startDisplay = displayAt(windowPos);
if (windowPos && !startDisplay) throw new Error(`--window ${windowPos} is not on any connected display (or displays cannot be read on this OS)`);
if (args['expect-display'] && sig(startDisplay).split('@')[0] !== args['expect-display']) throw new Error(`test display is ${displayLabel(startDisplay)}, expected ${args['expect-display']}; fix the display resolution first`);
if (args['expect-hdr'] && !startDisplay?.hdr) throw new Error(`--expect-hdr, but ${displayLabel(startDisplay)} is not in HDR mode: turn on High Dynamic Range for that display in System Settings > Displays`);
const driftGuard = () => {
  if (windowPos && sig(displayAt(windowPos)) !== sig(startDisplay)) {
    console.error(`\nSTOP: the test display changed from ${displayLabel(startDisplay)} to ${displayLabel(displayAt(windowPos))}. Numbers before and after are not comparable; fix it and rerun (finished runs are kept).`);
    process.exit(2);
  }
};

const resultPath = (site, theme, label, round) => path.join(out, `result-${site}-${theme}-${label}-${round}.json`);
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// A failed validity check means the numbers are about the test setup, not the code.
const VALIDITY = /^(ads-cleared|extension-active|theme-applied|quality-reached|hdr-stream)$|:(playing|preset-applied|visible|still-stable)$/;
const invalid = (r) => !r || r.schema !== 2 || r.checks.some((c) => !c.ok && VALIDITY.test(c.name));

function cached(site, theme, round, label, ref, wantPresets) {
  // (layout is wanted only where layoutFor says so)
  const sha = resolveSha(ref);
  if (sha === 'WORKTREE' || args.aa) return false;
  const r = read(resultPath(site, theme, label, round));
  const wantLayout = layoutFor(site, theme) && ref !== 'NONE';
  return !!(r && r.sha === sha && r.harness === HARNESS && (r.clipsArg || '') === (args.clips || '') && (r.windowPos || '') === windowPos && sig(r.display) === sig(startDisplay) && !invalid(r) && wantPresets.split(',').every((p) => r.presets[p]) && (!wantLayout || r['theater x8']));
}

let child = null;
const stop = (code) => { child?.kill('SIGTERM'); setTimeout(() => process.exit(code), 3000).unref(); };
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

const runOnce = (cmd) => new Promise((resolve) => {
  child = spawn(process.execPath, [path.join(here, 'run.mjs'), ...cmd], { stdio: 'inherit' });
  child.on('exit', (code) => { child = null; resolve(code); });
});

async function one(site, theme, label, ref, round, usePresets) {
  const cmd = ['--site', site, '--theme', theme, '--ref', ref, '--label', label, '--round', String(round), '--presets', usePresets, '--out', out];
  if (layoutFor(site, theme) && ref !== 'NONE') cmd.push('--layout');
  if (windowPos) cmd.push('--window', windowPos);
  for (const k of ['launch', 'idle', 'clips']) if (args[k] !== undefined) cmd.push('--' + k, args[k]);
  if (args['expect-hdr']) cmd.push('--expect-hdr'); // every site, so they share one colour pipeline; only yt4k asserts an HDR stream
  for (let attempt = 1; attempt <= 2; attempt++) {
    driftGuard();
    if (fs.existsSync(pauseFile(out))) { console.log(`\nPAUSE file found: stopping before ${site}/${theme}/${label}/${round}. Remove ${pauseFile(out)} and rerun to resume.`); process.exit(0); }
    const t = Date.now();
    const code = await runOnce(cmd);
    const r = read(resultPath(site, theme, label, round));
    if (code === 0 && !invalid(r)) return console.log(`  ${((Date.now() - t) / 60000).toFixed(1)} min`);
    console.log(`  attempt ${attempt} ${code === 0 ? 'had invalid checks' : 'crashed'}${attempt === 1 ? ', retrying once' : ''}`);
  }
}

console.log(`suite (${args.mode || 'quick'}, harness ${HARNESS}): base=${BASE} (${baseSha.slice(0, 7)}) cand=${args.aa ? BASE + ' (A/A)' : CAND} sites=${sites} themes=${themes} presets=${presets} rounds=${rounds}`);
console.log(`test display: ${windowPos ? displayLabel(startDisplay) : 'window placement not pinned (use --window x,y)'}`);
for (let round = 1; round <= rounds; round++) {
  const ps = presetsFor(round);
  for (const site of sites) {
    for (const theme of themes) {
      if (cached(site, theme, round, 'base', BASE, ps)) console.log(`[round ${round}] ${site}/${theme}/base: cached ${baseSha.slice(0, 7)}`);
      else { console.log(`[round ${round}] ${site}/${theme}/base`); await one(site, theme, 'base', BASE, round, ps); }
      console.log(`[round ${round}] ${site}/${theme}/cand`);
      await one(site, theme, 'cand', CAND, round, ps);
      if (withOff) {
        if (cached(site, theme, round, 'off', 'NONE', 'default')) console.log(`[round ${round}] ${site}/${theme}/off: cached`);
        else { console.log(`[round ${round}] ${site}/${theme}/off (no extension)`); await one(site, theme, 'off', 'NONE', round, 'default'); }
      }
    }
  }
}
const c = spawnSync(process.execPath, [path.join(here, 'compare.mjs'), out, '--base', 'base', '--cand', 'cand', ...(withOff ? ['--off', 'off'] : [])], { stdio: 'inherit' });
process.exit(c.status ?? 1);
