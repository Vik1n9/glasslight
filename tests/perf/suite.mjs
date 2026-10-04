// Runs a plan of suites and ends with a verdict.
//
//   node tests/perf/suite.mjs                       # auto: pick the suites the changes call for (HEAD vs working tree)
//   node tests/perf/suite.mjs --suite legibility    # one targeted suite (分項); several: --suite glass,ani
//   node tests/perf/suite.mjs --suite full          # the complete test (also: --mode full)
//   node tests/perf/suite.mjs --base c58326b --cand HEAD --suite full
//   node tests/perf/suite.mjs --aa                  # A/A: base against itself (smoke unless --suite), must PASS
//   node tests/perf/suite.mjs --debug ...           # debug mode: stop at the first failing cell, fix, then --resume
//   node tests/perf/suite.mjs --resume              # debug mode: continue from where it stopped (same --out)
//   node tests/perf/suite.mjs --list                # the suites, what they cover, how long they take
//   node tests/perf/suite.mjs --dry                 # show what auto (or --suite) would run, and the estimate; run nothing
//
// Auto mode diffs base..cand (or base..working tree), maps every changed file to
// the suites that cover it (plan.mjs, COVERAGE), says why, names changes this
// harness cannot measure, and runs only what is needed. A file no rule knows
// gets the full suite. The baseline only reruns when its commit, the measuring
// code or the display changes; the candidate always reruns. Inside every
// site x theme base and cand alternate, so drift lands on both. Exit 1 = a hard failure.
//
//   --window x,y        open the test window on another display (or LG_PERF_WINDOW)
//   --expect-display WxH  refuse to run unless that display has this resolution
//   --expect-hdr        the display must be in HDR mode and the 4K stream must really be HDR
//   --launch playwright  let Playwright launch the browser (default: cdp, a background window that never takes focus)
//   --idle N            only launch a browser after N seconds without keyboard/mouse (default 0 for cdp, 8 for playwright)
//
// Debug mode (only with --debug or --resume; never the default): every site x
// theme is judged as soon as it is measured. The first hard failure (with
// --debug warn: also a warning) stops the run, saves where it stopped in
// <out>/debug-state.json and prints the resume command. After fixing, --resume
// picks up at that cell (re-measuring the candidate there; the baseline stays
// cached) and goes on. Cells that passed before the fix were measured on older
// code, so they are re-measured at the end before the final verdict.
//
//   touch <out>/PAUSE   finish the current run, then stop; delete the file and rerun to resume
//   Ctrl-C / SIGTERM    stop now, closing the browser; finished runs are kept
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HARNESS, ROOT, args, buildFingerprint, displayAt, displayLabel, pauseFile, resolveSha } from './lib.mjs';
import { SUITES, buildPlan, estimate, selectSuites } from './plan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = args.out || path.join(os.tmpdir(), 'lg-perf');
const statePath = path.join(out, 'debug-state.json');
const savedArgs = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'resume'));
let state = null;
if (args.resume) {
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { throw new Error(`--resume: no ${statePath}; nothing stopped in debug mode in this --out`); }
  for (const [k, v] of Object.entries(state.args)) if (args[k] === undefined) args[k] = v; // flags given now override the saved ones
}
const debug = args.debug !== undefined || !!state;
const debugWarn = args.debug === 'warn';
const BASE = args.base || 'HEAD';
const CAND = args.aa ? BASE : args.cand || 'WORKTREE';
const windowPos = args.window || process.env.LG_PERF_WINDOW || '';
const baseSha = resolveSha(BASE);

// ---- --list: the menu -----------------------------------------------------------
if (args.list) {
  for (const [name, s] of Object.entries(SUITES)) {
    const plan = buildPlan([name]);
    console.log(`\n${name}  (~${estimate(plan).toFixed(0)} min cold, ~${estimate(plan, { baseCached: true }).toFixed(0)} min with the baseline cached)\n  ${s.what}`);
    for (const c of plan.cells) console.log(`    ${`${c.site}/${c.theme}`.padEnd(12)} presets ${c.presets.join(',')}  clips ${c.clips.join(',')}${c.layout ? '  +layout/SPA' : ''}${c.off ? '  +no-extension control' : ''}`);
    if (plan.rounds > 1) console.log(`    rounds ${plan.rounds} (later rounds: default settings only)`);
  }
  process.exit(0);
}

