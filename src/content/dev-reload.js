// Development only (unpacked installs have no update_url): when the files on
// disk differ from the ones this extension instance was loaded from, reload
// the extension and the page.
(() => {
  let manifest;
  try {
    manifest = chrome.runtime.getManifest();
  } catch {
    return;
  }
  if ('update_url' in manifest) return;

  // Content scripts cannot fetch non-web-accessible extension files, so the
  // service worker hashes them; each ping also keeps the worker alive.
  const snapshot = () => chrome.runtime.sendMessage({ type: 'lg-dev-hash' });

  const timer = setInterval(async () => {
    if (document.hidden) return;
    let res;
    try {
      res = await snapshot();
    } catch {
      clearInterval(timer); // context invalidated
      return;
    }
    if (!res || res.now === res.loaded) return;
    clearInterval(timer);
    try {
      await chrome.runtime.sendMessage({ type: 'lg-dev-reload' });
    } catch {
      // the worker is already going down
    }
    setTimeout(() => location.reload(), 600);
  }, 1500);
})();
