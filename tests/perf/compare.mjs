// Judge the result-*.json files in a directory: tables for reading, gates for
// deciding. Exit code 1 when any hard gate fails.
//
//   node tests/perf/compare.mjs /tmp/lg-perf --base base --cand cand [--no-visual]
//
// Hard gates (FAIL): a failed check in the candidate, more dropped frames, a
// slower or flatter ambient response, different element counts, a frozen frame
// whose pixels moved. Soft gates (WARN): CPU and long tasks beyond the
// baseline's own round-to-round noise. Thresholds live in lib.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { CHROMIUM, THRESHOLDS as T, args, loadPlaywright } from './lib.mjs';

const dir = process.argv[2]?.startsWith('--') ? '/tmp/lg-perf' : process.argv[2] || '/tmp/lg-perf';
const BASE = args.base || 'base', CAND = args.cand || 'cand', OFF = args.off || null; // OFF: label of the no-extension control runs
const runs = fs.readdirSync(dir).filter((f) => /^result-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((r) => r.schema === 2);
if (!runs.length) throw new Error(`no schema-2 result-*.json in ${dir}`);

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const spread = (a) => { const m = median(a); return m && a.length > 1 ? (Math.max(...a) - Math.min(...a)) / m : 0; };
const f = (x) => (x == null ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(2));

// How the ambient picture follows the video: the shift (100 ms per sample) at
// which video luminance best correlates with the canvas, plus its swing.
function response(series) {
  const ok = series.filter((p) => p.vl != null && p.amb != null);
  if (ok.length < 20) return { lagMs: null, amp: null };
  const v = ok.map((p) => p.vl), a = ok.map((p) => p.amb);
  let best = -2, lag = 0;
  for (let k = 0; k <= 20; k++) {
    const x = v.slice(0, v.length - k), y = a.slice(k), mx = mean(x), my = mean(y);
    const c = mean(x.map((e, i) => (e - mx) * (y[i] - my))) / (std(x) * std(y) || 1);
    if (c > best) { best = c; lag = k; }
  }
  return { lagMs: lag * 100, amp: std(a) };
}

const sysCols = (y) => (y ? { 'cpu% all': f(y.cpuTotal), 'cpu% rend': f(y.cpuRenderer), 'cpu% gpu-proc': f(y.cpuGpu), 'ram MB': f(y.ram), 'ram Δ MB': f(y.growth), 'gpu util%': f(y.gpuUtil) } : {});
const verdicts = [];
const add = (level, where, msg) => verdicts.push({ level, where, msg });
const sites = [...new Set(runs.map((r) => r.site))];

// ---- frozen-frame pixel diff, done in a headless page so no image library is needed
async function pixelDiffs(pairs) {
  if (!pairs.length) return [];
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const page = await browser.newPage();
  const payload = pairs.map(([a, b]) => [fs.readFileSync(path.join(dir, a)).toString('base64'), fs.readFileSync(path.join(dir, b)).toString('base64')]);
  const res = await page.evaluate(async (items) => {
    const load = (b64) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + b64; });
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const out = [];
    for (const [a, b] of items) {
      const A = px(await load(a)), B = px(await load(b));
      if (A.length !== B.length) { out.push({ mean: 255, pct: 100 }); continue; }
      let sum = 0, over = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      const W = (await load(a)).width;
      for (let i = 0; i < A.length; i += 4) {
        const d = (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3;
        sum += d;
        if (d > 24) {
          over++;
          const px = (i / 4) % W, py = Math.floor(i / 4 / W);
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      }
      out.push({ mean: sum / (A.length / 4), pct: (100 * over) / (A.length / 4), box: over ? `${x0},${y0}–${x1},${y1}` : '' });
    }
    return out;
  }, payload);
  await browser.close();
  return res;
}

for (const site of sites) {
  for (const theme of [...new Set(runs.filter((r) => r.site === site).map((r) => r.theme))]) {
    const g = runs.filter((r) => r.site === site && r.theme === theme);
    const base = g.filter((r) => r.label === BASE), cand = g.filter((r) => r.label === CAND);
    const tag = `${site}/${theme}`;
    const rd = (cand[0] || base[0]).ready;
    console.log(`\n# ${tag}   ${rd?.w}x${rd?.h} · display ${(cand[0] || base[0]).display ? `${(cand[0] || base[0]).display.w}x${(cand[0] || base[0]).display.h}@${(cand[0] || base[0]).display.scale}x` : 'unpinned'}${rd?.stats ? ' · ' + rd.stats.res + ' · ' + rd.stats.codecs : ''}   base ${base.length} round(s) ${base[0]?.sha?.slice(0, 7) || '-'} · cand ${cand.length} round(s) ${cand[0]?.sha?.slice(0, 7) || '-'}`);
    // Numbers are only comparable when both sides saw the same display, picture and codec.
    const dispOf = (r) => (r.display ? `${r.display.w}x${r.display.h}@${r.display.scale}${r.display.hdr ? ' HDR' : ''}` : 'unpinned');
    const picOf = (r) => `${r.ready?.w}x${r.ready?.h} ${String(r.ready?.stats?.codecs || '').split(' ')[0]}`;
    if (base.length && cand.length) {
      if (dispOf(base[0]) !== dispOf(cand[0])) add('WARN', tag, `base ran on ${dispOf(base[0])}, cand on ${dispOf(cand[0])}: numbers are not comparable`);
      if (base[0].ready?.layout?.video !== cand[0].ready?.layout?.video) add('FAIL', tag, `the video sat at ${base[0].ready?.layout?.video} in base but ${cand[0].ready?.layout?.video} in cand: the page laid out differently, so frames and pixels are not comparable`);
      if (picOf(base[0]) !== picOf(cand[0])) add('WARN', tag, `base played ${picOf(base[0])}, cand ${picOf(cand[0])}: different stream, CPU and pixels are not comparable`);
    }
    if (!base.length || !cand.length) { add('FAIL', tag, `missing results (base ${base.length}, cand ${cand.length})`); continue; }

    // absolute checks
    for (const [who, rs] of [[CAND, cand], [BASE, base]]) {
      for (const r of rs) for (const c of r.checks.filter((c) => !c.ok)) add(who === CAND ? 'FAIL' : 'WARN', tag, `${who} r${r.round} check "${c.name}" failed: ${c.detail}${who === BASE ? ' (baseline already fails)' : ''}`);
    }

    // per preset / clip metrics
    for (const preset of Object.keys(cand[0].presets)) {
      for (const clip of Object.keys(cand[0].presets[preset].clips)) {
        const where = `${tag}/${preset}/${clip}`;
        const m = (rs) => {
          const cl = rs.map((r) => r.presets[preset]?.clips[clip]).filter(Boolean);
          const resp = cl.map((c) => response(c.series));
          return {
            n: cl.length,
            task: cl.map((c) => c.cpu.TaskDuration), script: median(cl.map((c) => c.cpu.ScriptDuration)), style: median(cl.map((c) => c.cpu.RecalcStyleDuration)),
            longMs: median(cl.map((c) => c.cpu.longTaskMs)), dropped: median(cl.map((c) => c.cpu.dropped)), frames: median(cl.map((c) => c.cpu.frames)),
            lag: median(resp.map((x) => x.lagMs)), amp: median(resp.map((x) => x.amp)),
            sys: (() => {
              const sy = cl.map((c) => c.sys).filter(Boolean);
              if (!sy.length) return null;
              const pick = (fn) => median(sy.map(fn));
              return {
                cpuTotal: pick((x) => x.cpuPct.total), cpuTotals: sy.map((x) => x.cpuPct.total), cpuRenderer: pick((x) => x.cpuPct.renderer), cpuGpu: pick((x) => x.cpuPct.gpu), cpuBrowser: pick((x) => x.cpuPct.browser),
                ram: pick((x) => x.rssMB.total.mean), ramRenderer: pick((x) => x.rssMB.renderer.mean), ramGpu: pick((x) => x.rssMB.gpu.mean),
                growth: pick((x) => x.rssGrowthMB.renderer + x.rssGrowthMB.gpu + x.rssGrowthMB.browser + x.rssGrowthMB.other),
                gpuUtil: pick((x) => x.gpuUtil?.mean ?? null),
              };
            })(),
            scrim: (() => { const s = cl.flatMap((c) => c.series.map((p) => p.sa).filter((x) => x != null)); return s.length ? `${f(Math.min(...s))}–${f(Math.max(...s))}` : '-'; })(),
          };
        };
        const b = m(base), c = m(cand);
        const s = cand[0].presets[preset].settings;
        console.log(`\n## ${where}   (transparency ${s.transparency}, intensity ${s.intensity}, contrast ${s.contrastTarget})`);
        console.table({
          [BASE]: { rounds: b.n, 'task s': f(median(b.task)), 'script s': f(b.script), 'style s': f(b.style), 'long ms': f(b.longMs), dropped: f(b.dropped), frames: f(b.frames), 'lag ms': f(b.lag), 'amb swing': f(b.amp), 'scrim α': b.scrim, ...sysCols(b.sys) },
          [CAND]: { rounds: c.n, 'task s': f(median(c.task)), 'script s': f(c.script), 'style s': f(c.style), 'long ms': f(c.longMs), dropped: f(c.dropped), frames: f(c.frames), 'lag ms': f(c.lag), 'amb swing': f(c.amp), 'scrim α': c.scrim, ...sysCols(c.sys) },
        });
        if (c.dropped > b.dropped + T.droppedSlack) add('FAIL', where, `dropped frames ${f(b.dropped)} → ${f(c.dropped)}`);
        if (c.lag != null && b.lag != null && c.lag > b.lag + T.lagMs) add('FAIL', where, `ambient lag ${b.lag} → ${c.lag} ms`);
        if (b.amp && c.amp != null && c.amp / b.amp < T.ambStdRatio) add('FAIL', where, `ambient swing ${f(b.amp)} → ${f(c.amp)} (flatter)`);
        const bt = median(b.task), ct = median(c.task), allow = Math.max(T.cpuRatio, 1 + 2 * spread(b.task));
        if (bt && ct / bt > allow) add('WARN', where, `main-thread time ${f(bt)} → ${f(ct)} s (×${(ct / bt).toFixed(2)}, allowed ×${allow.toFixed(2)})`);
        if (b.sys && c.sys) {
          const sp = spread(b.sys.cpuTotals) * (b.sys.cpuTotal || 0);
          if (c.sys.cpuTotal - b.sys.cpuTotal > Math.max(T.sysCpuPts, 2 * sp)) add('WARN', where, `total CPU ${f(b.sys.cpuTotal)} → ${f(c.sys.cpuTotal)} % of a core (renderer ${f(b.sys.cpuRenderer)} → ${f(c.sys.cpuRenderer)}, GPU process ${f(b.sys.cpuGpu)} → ${f(c.sys.cpuGpu)}, browser ${f(b.sys.cpuBrowser)} → ${f(c.sys.cpuBrowser)})`);
          if (c.sys.cpuGpu - b.sys.cpuGpu > T.gpuProcCpuPts) add('WARN', where, `GPU-process CPU ${f(b.sys.cpuGpu)} → ${f(c.sys.cpuGpu)} % of a core`);
          if (b.sys.gpuUtil != null && c.sys.gpuUtil != null && c.sys.gpuUtil - b.sys.gpuUtil > T.gpuUtilPts) add('WARN', where, `GPU busy ${f(b.sys.gpuUtil)} → ${f(c.sys.gpuUtil)} % (system-wide)`);
          if (b.sys.ram && c.sys.ram / b.sys.ram > T.ramRatio) add('WARN', where, `RAM ${f(b.sys.ram)} → ${f(c.sys.ram)} MB (×${(c.sys.ram / b.sys.ram).toFixed(2)})`);
          if (c.sys.growth - b.sys.growth > T.ramGrowthMB) add('WARN', where, `RAM grew ${f(b.sys.growth)} → ${f(c.sys.growth)} MB over the window (leak?)`);
          // the extension's own cost = this build minus the no-extension control on the same clip
          const offRuns = OFF ? g.filter((r) => r.label === OFF && r.presets[preset]?.clips[clip]) : [];
          if (offRuns.length) {
            const o = median(offRuns.map((r) => r.presets[preset].clips[clip].sys?.cpuPct.total)), oram = median(offRuns.map((r) => r.presets[preset].clips[clip].sys?.rssMB.total.mean)), ogpu = median(offRuns.map((r) => r.presets[preset].clips[clip].sys?.gpuUtil?.mean));
            const ob = b.sys.cpuTotal - o, oc = c.sys.cpuTotal - o;
            console.log(`   extension cost vs no-extension control: CPU ${f(ob)} → ${f(oc)} pts of a core · RAM ${f(b.sys.ram - oram)} → ${f(c.sys.ram - oram)} MB · GPU busy ${ogpu == null || b.sys.gpuUtil == null ? '-' : f(b.sys.gpuUtil - ogpu)} → ${ogpu == null || c.sys.gpuUtil == null ? '-' : f(c.sys.gpuUtil - ogpu)} pts   (control: ${f(o)} % CPU, ${f(oram)} MB)`);
            if (oc - ob > T.overheadPts) add('WARN', where, `the extension's own CPU cost rose ${f(ob)} → ${f(oc)} pts of a core`);
          }
        }
        if (c.longMs - b.longMs > T.longTaskMs) add('WARN', where, `long tasks ${f(b.longMs)} → ${f(c.longMs)} ms`);
      }
    }

    // layout churn + element counts (YouTube)
    for (const n of ['theater x8', 'scroll x10', 'resize x6']) {
      if (!cand[0][n] || !base[0][n]) continue;
      const bt = median(base.map((r) => r[n].TaskDuration)), ct = median(cand.map((r) => r[n].TaskDuration));
      console.log(`${n.padEnd(12)} task ${f(bt)} → ${f(ct)} s   layouts ${f(median(base.map((r) => r[n].LayoutCount)))} → ${f(median(cand.map((r) => r[n].LayoutCount)))}   style recalcs ${f(median(base.map((r) => r[n].RecalcStyleCount)))} → ${f(median(cand.map((r) => r[n].RecalcStyleCount)))}`);
      if (bt && ct / bt > Math.max(T.cpuRatio, 1 + 2 * spread(base.map((r) => r[n].TaskDuration)))) add('WARN', `${tag}/${n}`, `main-thread time ${f(bt)} → ${f(ct)} s`);
    }
    if (base[0].state && cand[0].state) {
      console.log('element counts', JSON.stringify(base[0].state), '→', JSON.stringify(cand[0].state));
      if (JSON.stringify(base[0].state) !== JSON.stringify(cand[0].state)) add('FAIL', tag, `element counts differ: ${JSON.stringify(base[0].state)} → ${JSON.stringify(cand[0].state)}`);
    }

    // frozen-frame comparison, self-calibrated by base-vs-base when two rounds exist
    if (!args['no-visual']) {
      const stills = (r) => Object.fromEntries(Object.values(r.presets).flatMap((p) => Object.values(p.clips).flatMap((c) => c.stills.filter((s) => s.stable !== false).map((s) => [s.key, s.file]))));
      const pairs = [], meta = [];
      for (const cr of cand) {
        const br = base.find((r) => r.round === cr.round);
        if (!br) continue;
        const bs = stills(br), cs = stills(cr);
        for (const k of Object.keys(cs)) if (bs[k]) { pairs.push([bs[k], cs[k]]); meta.push({ k, kind: 'cand' }); }
      }
      if (base.length > 1) {
        const a = stills(base[0]), b2 = stills(base[1]);
        for (const k of Object.keys(a)) if (b2[k]) { pairs.push([a[k], b2[k]]); meta.push({ k, kind: 'noise' }); }
      }
      // stills that never settled: show where their two shots differ
      const unstable = g.flatMap((r) => Object.values(r.presets).flatMap((p) => Object.values(p.clips).flatMap((c) => c.stills.filter((st) => st.pair).map((st) => ({ r, st })))));
      if (unstable.length) {
        const ud = await pixelDiffs(unstable.map((u) => u.st.pair));
        console.log('\nunstable stills (two shots 700 ms apart):');
        console.table(Object.fromEntries(unstable.map((u, i) => [`${u.r.label} r${u.r.round} ${u.st.key}`, { 'mean Δ': f(ud[i].mean), '% >24': f(ud[i].pct), 'where x,y': ud[i].box }])));
      }
      const res = await pixelDiffs(pairs);
      const noise = Object.fromEntries(meta.map((x, i) => [x.k, res[i]]).filter((_, i) => meta[i].kind === 'noise'));
      const rows = {};
      meta.forEach((x, i) => {
        if (x.kind !== 'cand') return;
        const n = noise[x.k], tm = Math.max(T.visualMean, n ? 1.5 * n.mean : 0), tp = Math.max(T.visualPct, n ? 1.5 * n.pct : 0);
        const bad = res[i].mean > tm || res[i].pct > tp;
        rows[x.k] = { 'mean Δ': f(res[i].mean), '% >24': f(res[i].pct), 'where x,y': res[i].box, 'noise mean Δ': n ? f(n.mean) : '-', verdict: bad ? 'DIFF' : 'same' };
        if (bad) add('FAIL', `${tag}/${x.k}`, `frozen frame differs: mean Δ ${f(res[i].mean)} (limit ${f(tm)}), ${f(res[i].pct)}% pixels > 24 (limit ${f(tp)})`);
      });
      if (Object.keys(rows).length) { console.log('\nfrozen frames, base vs cand:'); console.table(rows); }
    }
  }
}

if (args.timings) { // where the wall time went, to guide the next round of speed-ups
  console.log('\n==== timings (seconds) ====');
  console.table(Object.fromEntries(runs.filter((r) => r.timings).map((r) => [`${r.site}/${r.theme}/${r.label}/r${r.round}`, { total: (new Date(r.finishedAt) - new Date(r.startedAt)) / 1000 | 0, ...r.timings }])));
}
console.log('\n==== verdict ====');
for (const v of verdicts) console.log(`${v.level.padEnd(4)} ${v.where}: ${v.msg}`);
const fails = verdicts.filter((v) => v.level === 'FAIL').length, warns = verdicts.filter((v) => v.level === 'WARN').length;
console.log(fails ? `FAIL — ${fails} hard failure(s), ${warns} warning(s)` : warns ? `PASS with ${warns} warning(s)` : 'PASS');
process.exit(fails ? 1 : 0);