// ---- which suites -----------------------------------------------------------
const alias = { quick: 'smoke', full: 'full' };
let names = state ? state.names : args.suite ? args.suite.split(',') : args.mode ? [alias[args.mode] || args.mode] : null;
if (!names && args.aa) names = ['smoke'];
if (!names) {
  const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = CAND === 'WORKTREE'
    ? [...new Set([...git('diff', '--name-only', baseSha), ...git('ls-files', '--others', '--exclude-standard')])]
    : git('diff', '--name-only', baseSha, resolveSha(CAND));
  const sel = selectSuites(files);
  console.log(`auto: ${files.length} changed file(s) between ${BASE} and ${CAND}`);
  for (const n of sel.notes) console.log(`  ${n}`);
  if (sel.uncovered.length) {
    console.log('\nNOT MEASURED by this harness, check these by hand:');
    for (const u of sel.uncovered) console.log(`  - ${u}`);
  }
  if (sel.harness) {
    console.log('\nThe measuring code changed: running the judge self-test first. Baselines re-measure on their own (they key on the harness version); run --aa to re-prove the standard.');
    const t = spawnSync(process.execPath, [path.join(here, 'selftest.mjs')], { stdio: 'inherit' });
    if (t.status !== 0) process.exit(1);
  }
  if (!sel.suites.length) { console.log('\nNothing measurable changed: no suite to run.'); process.exit(sel.uncovered.length ? 3 : 0); }
  names = sel.suites;
}
const plan = buildPlan(names);
const withOff = plan.cells.some((c) => c.off);
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
const VALIDITY = /^(ads-cleared|extension-active|theme-applied|quality-reached|hdr-stream)$|:(playing|preset-applied|visible|still-stable|ad-interrupted)$/;
const invalid = (r) => !r || r.schema !== 2 || r.checks.some((c) => !c.ok && VALIDITY.test(c.name));

// A stored run can stand in when it measured the same build with the same harness
// on the same display, and covered at least the presets, clips and stages wanted
// now (a run from a bigger suite serves a smaller one).
function cached(cell, round, label, ref, presets, clips) {
  const sha = resolveSha(ref);
  if (sha === 'WORKTREE' || args.aa) return false;
  const r = read(resultPath(cell.site, cell.theme, label, round));
  if (!r || r.sha !== sha || r.harness !== HARNESS || (r.windowPos || '') !== windowPos || sig(r.display) !== sig(startDisplay) || invalid(r)) return false;
  const wantLayout = cell.layout && round === 1 && ref !== 'NONE';
  return presets.every((p) => clips.every((c) => r.presets[p]?.clips[c])) && (!wantLayout || !!r['theater x8']);
}

let child = null;
const stop = (code) => { child?.kill('SIGTERM'); setTimeout(() => process.exit(code), 3000).unref(); };
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
const runOnce = (cmd) => new Promise((resolve) => {
  child = spawn(process.execPath, [path.join(here, 'run.mjs'), ...cmd], { stdio: 'inherit' });
  child.on('exit', (code) => { child = null; resolve(code); });
});

async function one(cell, label, ref, round, presets, clips, layout) {
  const cmd = ['--site', cell.site, '--theme', cell.theme, '--ref', ref, '--label', label, '--round', String(round), '--presets', presets.join(','), '--clips', clips.join(','), '--out', out];
  if (layout) cmd.push('--layout');
  if (windowPos) cmd.push('--window', windowPos);
  for (const k of ['launch', 'idle']) if (args[k] !== undefined) cmd.push('--' + k, args[k]);
  if (args['expect-hdr']) cmd.push('--expect-hdr'); // every site, so they share one colour pipeline; only yt4k asserts an HDR stream
  for (let attempt = 1; attempt <= 2; attempt++) {
    driftGuard();
    if (fs.existsSync(pauseFile(out))) { console.log(`\nPAUSE file found: stopping before ${cell.site}/${cell.theme}/${label}/${round}. Remove ${pauseFile(out)} and rerun to resume.`); process.exit(0); }
    const t = Date.now();
    const code = await runOnce(cmd);
    const r = read(resultPath(cell.site, cell.theme, label, round));
    if (code === 0 && !invalid(r)) return console.log(`  ${((Date.now() - t) / 60000).toFixed(1)} min`);
    console.log(`  attempt ${attempt} ${code === 0 ? 'had invalid checks' : 'crashed'}${attempt === 1 ? ', retrying once' : ''}`);
  }
}

