// What to run: the targeted suites (分項), the full suite, and which suites a
// changed file calls for. Kept apart from lib.mjs/run.mjs on purpose: editing a
// suite here changes what runs, not how it is measured, so it must not
// invalidate the cached baselines (those key on lib.mjs + run.mjs).
//
// A suite is a list of cells. A cell is one site x one theme with the settings
// presets and clips to measure there (clips omitted = all clips of the site),
// whether to add the layout-churn/SPA stage (YouTube light only makes sense) and
// whether to add a no-extension control run for the extension's own cost.
import { PRESETS, SITES } from './lib.mjs';

const ALL_PRESETS = Object.keys(PRESETS);

export const SUITES = {
  smoke: {
    what: 'Sanity check while developing: one clip, default settings, YouTube dark (the scrim is only active in dark there)',
    cells: [{ site: 'yt', theme: 'dark', presets: ['default'] }],
  },
  ambient: {
    what: 'Ambient light and halo (ambient.js): how fast and how fully they follow the video, and what they cost, including under 4K HDR load, against a no-extension control',
    cells: [
      { site: 'yt', theme: 'light', presets: ['default'] },
      { site: 'yt', theme: 'dark', presets: ['default', 'solid-glow'], off: true },
      { site: 'yt4k', theme: 'dark', presets: ['default'], off: true },
      { site: 'ani', theme: 'dark', presets: ['default'], clips: ['ani-battle'], off: true },
    ],
  },
  legibility: {
    what: 'Text legibility: the scrim and the contrast solver (contrast.js, the scrim in ambient.js), at the default and the weakest legibility setting, on bright and fast content in both themes',
    cells: [
      { site: 'yt', theme: 'dark', presets: ['default', 'max-glass'] },
      { site: 'ani', theme: 'light', presets: ['default', 'max-glass'], clips: ['ani-white'] },
      { site: 'ani', theme: 'dark', presets: ['default', 'max-glass'], clips: ['ani-white'] },
    ],
  },
  glass: {
    what: 'Glass surfaces and refraction (refract.js, glass.css): frozen frames at every transparency extreme, refraction maps, layout churn',
    cells: [
      { site: 'yt', theme: 'light', presets: ALL_PRESETS, layout: true },
      { site: 'yt', theme: 'dark', presets: ['max-glass', 'solid-glow'] },
      { site: 'ani', theme: 'dark', presets: ['default'], clips: ['ani-white'] },
    ],
  },
  youtube: {
    what: 'YouTube adapter (main.js): decoration, player controls, masthead, SPA navigation, layout churn',
    cells: [
      { site: 'yt', theme: 'light', presets: ['default'], layout: true },
      { site: 'yt', theme: 'dark', presets: ['default'] },
    ],
  },
  ani: {
    what: 'Bahamut adapter (ani-gamer.js, ani-gamer.css): both clips, both themes',
    cells: [
      { site: 'ani', theme: 'light', presets: ['default', 'max-glass'] },
      { site: 'ani', theme: 'dark', presets: ['default'] },
    ],
  },
  full: {
    what: 'Everything: every site x both themes x every preset, a no-extension control everywhere, layout churn once; a second round repeats the default settings to calibrate noise',
    cells: Object.keys(SITES).flatMap((site) => ['light', 'dark'].map((theme) => ({ site, theme, presets: ALL_PRESETS, off: true, layout: site === 'yt' && theme === 'light' }))),
    rounds: 2,
    laterRoundPresets: ['default'],
  },
};

