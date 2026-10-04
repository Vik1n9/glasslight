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
//   --window x,y        open the test window on another display (or LG_PERF_WINDOW)
//   --expect-display WxH  refuse to run unless that display has this resolution
//   --expect-hdr        the display must be in HDR mode and the 4K stream must really be HDR
//   touch <out>/PAUSE   finish the current run, then stop; delete the file and rerun to resume
//   Ctrl-C / SIGTERM    stop now, closing the browser; finished runs are kept
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, displayAt, displayLabel, pauseFile, resolveSha } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODES = {
  quick: { sites: 'yt', themes: 'light', presets: 'default', rounds: 1, layout: true },
  full: { sites: 'yt,yt4k,ani', themes: 'light,dark', presets: 'default,max-glass,solid-glow', rounds: 2, layout: true },
};
const mode = MODES[args.mode || 'quick'];
if (!mode) throw new Error('--mode must be quick or full');
const sites = (args.sites || mode.sites).split(',');
const themes = (args.themes || mode.themes).split(',');
const presets = args.presets || mode.presets;
const rounds = Number(args.rounds || mode.rounds);
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
const VALIDITY = /^(ads-cleared|extension-active|theme-applied|quality-reached|hdr-stream)$|:(playing|preset-applied|foreground|still-stable)$/;
const invalid = (r) => !r || r.schema !== 2 || r.checks.some((c) => !c.ok && VALIDITY.test(c.name));

function cached(site, theme, round) {
  if (baseSha === 'WORKTREE' || args.aa) return false;
  const r = read(resultPath(site, theme, 'base', round));
  const wantLayout = mode.layout && site.startsWith('yt');
  return r && r.sha === baseSha && (r.windowPos || '') === windowPos && sig(r.display) === sig(startDisplay) && !invalid(r) && presets.split(',').every((p) => r.presets[p]) && (!wantLayout || r['theater x8']);
}

let child = null;
const stop = (code) => { child?.kill('SIGTERM'); setTimeout(() => process.exit(code), 3000).unref(); };
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));

const runOnce = (cmd) => new Promise((resolve) => {
  child = spawn(process.execPath, [path.join(here, 'run.mjs'), ...cmd], { stdio: 'inherit' });
  child.on('exit', (code) => { child = null; resolve(code); });
});

async function one(site, theme, label, ref, round) {
  const cmd = ['--site', site, '--theme', theme, '--ref', ref, '--label', label, '--round', String(round), '--presets', presets, '--out', out];
  if (mode.layout && site.startsWith('yt')) cmd.push('--layout');
  if (windowPos) cmd.push('--window', windowPos);
  if (args['expect-hdr'] && site === 'yt4k') cmd.push('--expect-hdr');
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

console.log(`suite: base=${BASE} (${baseSha.slice(0, 7)}) cand=${args.aa ? BASE + ' (A/A)' : CAND} sites=${sites} themes=${themes} presets=${presets} rounds=${rounds}`);
console.log(`test display: ${windowPos ? displayLabel(startDisplay) : 'window placement not pinned (use --window x,y)'}`);
for (let round = 1; round <= rounds; round++) {
  for (const site of sites) {
    for (const theme of themes) {
      if (cached(site, theme, round)) console.log(`[round ${round}] ${site}/${theme}/base: cached ${baseSha.slice(0, 7)}`);
      else { console.log(`[round ${round}] ${site}/${theme}/base`); await one(site, theme, 'base', BASE, round); }
      console.log(`[round ${round}] ${site}/${theme}/cand`);
      await one(site, theme, 'cand', CAND, round);
    }
  }
}
const c = spawnSync(process.execPath, [path.join(here, 'compare.mjs'), out, '--base', 'base', '--cand', 'cand'], { stdio: 'inherit' });
process.exit(c.status ?? 1);
