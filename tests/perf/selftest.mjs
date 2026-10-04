// Tests the judge, not the extension: feeds compare.mjs hand-made results and
// checks that equal runs PASS while each kind of regression is caught by the
// gate that is supposed to catch it. No browser and no network, runs in a second:
//
//   node tests/perf/selftest.mjs
//
// Run it after touching THRESHOLDS or compare.mjs. The pixel-diff gate needs a
// browser and is covered by the A/A run instead (`suite.mjs --aa`).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const compare = path.join(path.dirname(fileURLToPath(import.meta.url)), 'compare.mjs');

function series({ lag = 2, amp = 1 }) {
  const vl = Array.from({ length: 300 }, (_, i) => 120 + 60 * Math.sin(i / 9) + 25 * Math.sin(i / 3.1));
  return vl.map((v, i) => ({ vt: 100 + i / 10, vl: v, amb: 128 + amp * (vl[Math.max(0, i - lag)] - 120), sa: 0, gl: 0 }));
}
function make(label, round, o = {}) {
  return {
    schema: 2, harness: o.harness || 'h1', site: 'yt', theme: 'light', label, ref: label, sha: label === 'base' ? 'aaaaaaa' : 'bbbbbbb', round: String(round), windowPos: '-1920,0',
    display: o.display || { w: 1920, h: 1080, scale: 2, hdr: false },
    ready: { w: 1920, h: 1080, stats: { res: '1920x1080@30', codecs: 'vp09.00 / opus' }, dark: false, canvases: 3 },
    checks: o.checks || [{ name: 'extension-active', ok: true, detail: '' }],
    presets: { default: { settings: { transparency: 50, intensity: 70, contrastTarget: 4.5 }, rootVars: {}, clips: { 'yt-lightshow': {
      cpu: { TaskDuration: 3.6 * (o.cpu || 1), ScriptDuration: 0.8, RecalcStyleDuration: 1.6, LayoutDuration: 0, LayoutCount: 1, RecalcStyleCount: 2000, longTasks: 0, longTaskMs: 0, frames: 576, dropped: o.dropped ?? 0 },
      series: series({ lag: o.lag ?? 2, amp: o.amp ?? 1 }), stills: [],
      sys: { cpuPct: { browser: 5, renderer: 40 * (o.sysCpu || 1), gpu: 30 * (o.gpuCpu || 1), other: 2, total: 77 + 40 * ((o.sysCpu || 1) - 1) + 30 * ((o.gpuCpu || 1) - 1) }, rssMB: { total: { mean: 1500 * (o.ram || 1), max: 1600 }, renderer: { mean: 900, max: 950 }, gpu: { mean: 400, max: 420 }, browser: { mean: 200 }, other: { mean: 0 } }, rssGrowthMB: { browser: 0, renderer: o.growth || 2, gpu: 0, other: 0 }, gpuUtil: { mean: 30 + (o.gpuUtil || 0), max: 50 } },
    } } } },
    state: o.state || { lgClear: 5, canvases: 3 },
    errs: [],
  };
}
function judge(name, cand, want) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-selftest-'));
  for (const r of [1, 2]) fs.writeFileSync(path.join(dir, `result-yt-light-base-${r}.json`), JSON.stringify(make('base', r)));
  for (const r of [1, 2]) fs.writeFileSync(path.join(dir, `result-yt-light-cand-${r}.json`), JSON.stringify(make('cand', r, cand)));
  const p = spawnSync(process.execPath, [compare, dir, '--base', 'base', '--cand', 'cand', '--no-visual'], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  const ok = p.status === want.status && want.text.every((t) => p.stdout.includes(t));
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`     wanted exit ${want.status} containing ${JSON.stringify(want.text)}; got exit ${p.status}\n${p.stdout.split('==== verdict ====')[1] || p.stdout.slice(-600)}`);
  return ok;
}

const results = [
  judge('identical runs pass', {}, { status: 0, text: ['\nPASS'] }),
  judge('more dropped frames fail', { dropped: 12 }, { status: 1, text: ['dropped frames'] }),
  judge('slower ambient follow fails', { lag: 6 }, { status: 1, text: ['ambient lag'] }),
  judge('flatter ambient swing fails', { amp: 0.5 }, { status: 1, text: ['flatter'] }),
  judge('failed check in candidate fails', { checks: [{ name: 'spa-navigation', ok: false, detail: 'layer duplicated' }] }, { status: 1, text: ['spa-navigation', 'layer duplicated'] }),
  judge('different element counts fail', { state: { lgClear: 4, canvases: 3 } }, { status: 1, text: ['element counts differ'] }),
  judge('30% more CPU warns, does not fail', { cpu: 1.3 }, { status: 0, text: ['WARN', 'main-thread time'] }),
  judge('5% more CPU is noise, passes', { cpu: 1.05 }, { status: 0, text: ['\nPASS'] }),
  judge('+25 points of CPU warns', { sysCpu: 1.6 }, { status: 0, text: ['total CPU'] }),
  judge('GPU-process CPU jump warns', { gpuCpu: 1.5 }, { status: 0, text: ['GPU-process CPU'] }),
  judge('+30% RAM warns', { ram: 1.3 }, { status: 0, text: ['RAM 1500'] }),
  judge('RAM growth warns (leak hint)', { growth: 300 }, { status: 0, text: ['leak?'] }),
  judge('+20 GPU util points warns', { gpuUtil: 20 }, { status: 0, text: ['GPU busy'] }),
  judge('baseline from another harness version fails', { harness: 'h2' }, { status: 1, text: ['rerun the baseline'] }),
  judge('RAM shrinking is not a leak', { growth: -150 }, { status: 0, text: ['\nPASS'] }),
  judge('different display warns', { display: { w: 2560, h: 1440, scale: 1, hdr: false } }, { status: 0, text: ['not comparable'] }),
];
const bad = results.filter((x) => !x).length;
console.log(bad ? `\n${bad} of ${results.length} self-tests failed` : `\nall ${results.length} self-tests passed`);
process.exit(bad ? 1 : 0);
