# Chrome Web Store submission — Glasslight for YouTube™ 1.0.0

Everything the Developer Dashboard asks for, ready to paste.
Package: `python3 scripts/build.py` → `dist/glasslight-1.0.0.zip`.

## Store listing

- **Name:** Glasslight for YouTube™ (from `_locales/*/messages.json`)
- **Summary:** from the manifest description, localized in 6 languages (≤132 chars)
- **Category:** Functionality & UI (Make Chrome Yours)
- **Listing language:** English only (description and screenshots are in English; the extension UI itself ships in 6 languages).
- **Icon:** `icons/icon-128.png` (96×96 artwork, 16 px transparent padding)
- **Screenshots (1280×800):** `store/screenshots/*.png`
- **Small promo tile (440×280, required):** `store/promo-small-440x280.png`
- **Marquee (1400×560, optional):** `store/promo-marquee-1400x560.png`
- **Homepage / support URL:** https://github.com/Vik1n9/glasslight

### Detailed description — English

Glasslight turns YouTube into a calm, glass-like space lit by what you are watching.

• Page-wide ambient light — colours from the playing video flow across the whole page, with a soft glow radiating from behind the player. When nothing is playing, the light follows the thumbnail you hover.
• Frosted, refractive glass — the top bar, category bar, menus and player controls become floating glass with gentle refraction, a light-catching rim and adaptive shadows.
• Text always stays readable — the extension measures the light behind the page several times a second and keeps text contrast at the WCAG 4.5:1 level you choose. Bright or dark footage, light or dark theme.
• Works across YouTube — watch pages, theater mode, Shorts, channels, search, playlists, live chat and the miniplayer.
• Also on Bahamut Anime Crazy (ani.gamer.com.tw) — ambient light from the playing episode, glass top bars, menus and player controls.
• Accessibility — honours Reduce Transparency, Increase Contrast and Reduce Motion, with a performance mode for older hardware.
• Private by design — video frames are analysed on your device and never leave it. No analytics, no tracking, no remote code.
• Six languages — English, Traditional Chinese, Simplified Chinese, Spanish, Japanese, Korean — switchable in the popup.

Glasslight is an independent project and is not affiliated with, endorsed by, or sponsored by Google LLC or YouTube. YouTube is a trademark of Google LLC.

## Privacy practices tab

**Single purpose**
Restyles video sites (youtube.com, ani.gamer.com.tw) with a frosted-glass interface and page-wide ambient light derived from the playing video, while keeping text legible.

**Permission justifications**
- `storage` — Saves the user's settings (on/off, light intensity, blur, transparency, contrast target, refraction, reduce transparency, performance mode, language).
- Host permission `https://i.ytimg.com/*` — Reads YouTube thumbnail pixels (via the service worker) to colour the background when no video is playing. A page cannot read these pixels itself because the images are cross-origin.
- Content scripts on `https://www.youtube.com/*` (including the live-chat frame) and `https://ani.gamer.com.tw/*` — Apply the glass styles and sample the playing video's frames locally for the ambient light and contrast calculation.

**Remote code:** No, I am not using remote code.

**Data usage:** Collects none of the listed data types (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content).

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/Vik1n9/glasslight/blob/main/PRIVACY.md

## Distribution

- Visibility: Public · Regions: all · Price: free
