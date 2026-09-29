# Glasslight for YouTube™

Chromium extension (MV3) that gives YouTube™ a frosted, refractive glass
interface — inspired by the glass design language Apple presented at WWDC25 —
with page-wide ambient light driven by the playing video, while keeping text
legible.

> Glasslight is an independent project. It is not affiliated with, endorsed
> by, or sponsored by Apple Inc., Google LLC, or YouTube.

## What it does

| Layer (WWDC25 guidance) | YouTube | Treatment |
|---|---|---|
| Background | whole page | `#lg-ambient`: video frames (or the hovered / centred thumbnail) blurred over the viewport, plus a glow behind the player |
| Content | videos, description, comments, panels | no glass — fills and transparency |
| Navigation | masthead, chip bar, menus, drawer | Regular glass: frost + refraction + specular rim + adaptive shadow |
| Over media | player controls, Shorts actions | Clear glass, 35% dimming layer over bright footage |

**Legibility.** Text is never made translucent. Every 250 ms `contrast.js`
solves the smallest scrim alpha that keeps the *worst* sampled pixel at the
target WCAG contrast (default 4.5:1) against the weakest text colour, and does
the same for the navigation glass tint over the player glow. Secondary text is
raised (vibrancy) so the light can stay brighter at equal contrast.

## Languages

Traditional Chinese, Simplified Chinese, English, Spanish, Japanese and
Korean (`_locales/`). By default the popup follows the browser language
(English as fallback); a Language menu in the popup overrides it. The
extension's name and store description always follow the browser language —
Chrome offers no way to change those at runtime.

## Install (development)

1. `chrome://extensions` → Developer mode → **Load unpacked** → this folder.
2. Unpacked installs auto-reload: edit any file and the extension and open
   YouTube tabs reload within ~2 s (`src/content/dev-reload.js`).

## Release build

`python3 scripts/build.py` → `dist/glasslight-<version>.zip`, ready for the
Chrome Web Store. It drops the dev auto-reload and checks that every file the
manifest references exists, locales share one key set, and descriptions fit
Chrome's 132-character limit. Store texts, privacy answers and assets live in
`store/` (`store/listing.md`); the privacy policy is [PRIVACY.md](PRIVACY.md).

## Layout

```
src/content/settings.js   shared namespace + chrome.storage.sync settings
src/content/contrast.js   WCAG luminance/contrast, scrim solver, dominant colour
src/content/refract.js    SVG displacement maps (SDF of a rounded rect) as backdrop-filter
src/content/ambient.js    video → canvas light, glow, letterbox/DRM detection, CSS vars
src/content/thumbs.js     thumbnail colour for browse pages (via the service worker)
src/content/main.js       routing (yt-navigate-finish), decoration, pointer highlight
src/styles/glass.css      all visual rules, scoped to html.lg-on
src/background.js         thumbnail fetch/downsample, dev reload
src/popup/                settings UI
```

## Notes

- Chromium drops CSS filter functions after a `url()` in `backdrop-filter`,
  so refracting surfaces do blur → displace → saturate inside the SVG filter.
- Performance: live values that change every 250 ms are never written to
  `<html>` (an inherited custom property there restyles all of YouTube, and a
  layout read after it forces that synchronously, ~50 ms). Light-layer values
  sit on `#lg-ambient`; glass tint lives in one rule matching only glass
  elements. Frame analysis scales on a GPU canvas before any CPU readback.
- Refraction is Chromium-only; with it off (or in performance mode) glass
  falls back to `blur() saturate()`.
- Honours `prefers-reduced-transparency`, `prefers-contrast: more`,
  `prefers-reduced-motion`, plus in-popup Reduce Transparency / Performance.

## Credits

- [WesselKroos/youtube-ambilight](https://github.com/WesselKroos/youtube-ambilight) (MIT) —
  frame scheduling with `requestVideoFrameCallback`, letterbox detection, hidden-tab pausing.
- [g6vz6mj4fr-oss/-glass-youtube](https://github.com/g6vz6mj4fr-oss/-glass-youtube) (MIT) —
  YouTube selectors; real blur only on a few surfaces for performance.
- [theysap/GlassTube](https://github.com/theysap/GlassTube) (MIT) — Reduce Transparency option.
- [kube.io — Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css-svg/) and
  [sven1577/liquid-glass](https://github.com/sven1577/liquid-glass) — SVG displacement refraction.
- Apple's WWDC25 session "Meet Liquid Glass" — design reference for layering, variants,
  dimming and accessibility; no Apple assets are used.

## License

MIT — see [LICENSE](LICENSE).

## Trademarks

YouTube, Chrome and Chromium are trademarks of Google LLC. Apple is a
trademark of Apple Inc., and "Liquid Glass" is Apple's name for its design
material. These names are used only to describe compatibility and design
references; this project is not affiliated with or endorsed by any of these
companies. The icon and all code are original to this project.
