// Runs inside YouTube's live-chat iframe: mirror the on/off setting as
// html.lg-on so live-chat.css follows the popup switch like the main page.
(async () => {
  await LG.loadSettings();
  const apply = () => document.documentElement.classList.toggle('lg-on', LG.settings.enabled);
  apply();
  LG.onSettings(apply);
})();
