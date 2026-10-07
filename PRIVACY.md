# Privacy Policy — Glasslight

_Last updated: 2026-10-07_

Glasslight changes how youtube.com and ani.gamer.com.tw (Bahamut Anime Crazy)
look inside your browser. It does not collect, sell, or share personal data.

## What the extension processes, and where

| Data | What happens to it | Leaves your device? |
|---|---|---|
| Frames of the video you are watching | Downscaled to a few dozen pixels in memory to compute ambient-light colours and text contrast, then discarded. | **No** |
| Video thumbnail images from `i.ytimg.com` | Fetched to pick colours for the background when no video is playing; reduced to 32×18 pixels in memory, cached only for the open tab. | Only the normal image request to YouTube's image server, the same one YouTube itself makes. |
| Anime cover images from `p2.bahamut.com.tw` | On ani.gamer.com.tw browse pages (home, lists, search, watch history), the cover you hover or the one in the middle of the screen is fetched to pick background colours; reduced to 32×18 pixels in memory, cached only for the open tab. | Only the normal image request to Bahamut's image server, for covers the page already shows. No cookies are sent with it. |
| Your settings (on/off, light intensity, blur, transparency, contrast target, backdrop mode, refraction, reduce transparency, performance mode, static backdrop, language) | Stored with `chrome.storage.sync`, read and written by the popup and the settings page. If Chrome Sync is on, Chrome syncs them across your signed-in browsers. | Only through Chrome Sync, controlled by your browser settings. |
| A "settings page already shown" flag | Stored with `chrome.storage.local` after the settings page opens on first install, so it opens only once. | **No** |

## What the extension does not do

- No analytics, telemetry, tracking, or advertising.
- No account data, browsing history, watch history, cookies, or form input is read or stored.
- No data is sent to the developer or any third party.
- No remote code: everything the extension runs is included in the package.

## Voluntary contribution

The settings page has an optional button to contribute NT$100 to the
developer. It only opens the developer's checkout page, hosted by a
third-party payment provider (TapPay), in a new browser tab; the payment
happens entirely on that site, under the provider's own privacy policy. The
extension does not load any payment code, and does not collect, read,
store or transmit any payment or financial information. Contributing or not
changes nothing in the extension.

## Permissions

- **Access to `www.youtube.com` and `ani.gamer.com.tw`** — to apply the glass styling and read video frames for the ambient light.
- **Access to `i.ytimg.com`** — to read thumbnail colours; a browser page cannot read these pixels directly.
- **`storage`** — to remember your settings (and that the settings page was already shown once).

## Contact

Questions or concerns: open an issue at
https://github.com/Vik1n9/glasslight/issues

Glasslight is an independent project and is not affiliated with, endorsed by,
or sponsored by Google LLC, YouTube, or Bahamut (巴哈姆特). YouTube is a
trademark of Google LLC; 巴哈姆特 and 動畫瘋 are trademarks of their respective
owner. They are named here only to describe where the extension works.
