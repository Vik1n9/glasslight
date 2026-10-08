# ani/light with the `state-current` harness (2026-10-08)

This is the re-run asked for in TODO.md → "PR #7 效能測試：待驗證":
`tests/perf/suite.mjs --base origin/main --cand HEAD` at `ed5203c`, using the harness from `faaca5d`. It ran as a full matrix without `--debug`, because debug mode stopped earlier at yt4k/light (see TODO).

Display 2560x1440 HDR, signed in, `caffeinate -d`. The harness closed the options page on every cand run (`strayPages`).

- `verdict-ani-light.txt`: `node tests/perf/compare.mjs <out> --only ani/light`
- `results/`: raw results for base, cand and off (no extension)
- `frames/`: the top 180 px of the `max-glass/ani-battle` frozen frames. Rows are, top to bottom, base, base after a fresh solve (`-fresh`), cand, and cand `-fresh` where one exists. Full-frame stills are not committed because they show signed-in pages.

## What it shows

| frame | base `state-current` | cand `state-current` | cand vs base (fresh where base was stale) |
|---|---|---|---|
| `max-glass/ani-battle/0@1201s` | **stale** (fresh solve Δ 5.71, 13.97 % px > 8) | ok | **FAIL** mean Δ 7.73, 5.79 % px > 24 |
| `max-glass/ani-battle/1@1205s` | ok | ok | pass |
| `max-glass/ani-battle/2@1209s` | **stale** (Δ 0.82, 3.30 %) | **stale** (Δ 0.82, 3.30 %: same numbers as base) | FAIL mean Δ 3.23 |
| the other 15 frames | ok | ok | pass |

- The stale-state defect on main is confirmed. In the frozen frame, base's legibility state is not what a fresh sample and solve gives.
- Frame 2 is stale on both sides with identical numbers. That looks like the same pre-existing defect, present unchanged in the PR. Under the harness rule it still counts as a cand FAIL.
- **Frame 0 is not explained by the stale state alone.** Cand still differs from base's fresh frame (Δ 7.73), and the difference is all in the top ~177 px (header and nav).
  - In this run the order is reversed from the first report. Base's own frame has the most legible nav. Base-fresh is less legible. Cand is the least legible: the right-hand nav items are barely visible.
  - Cand passes `state-current`, so a fresh solve gives cand that same faint state.
  - Neither branch of the TODO's reading rule fits ("base stale and comparison passes" / "base current but still DIFF"), so this goes back for analysis with these files.

## ani/dark (first time this cell was reached)

**PASS** (`verdict-ani-dark.txt`). `state-current` held on every frozen frame on both sides, so the stale state on main did not show up in the dark theme.

## Full matrix (both rounds, 54 min): final verdict

`verdicts.txt` holds the whole `compare.mjs` output; `results/` holds every cell. The verdict was **FAIL: 4 hard failures and 4 warnings**, all in round 1.

| cell | round 1 | round 2 (default preset) |
|---|---|---|
| yt/light | PASS | PASS |
| yt/dark | PASS | PASS |
| yt4k/light | FAIL: `solid-glow/yt4k-heavy/0@36s` mean Δ 2.25 (limit 2), 0 % px > 24 | PASS |
| yt4k/dark | PASS | PASS |
| ani/light | FAIL: see the table above (3 hard failures, 4 warnings) | PASS |
| ani/dark | PASS | PASS |

- `yt4k/light` Δ 2.25 came out with the same value in three measurements: the debug run, its `--resume`, and this run. It reproduces. It sits in the masthead only, and `state-current` held on both sides.
- **No RAM warnings anywhere in this run.** The earlier "RAM grew over the window (leak?)" on `max-glass/ani-battle` and the `yt/light/solid-glow` ×1.16 did not come back.