// ---- show the plan, then run it ------------------------------------------------
const baseCachedEverywhere = plan.cells.every((c) => cached(c, 1, 'base', BASE, c.presets, c.clips));
console.log(`\nsuites: ${names.join(', ')}   harness ${HARNESS}   base=${BASE} (${baseSha.slice(0, 7)}) cand=${args.aa ? BASE + ' (A/A)' : CAND}`);
for (const c of plan.cells) console.log(`  ${`${c.site}/${c.theme}`.padEnd(12)} presets ${c.presets.join(',')}  clips ${c.clips.join(',')}${c.layout ? '  +layout/SPA' : ''}${c.off ? '  +control' : ''}`);
console.log(`  rounds ${plan.rounds}; estimated ~${estimate(plan, { baseCached: baseCachedEverywhere }).toFixed(0)} min${baseCachedEverywhere ? ' (baseline cached)' : ''}`);
console.log(`test display: ${windowPos ? displayLabel(startDisplay) : 'window placement not pinned (use --window x,y)'}\n`);
if (args.dry) process.exit(0); // --dry: show the plan and the estimate, run nothing
fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ names, base: BASE, cand: CAND, harness: HARNESS, ...plan, presetsFor: undefined }, null, 1));

// The candidate always reruns, so its old results are never valid: clear them, or
// compare.mjs would mix this run's candidate with a stale one from another plan.
// (When resuming, the earlier cells' candidates are kept; stale ones are re-measured at the end.)
if (!state) for (const f of fs.readdirSync(out)) if (/^(result|still)-.*-cand-/.test(f)) fs.rmSync(path.join(out, f));

const steps = [];
for (let round = 1; round <= plan.rounds; round++) for (const cell of plan.cells) { const ps = plan.presetsFor(cell, round); if (ps.length) steps.push({ round, cell, ps, layout: cell.layout && round === 1 }); }
const key = (st) => `${st.cell.site}/${st.cell.theme}`;
const offArgs = withOff ? ['--off', 'off'] : [];

async function measure(st, { candOnly = false } = {}) {
  const tag = `[round ${st.round}] ${key(st)}`;
  if (!candOnly) {
    if (cached(st.cell, st.round, 'base', BASE, st.ps, st.cell.clips)) console.log(`${tag}/base: cached ${baseSha.slice(0, 7)}`);
    else { console.log(`${tag}/base`); await one(st.cell, 'base', BASE, st.round, st.ps, st.cell.clips, st.layout); }
  }
  console.log(`${tag}/cand`);
  await one(st.cell, 'cand', CAND, st.round, st.ps, st.cell.clips, st.layout);
  if (st.cell.off && !candOnly) {
    if (cached(st.cell, st.round, 'off', 'NONE', ['default'], st.cell.clips)) console.log(`${tag}/off: cached`);
    else { console.log(`${tag}/off (no extension)`); await one(st.cell, 'off', 'NONE', st.round, ['default'], st.cell.clips, false); }
  }
}

// Debug mode: judge one cell now; on failure save where we are and stop.
function judgeOrStop(st, index) {
  const r = spawnSync(process.execPath, [path.join(here, 'compare.mjs'), out, '--base', 'base', '--cand', 'cand', '--only', key(st), '--expect', key(st), ...offArgs, ...(debugWarn ? ['--fail-on-warn'] : [])], { stdio: 'inherit' });
  if (r.status === 0) return;
  fs.writeFileSync(statePath, JSON.stringify({ args: savedArgs, names, stoppedAt: index, cell: key(st), round: st.round, build: buildFingerprint(CAND), at: new Date().toISOString() }, null, 1));
  console.log(`\nDEBUG: stopped at ${key(st)} (round ${st.round}, step ${index + 1} of ${steps.length}). Fix it, then continue from here with:\n  node tests/perf/suite.mjs --resume${args.out ? ' --out ' + out : ''}`);
  process.exit(1);
}

const from = state ? state.stoppedAt : 0;
if (state) console.log(`DEBUG: resuming at ${state.cell} (round ${state.round}), step ${from + 1} of ${steps.length}; stopped ${state.at}\n`);
for (let i = from; i < steps.length; i++) {
  await measure(steps[i]);
  if (debug) judgeOrStop(steps[i], i);
}

// Debug mode: candidates measured before the latest fix no longer describe the code.
if (debug) {
  const now = buildFingerprint(CAND);
  const stale = steps.map((st, i) => ({ st, i })).filter(({ st }) => read(resultPath(st.cell.site, st.cell.theme, 'cand', st.round))?.build !== now);
  if (stale.length) console.log(`\nDEBUG: re-measuring ${stale.length} cell(s) that passed on older code: ${stale.map(({ st }) => `${key(st)} r${st.round}`).join(', ')}`);
  for (const { st, i } of stale) { await measure(st, { candOnly: true }); judgeOrStop(st, i); }
  fs.rmSync(statePath, { force: true });
}

const expect = plan.cells.map((c) => `${c.site}/${c.theme}`).join(',');
const c = spawnSync(process.execPath, [path.join(here, 'compare.mjs'), out, '--base', 'base', '--cand', 'cand', '--expect', expect, ...offArgs], { stdio: 'inherit' });
process.exit(c.status ?? 1);
