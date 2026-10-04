// Summarise the result-*.json files that run.mjs left in a directory:
//   node tests/perf/compare.mjs /tmp/lg-perf
// Prints, per site and clip, the median of every label across rounds. The
// first round of a fresh profile is cold; judge on rounds ≥ 2 when they differ.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || '/tmp/lg-perf';
const runs = fs.readdirSync(dir).filter((f) => /^result-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
if (!runs.length) throw new Error(`no result-*.json in ${dir}`);

const median = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const fmt = (x) => (x == null ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(3));

// How fast the ambient picture follows the video: the sample shift (100 ms
// each) at which the video luminance best correlates with the canvas.
function response(series) {
  const ok = series.filter((p) => p.vl != null && p.amb != null);
  if (ok.length < 20) return { lagMs: null, amp: null, maxStep: null };
  const v = ok.map((p) => p.vl), a = ok.map((p) => p.amb);
  let best = -2, lag = 0;
  for (let k = 0; k <= 20; k++) {
    const x = v.slice(0, v.length - k), y = a.slice(k);
    const mx = mean(x), my = mean(y);
    const c = mean(x.map((e, i) => (e - mx) * (y[i] - my))) / (std(x) * std(y) || 1);
    if (c > best) { best = c; lag = k; }
  }
  return { lagMs: lag * 100, corr: best, amp: std(a), maxStep: Math.max(...a.slice(1).map((e, i) => Math.abs(e - a[i]))) };
}

const labels = [...new Set(runs.map((r) => r.label))];
for (const site of [...new Set(runs.map((r) => r.site))]) {
  const siteRuns = runs.filter((r) => r.site === site);
  for (const clip of Object.keys(siteRuns[0].clips)) {
    console.log(`\n## ${site} / ${clip}`);
    const rows = {};
    for (const l of labels) {
      const rs = siteRuns.filter((r) => r.label === l && r.clips[clip]);
      if (!rs.length) continue;
      const cpu = rs.map((r) => r.clips[clip].cpu), resp = rs.map((r) => response(r.clips[clip].series));
      const sa = rs.flatMap((r) => r.clips[clip].series.map((p) => p.sa).filter((x) => x != null));
      rows[l] = {
        rounds: rs.length,
        ...Object.fromEntries(['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'RecalcStyleCount', 'longTasks', 'dropped'].map((k) => [k, median(cpu.map((c) => c[k]))])),
        lagMs: median(resp.map((x) => x.lagMs)), ambStd: median(resp.map((x) => x.amp)), ambMaxStep: median(resp.map((x) => x.maxStep)),
        scrimMin: sa.length ? Math.min(...sa) : null, scrimMax: sa.length ? Math.max(...sa) : null,
      };
    }
    console.table(Object.fromEntries(Object.entries(rows).map(([l, r]) => [l, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fmt(v)]))])));
  }
  const ui = ['theater x8', 'scroll x10', 'resize x6'].filter((n) => siteRuns[0][n]);
  if (ui.length) {
    console.log(`\n## ${site} / layout churn (median TaskDuration s, LayoutCount, RecalcStyleCount)`);
    for (const n of ui) console.log(n.padEnd(12), labels.map((l) => { const rs = siteRuns.filter((r) => r.label === l); return `${l}: ${fmt(median(rs.map((r) => r[n].TaskDuration)))}s ${fmt(median(rs.map((r) => r[n].LayoutCount)))} ${fmt(median(rs.map((r) => r[n].RecalcStyleCount)))}`; }).join('   '));
    console.log('state'.padEnd(12), labels.map((l) => `${l}: ${JSON.stringify(siteRuns.find((r) => r.label === l)?.state)}`).join('\n' + ' '.repeat(12)));
  }
}
