## Local perf run: `tests/perf/suite.mjs --debug --base origin/main --cand HEAD` (22fe5fc vs d78a2e4)

Display 2560x1440 HDR, logged in on YouTube and 動畫瘋, `--window 0,0`, wrapped in `caffeinate -d`.

### Harness change needed first: the welcome tab

The new `onInstalled` handler opens the options page on first install. The harness starts every run with a fresh profile, so every cand run has an extra page (`Glasslight 設定`) in its own window, and base runs never do.

That extra renderer is counted as cand cost. With the options page closed by the harness, the ×1.2 RAM warnings on all six 動畫瘋 presets went away. "Extension cost vs no-extension control" on `default/ani-white` went from 246 → 471 MB to 399 → 478 MB.

The harness fix I used locally, in `tests/perf/run.mjs`:

- Identify the test page by the `targetId` of the target the harness created, not by URL. The options page can still be on `about:blank` at that point.
- Close every other page, and `await` the closes before `ctx.addInitScript`. Otherwise addInitScript fails on a page that is closing.
- Keep a `ctx.on('page')` handler that closes any page opening later.
- Record what was closed in `result.strayPages`. Base runs record `[]`; cand runs record the options page.

The product behaviour, opening the options page once per real install, is fine.

### Results with the harness fix

| cell | verdict |
|---|---|
| yt/light | PASS, 1 warning: `solid-glow` RAM ×1.16 |
| yt/dark, yt4k/light, yt4k/dark | PASS |
| ani/light | FAIL (see below) |
| ani/dark, round 2 | not reached; debug mode stops at ani/light |

### ani/light: a real difference on `max-glass/ani-battle`, not caused by the welcome tab

I measured four cand runs; two of them were with the options page closed.

| cand run | frame 0 @1201s | RAM growth warning |
|---|---|---|
| 1 (no isolation) | DIFF, mean Δ 31.48, 43.9 % px > 24 | yes, 0.41 → 257 MB |
| 2 (no isolation, `--resume`) | DIFF, Δ 30.94 | no |
| 3 (isolated) | same | no |
| 4 (isolated, `--resume`) | DIFF, Δ 31.01, 44.3 % | yes, 40.75 → 232 MB "leak?" |

- The difference is confined to the top ~177 px, the ambient light behind 動畫瘋's header and nav. The player and the picture are identical (Δ ≈ 0), so the reflection under the player is not what differs.
- Frame 0 is just after a scene cut. Base (measured twice) still shows the previous scene's dark light there, so the nav text on the right is barely legible. In cand runs 1, 2 and 4, the light has already followed the new scene.
  - So in `max-glass` (transparency 100, intensity 100, contrast 1.5), cand's light settles after a cut at a different rate from base.
  - Is that intended? If it is, the frozen-frame check needs a settle time after cuts for this clip, or a different capture point.
- Frames 1 and 2 (+4 s, +8 s) differ only slightly (Δ 2.14 / 2.34 against a limit of 2) in the same header area.
- The "RAM grew over the window (leak?)" warning on `max-glass/ani-battle` shows up in 2 of 4 cand runs, including one with isolation, and never on base. Worth a look: something in the max-glass path holding frames on a busy clip?

### Running the harness unattended

When nobody is at the machine, the display sleeps after `displaysleep` minutes. Chromium then stops rendering, and the 動畫瘋 cells stall: one cell sat for 2 h in `waitPlayable`. `caffeinate -d` fixes it. Consider having `suite.mjs` hold a display-sleep assertion itself.

### Still not checked
- Thumbnail light (home, search and channel pages) and the popup UI. The harness does not cover them.
- ani/dark and round 2, not reached.

### Files in this folder

- `verdicts.txt` is the full output of `node tests/perf/compare.mjs` on the isolated run: every cell measured before debug mode stopped at ani/light. It covers round 1 of yt/light, yt/dark, yt4k/light, yt4k/dark and ani/light, with ani/light's cand from run 4.
- `results/` holds the raw result JSON per cell and label (`base`, `cand`, `off` = no-extension control) and `plan.json`. `strayPages` in each result lists the pages the harness closed.
- `frames/` has the top 180 px of the `max-glass/ani-battle` frozen frames 0 and 1, with base on top and cand below. Full-frame stills are not committed: they are screenshots of signed-in pages.

To re-run: `caffeinate -d -i -u node tests/perf/suite.mjs --debug --base origin/main --cand HEAD --window 0,0`
