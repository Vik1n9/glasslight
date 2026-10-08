# Full matrix on the scrim fix `5bdde36` (2026-10-08)

This is the re-run asked for in TODO.md: "用修正後的程式與 harness 再跑一次完整矩陣". It was started from `5bdde36` with

`caffeinate -d -i -u node tests/perf/suite.mjs --base origin/main --cand HEAD --window 0,0`

The run was non-debug, both rounds, 63.9 min (base 32.1, cand 31.9). Display 2560x1440 HDR, signed in.

- **Harness fingerprint** `f71efff1c3`, the version from `5bdde36`, on every result. The base cache was rebuilt.
- **Base** is `origin/main` = `d78a2e4`.
- **Cand** records `8ccae45` on every result: a TODO-only commit pushed just after the run started. `git diff 5bdde36 8ccae45 -- src tests manifest.json _locales` is empty, so the code measured is `5bdde36`.
- The harness closed the options page on every cand run (`strayPages`).

The pre-fix run is kept separately in `../2026-10-08-pr7-state-current/`.

- `verdicts.txt`: full `compare.mjs` output
- `results/`: every result JSON, 24 base/cand plus the controls
- `frames/`: the top 180 px of the 動畫瘋 frames below. Rows are, top to bottom, base, base `-fresh` where base was stale, and cand. YouTube stills are not committed because they show a signed-in masthead.

## Verdict: FAIL, 4 hard failures, 4 warnings

| cell | round 1 | round 2 (default) |
|---|---|---|
| yt/light | PASS | PASS |
| yt/dark | PASS | PASS |
| yt4k/light | PASS (the old `solid-glow/0` Δ 2.25 is now **0.22**) | FAIL `default/yt4k-heavy/1@40s` Δ 2.15 (limit 2), 0 % > 24; noise 1.11; `--lg-glass-live 0.60 → 0.58` |
| yt4k/dark | PASS | PASS |
| ani/light | FAIL, 2 new frames (below); 4 WARN for main's stale state | PASS |
| ani/dark | PASS | FAIL `default/ani-white/0@1038s` Δ 2.32 (limit 2.08), 0 % > 24; noise 1.39; `--lg-tint-rgb 128 104 104 → 128 112 112` |

## The four questions

**1. Is cand's frozen state current everywhere?** Yes. All 24 cand results have zero `state-current` failures. Before the fix, cand was stale on `ani/light/max-glass/ani-battle/2`.

**2. Do the two 動畫瘋 frames pass now?** Yes.

| `ani/light/max-glass/ani-battle` | before the fix (cand vs base-fresh) | `5bdde36` |
|---|---|---|
| 0@1201s | FAIL Δ 7.73 | **same, Δ 0.32** |
| 2@1209s | FAIL Δ 3.23, cand also stale | **same, Δ 0.44**, cand current |

Base (main, unfixed) is still stale on both: Δ 8.27 and 6.25. The harness now ticks base until it converges. These four WARNs are expected until main is fixed.

**3. What was the yt4k Δ 2.25?** It is gone: `yt4k/light/solid-glow/yt4k-heavy/0@36s` is now Δ 0.22 (same). This run has no live-value diff for it, because the frame no longer differs. Since only the scrim fix changed, it was most likely the same half-relaxed scrim. That is an inference: before the fix, both sides passed `state-current` with the old 1-tick check.

**4. New warnings or failures?** No RAM, CPU or GPU warnings at all. There are 4 hard failures, each naming a live value:

| frame | Δ (limit) | > 24 px | live values that differ (base → cand) |
|---|---|---|---|
| `ani/light/max-glass/ani-battle/1@1205s` r1 | 2.16 (2) | 0 % | `--lg-glass-live 0.16 → 0.20` |
| `ani/light/solid-glow/ani-battle/2@1209s` r1 | 3.46 (2) | **4.59 %** (3), region 0,0–648,85 | `--lg-glass-live 0.32 → 0.00`, `--lg-tint-rgb 120 32 8 → 112 32 8` |
| `yt4k/light/default/yt4k-heavy/1@40s` r2 | 2.15 (2) | 0 % | `--lg-glass-live 0.60 → 0.58` |
| `ani/dark/default/ani-white/0@1038s` r2 | 2.32 (2.08) | 0 % | `--lg-tint-rgb 128 104 104 → 128 112 112` |

- Three of them are just over the limit, with 0 % > 24. Two of those are in round 2, where the noise estimate is 1.1–1.4.
- **`solid-glow/ani-battle/2` is the clear one.** Cand's `--lg-glass-live` is 0.00 where base has 0.32, and 4.59 % of pixels in the header's left half differ by more than 24.
- Base passed `state-current` on all four frames, so none of them is main's staleness.
- A candidate cause, **not verified**: the fix relaxes the tint and the scrim 50 % a tick over a still picture, where it used to be 15 %. That could leave `--lg-glass-live` and the tint quantisation in a different place than main's slower, timing-dependent stop.
