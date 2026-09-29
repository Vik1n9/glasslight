// Fetch a YouTube thumbnail (host permission bypasses CORS), downsample it and
// hand the raw pixels back to the content script so its canvas stays untainted.
const W = 32;
const H = 18;

const manifest = chrome.runtime.getManifest();
const DEV = !('update_url' in manifest); // unpacked install

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'lg-thumb': {
      const url = new URL(msg.url);
      if (url.hostname !== 'i.ytimg.com') {
        sendResponse(null);
        return false;
      }
      thumbPixels(url.href)
        .then(sendResponse)
        .catch(() => sendResponse(null));
      return true; // async response
    }
    case 'lg-dev-hash':
      if (!DEV) return false;
      Promise.all([loadedHash(), filesHash()])
        .then(([loaded, now]) => sendResponse({ loaded, now }))
        .catch(() => sendResponse(null));
      return true;
    case 'lg-dev-reload':
      if (DEV) chrome.runtime.reload();
      return false;
    default:
      return false;
  }
});

async function thumbPixels(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, W, H);
  bitmap.close();
  // Array (not typed array) so it survives structured messaging as JSON.
  return { pixels: Array.from(ctx.getImageData(0, 0, W, H).data), w: W, h: H };
}

// ---- development auto-reload (unpacked installs only) ----------------------

const DEV_LOCALES = ['en', 'es', 'ja', 'ko', 'zh_CN', 'zh_TW'];
const DEV_FILES = [
  'manifest.json',
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  // chrome.i18n caches messages until reload; popup files are included so
  // a popup change also refreshes an open page's view of the extension.
  ...DEV_LOCALES.map((l) => `_locales/${l}/messages.json`),
  'src/popup/popup.html',
  'src/popup/popup.js',
  'src/popup/popup.css',
];

async function filesHash() {
  const texts = await Promise.all(
    DEV_FILES.map((f) => fetch(chrome.runtime.getURL(f), { cache: 'no-store' }).then((r) => r.text())),
  );
  const s = texts.join('\u0000');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Hash of the files as they were when this extension instance was loaded.
// storage.session survives worker restarts but is cleared on reload, so a
// page opened long after the files changed still detects a stale extension.
async function loadedHash() {
  const { lgLoadedHash } = await chrome.storage.session.get('lgLoadedHash');
  if (typeof lgLoadedHash === 'number') return lgLoadedHash;
  const h = await filesHash();
  await chrome.storage.session.set({ lgLoadedHash: h });
  return h;
}

if (DEV) {
  chrome.runtime.onInstalled.addListener(() => {
    filesHash().then((h) => chrome.storage.session.set({ lgLoadedHash: h }));
  });
}
