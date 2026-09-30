# Privacy Policy — Glasslight for YouTube™

_Last updated: 2026-09-29_

Glasslight changes how youtube.com looks inside your browser. It does not
collect, sell, or share personal data.

## What the extension processes, and where

| Data | What happens to it | Leaves your device? |
|---|---|---|
| Frames of the video you are watching | Downscaled to a few dozen pixels in memory to compute ambient-light colours and text contrast, then discarded. | **No** |
| Video thumbnail images from `i.ytimg.com` | Fetched to pick colours for the background when no video is playing; reduced to 32×18 pixels in memory, cached only for the open tab. | Only the normal image request to YouTube's image server, the same one YouTube itself makes. |
| Your settings (on/off, light intensity, blur, glass opacity, contrast target, refraction, reduce transparency, performance mode, language) | Stored with `chrome.storage.sync`. If Chrome Sync is on, Chrome syncs them across your signed-in browsers. | Only through Chrome Sync, controlled by your browser settings. |

## What the extension does not do

- No analytics, telemetry, tracking, or advertising.
- No account data, browsing history, watch history, cookies, or form input is read or stored.
- No data is sent to the developer or any third party.
- No remote code: everything the extension runs is included in the package.

## Permissions

- **Access to `www.youtube.com`** — to apply the glass styling and read video frames for the ambient light.
- **Access to `i.ytimg.com`** — to read thumbnail colours; a browser page cannot read these pixels directly.
- **`storage`** — to remember your settings.

## Contact

Questions or concerns: open an issue at
https://github.com/Vik1n9/glasslight/issues

Glasslight is an independent project and is not affiliated with, endorsed by,
or sponsored by Google LLC or YouTube.
