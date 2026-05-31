// Background service worker.
// The popup (an extension page) talks to the daemon directly. The content
// script can't make cross-origin requests, so its visual-comment POST is
// relayed through here, where host_permissions makes the fetch CORS-exempt.

const DEFAULT_SERVER_URL = "http://localhost:50007";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("serverUrl", (data) => {
    if (!data.serverUrl) chrome.storage.local.set({ serverUrl: DEFAULT_SERVER_URL });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "POST_COMMENT") {
    postComment(msg.payload).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function postComment({ serverUrl, workspaceId, cardId, summary, visualComment }) {
  const res = await fetch(`${serverUrl}/api/visual-comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ workspaceId, cardId, summary, visualComment }),
  });
  if (res.status === 401) return { ok: false, error: "Not authenticated" };
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return { ok: true };
}