// Which suites a changed file calls for. First match wins; a file that matches
// nothing is unknown territory and gets the full suite.
export const COVERAGE = [
  { test: /^src\/content\/(settings\.js)$|^manifest\.json$/, suites: ['full'], why: 'shared by every page and setting' },
  { test: /^src\/content\/ambient\.js$/, suites: ['ambient', 'legibility'], why: 'draws the ambient light and paints the scrim' },
  { test: /^src\/content\/contrast\.js$/, suites: ['legibility'], why: 'solves the scrim strength' },
  { test: /^src\/content\/refract\.js$/, suites: ['glass'], why: 'refraction on the glass bars' },
  { test: /^src\/styles\/glass\.css$/, suites: ['glass', 'legibility', 'ani'], why: 'base styles of both sites' },
  { test: /^src\/content\/main\.js$/, suites: ['youtube'], why: 'the YouTube entry point' },
  { test: /^src\/(content\/ani-gamer\.js|styles\/ani-gamer\.css)$/, suites: ['ani'], why: 'the Bahamut adapter' },
  { test: /^tests\/perf\//, suites: [], harness: true, why: 'the measuring code itself' },
  { test: /^src\/content\/dev-reload\.js$/, suites: [], why: 'development only; stripped from test and release builds' },
  { test: /^(_locales|icons|store|docs|scripts)\/|\.md$|^LICENSE$|^\.gitignore$/, suites: [], why: 'no runtime effect on the measured pages' },
  // Real code this harness does not reach: say so instead of pretending a suite covers it.
  { test: /^src\/(content\/thumbs\.js|background\.js)$/, suites: [], uncovered: 'thumbnail light on home / search / channel pages (the harness only plays watch pages)' },
  { test: /^src\/(content\/frame\.js|styles\/live-chat\.css)$/, suites: [], uncovered: 'the live-chat iframe (no live stream in the test clips)' },
  { test: /^src\/popup\//, suites: [], uncovered: 'the popup UI (the harness sets storage directly, it never opens the popup)' },
];

/** Map changed files to suites, with the reason for every file. */
export function selectSuites(files) {
  const picked = new Set(), notes = [], uncovered = [];
  let harness = false;
  for (const f of files) {
    const rule = COVERAGE.find((r) => r.test.test(f));
    if (!rule) { picked.add('full'); notes.push(`${f} → full (no rule for this file, so nothing can be ruled out)`); continue; }
    rule.suites.forEach((s) => picked.add(s));
    if (rule.harness) harness = true;
    if (rule.uncovered) uncovered.push(`${f}: ${rule.uncovered}`);
    notes.push(`${f} → ${rule.suites.length ? rule.suites.join(', ') : rule.uncovered ? 'not measurable here' : 'nothing to run'} (${rule.why || rule.uncovered})`);
  }
  // full already contains every other suite
  const suites = picked.has('full') ? ['full'] : [...picked];
  return { suites, notes, uncovered, harness };
}

/**
 * Merge suites into one plan: one entry per site x theme with the union of
 * presets and clips, layout/control if any suite asks. Rounds = the most any
 * suite asks for; rounds after the first only repeat `laterRoundPresets`.
 */
export function buildPlan(names) {
  const cells = new Map();
  let rounds = 1, later = null;
  for (const n of names) {
    const s = SUITES[n];
    if (!s) throw new Error(`unknown suite ${n}; have ${Object.keys(SUITES).join(', ')}`);
    rounds = Math.max(rounds, s.rounds || 1);
    if (s.laterRoundPresets) later = s.laterRoundPresets;
    for (const c of s.cells) {
      const k = `${c.site}/${c.theme}`;
      const cur = cells.get(k) || { site: c.site, theme: c.theme, presets: new Set(), clips: new Set(), allClips: false, layout: false, off: false };
      c.presets.forEach((p) => cur.presets.add(p));
      if (c.clips) c.clips.forEach((x) => cur.clips.add(x));
      else cur.allClips = true;
      cur.layout ||= !!c.layout;
      cur.off ||= !!c.off;
      cells.set(k, cur);
    }
  }
  const order = (a, b) => Object.keys(SITES).indexOf(a.site) - Object.keys(SITES).indexOf(b.site) || a.theme.localeCompare(b.theme) * -1;
  return {
    rounds,
    cells: [...cells.values()].sort(order).map((c) => ({
      site: c.site,
      theme: c.theme,
      presets: ALL_PRESETS.filter((p) => c.presets.has(p)),
      clips: c.allClips ? SITES[c.site].clips.map((x) => x.name) : SITES[c.site].clips.map((x) => x.name).filter((x) => c.clips.has(x)),
      layout: c.layout,
      off: c.off,
    })),
    presetsFor: (cell, round) => (round > 1 && later ? cell.presets.filter((p) => later.includes(p)) : cell.presets),
  };
}

// Wall-time model, from measured runs (run.mjs timings): page load + ads per
// run, one preset x clip (apply, CPU pass, response pass, three stills), one
// control clip (CPU pass only), the layout/SPA stage.
const LOAD = { yt: 25, yt4k: 45, ani: 45 }, PRESET_CLIP = 42, CONTROL_CLIP = 16, LAYOUT = 55;
/** Estimated minutes for a plan; baseCached = the baseline (and controls) are already measured. */
export function estimate(plan, { baseCached = false } = {}) {
  let sec = 0;
  for (let round = 1; round <= plan.rounds; round++) {
    for (const c of plan.cells) {
      const ps = plan.presetsFor(c, round);
      if (!ps.length) continue;
      const one = LOAD[c.site] + ps.length * c.clips.length * PRESET_CLIP + (c.layout && round === 1 ? LAYOUT : 0);
      sec += one * (baseCached ? 1 : 2);
      if (c.off && !baseCached) sec += LOAD[c.site] + c.clips.length * CONTROL_CLIP;
    }
  }
  return sec / 60;
}
