# Full matrix with converged frozen frames (`5cc21d3` harness, 2026-10-09)

This is the re-run asked for in TODO.md: "用「一律收斂」的 harness 再跑一次完整矩陣". It ran from `e13a599`, a TODO-only commit pushed **before** the run, so HEAD did not move during it. Its code is identical to `5cc21d3`, the converged-frame harness, which runs on the scrim fix `5bdde36`.

`caffeinate -d -i -u node tests/perf/suite.mjs --base origin/main --cand HEAD --window 0,0`

The run was non-debug, both rounds, 63.5 min. Display 2560x1440 HDR, signed in.

- Every result records the same versions: base `d78a2e4`, cand `e13a599`, harness `f5a190b51d`.
- The harness closed the options page on every cand run.
- Earlier runs are kept for comparison: `../2026-10-08-pr7-state-current/` (pre-fix) and `../2026-10-08-pr7-scrim-fix/` (fix, old harness).

## Verdict: FAIL, 1 hard failure, 5 warnings

| cell | round 1 | round 2 (default) |
|---|---|---|
| yt/light | PASS | PASS |
| yt/dark | PASS | PASS |
| yt4k/light | PASS | PASS |
| yt4k/dark | PASS | PASS |
| ani/light | PASS, with 4 expected WARN: main's stale state | PASS |
| ani/dark | **FAIL** `default/ani-white/0@1038s`; WARN RAM ×1.17 on `solid-glow/ani-battle` | PASS |

- **Cand `state-current`:** stale on 0 of 24 results. Only base `ani/light` round 1 is stale, on max-glass/ani-battle 0 and 2 (Δ 8.21 / 6.50): main is unfixed, so that is expected.

## TODO checks

**1. Do the three unconverged-base failures pass now?** Yes, all three.

| frame | scrim-fix run (old harness) | this run |
|---|---|---|
| `ani/light/solid-glow/ani-battle/2` r1 | FAIL Δ 3.46, 4.59 % > 24 | **same, Δ 0.56** |
| `ani/light/max-glass/ani-battle/1` r1 | FAIL Δ 2.16 | **same, Δ 1.23** |
| `yt4k/light/default/yt4k-heavy/1` r2 | FAIL Δ 2.15 | **same, Δ 1.21** |

The two original targets still pass: `max-glass/ani-battle/0` is Δ 0.23 and `/2` is Δ 0.44.

**2. `ani/dark/default/ani-white/0`: does it still fail by one `--lg-tint-rgb` step?** Yes in round 1, no in round 2.

| run | round 1 | round 2 |
|---|---|---|
| scrim-fix (`5bdde36`, old harness) | same | FAIL Δ 2.32, `--lg-tint-rgb 128 104 104 → 128 112 112` |
| this run (converged) | **FAIL Δ 2.32**, same tint step, 0 % > 24 | same, Δ 1.07 |

- The Δ and the tint step are identical whenever it fails. It fails in one round out of two in each run, and never in the same round.
- Both sides are converged here, so this is not stale-state timing.
- One reading fits: the dominant colour sits right at a /8 quantisation boundary, and the reflection, or tiny sampling differences between loads, sometimes tips it across. That matches the TODO's hysteresis idea. It is an inference, not verified.
- `frames/ani-dark-default-ani-white-0-r1-header-base-cand.png` shows the round-1 pair.

**New warning:** `ani/dark/solid-glow/ani-battle` RAM 2809.93 → 3299.86 MB (×1.17), a soft limit. It did not appear in the scrim-fix run. The earlier `max-glass/ani-battle` "leak?" warning did not appear either.

- `verdicts.txt`: full `compare.mjs` output
- `results/`: every result JSON and `plan.json`
- `frames/`: the top 180 px of the 動畫瘋 frames named above. Rows are, top to bottom, base, base `-fresh` where one was kept, and cand. YouTube stills are not committed because they show a signed-in masthead.
