# Chrome Web Store submission — Glasslight

Everything the Developer Dashboard asks for, ready to paste.
Package: `python3 scripts/build.py` → `dist/glasslight-<version>.zip`.

## Store listing

- **Name:** Glasslight (from `_locales/*/messages.json`; site names stay out of the name — they are other companies' trademarks)
- **Summary:** from the manifest description, localized in 6 languages (≤132 chars)
- **Category:** Functionality & UI (Make Chrome Yours)
- **Listing language:** English only (description and screenshots are in English; the extension UI itself ships in 6 languages).
- **Icon:** `icons/icon-128.png` (96×96 artwork, 16 px transparent padding)
- **Screenshots (1280×800):** `store/screenshots/*.png`
- **Small promo tile (440×280, required):** `store/promo-small-440x280.png`
- **Marquee (1400×560, optional):** `store/promo-marquee-1400x560.png`
- **Homepage / support URL:** https://github.com/Vik1n9/glasslight

### Detailed description — English

Glasslight turns the video sites you watch on — YouTube™ and 巴哈姆特動畫瘋 (ani.gamer.com.tw) — into a calm, glass-like space lit by what you are watching.

• Page-wide ambient light — colours from the playing video flow across the whole page, with a soft glow radiating from behind the player. When nothing is playing, the light follows the thumbnail you hover.
• Three backdrops — Hybrid (the picture enlarged behind the player, light streaming from its edges), Enlarged (the picture across the whole page) or Radial (the picture's edges streamed outward). Burned-in subtitles stay inside the player.
• Frosted, refractive glass — the top bar, category bar, menus and player controls become floating glass with gentle refraction, a light-catching rim and adaptive shadows.
• Text always stays readable — the extension measures the light behind the page several times a second and keeps text at the contrast level you choose (up to WCAG 4.5:1). Bright or dark footage, light or dark theme; on YouTube's light theme, text sits on frosted cards so the colour around them stays vivid.
• Works across YouTube — watch pages, theater mode, Shorts, channels, search, playlists, live chat and the miniplayer.
• Also on Bahamut Anime Crazy (ani.gamer.com.tw) — ambient light from the playing episode or the anime cover you hover, glass top bars, menus, cards and player controls.
• Accessibility — honours Reduce Transparency, Increase Contrast and Reduce Motion, with a performance mode for older hardware.
• Private by design — video frames are analysed on your device and never leave it. No analytics, no tracking, no remote code.
• Six languages — English, Traditional Chinese, Simplified Chinese, Spanish, Japanese, Korean — switchable in the popup.

Glasslight is an independent project and is not affiliated with, endorsed by, or sponsored by Google LLC, YouTube, or Bahamut (巴哈姆特). YouTube is a trademark of Google LLC; 巴哈姆特 and 動畫瘋 are trademarks of their respective owner. Site names are used only to describe compatibility, and all site content remains the property of its owners.

## Privacy practices tab

**Single purpose**
Restyles video sites (youtube.com, ani.gamer.com.tw) with a frosted-glass interface and page-wide ambient light derived from the playing video, while keeping text legible.

**Permission justifications**
- `storage` — Saves the user's settings (on/off, light intensity, blur, transparency, contrast target, backdrop mode, refraction, reduce transparency, performance mode, language).
- Host permission `https://i.ytimg.com/*` — Reads YouTube thumbnail pixels (via the service worker) to colour the background when no video is playing. A page cannot read these pixels itself because the images are cross-origin.
- Content scripts on `https://www.youtube.com/*` (including the live-chat frame) and `https://ani.gamer.com.tw/*` — Apply the glass styles and sample the playing video's frames locally for the ambient light and contrast calculation. On ani.gamer.com.tw browse pages they also read the colours of anime covers from `p2.bahamut.com.tw`, which serves them to any site (CORS), so no extra host permission is needed.

**Remote code:** No, I am not using remote code.

**Data usage:** Collects none of the listed data types (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content).

Certify all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/Vik1n9/glasslight/blob/main/PRIVACY.md

## Distribution

- Visibility: Public · Regions: all · Price: free
