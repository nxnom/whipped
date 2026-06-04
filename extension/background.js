// Background service worker. With no default_popup, clicking the toolbar icon
// fires this — it tells the active tab's content script to enter select mode.

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  const start = () => chrome.tabs.sendMessage(tab.id, { type: "START_ANNOTATING" });

  try {
    await start();
  } catch {
    // Content script not present yet (page loaded before install/update). Inject
    // the MAIN-world fiber bridge + the content script, then retry. Fails silently
    // on restricted pages (chrome://, the extension gallery, etc.).
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-main.js"], world: "MAIN" });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await start();
    } catch {
      // Nothing we can do on a restricted page.
    }
  }
});
