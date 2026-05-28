// Background service worker

// ── Dynamic popup ──────────────────────────────────────────────────────────
// When serverUrl is set: clear the popup so clicking the icon fires
// chrome.action.onClicked (toggle the in-page panel).
// When serverUrl is NOT set: use settings.html as popup so the user can
// configure it before anything else.

const DEFAULT_SERVER_URL = "http://localhost:50007";

function updatePopup(serverUrl) {
  if (serverUrl) chrome.action.setPopup({ popup: "" });
  else chrome.action.setPopup({ popup: "settings.html" });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("serverUrl", (data) => {
    if (data.serverUrl) {
      updatePopup(data.serverUrl);
    } else {
      // Auto-set the default so first click goes straight to the FAB.
      // User can change it later via right-click extension → Options.
      chrome.storage.local.set({ serverUrl: DEFAULT_SERVER_URL }, () => updatePopup(DEFAULT_SERVER_URL));
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("serverUrl", (data) => updatePopup(data.serverUrl));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "serverUrl" in changes) {
    updatePopup(changes.serverUrl.newValue);
  }
});

// ── Toggle in-page panel ────────────────────────────────────────────────────

async function togglePanelOnTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // already injected or restricted page (chrome://, file://, etc.) — continue
  }
  try {
    await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_OVERLAY" });
  } catch {
    // page rejected message (restricted) — silently ignore
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  // Fires only when popup is cleared (serverUrl set)
  if (!tab?.id) return;
  await togglePanelOnTab(tab.id);
});

// ── Message bridge ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "POST_COMMENT") {
    postComment(msg.payload).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "FETCH_WORKSPACES") {
    fetchWorkspaces(msg.serverUrl).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "FETCH_CARDS") {
    fetchCards(msg.serverUrl, msg.workspaceId).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "OPEN_PANEL") {
    // Called from settings page after initial setup
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (tab?.id) await togglePanelOnTab(tab.id);
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ── API calls (cross-origin from background, no CORS issues) ────────────────

async function postComment({ serverUrl, workspaceId, cardId, summary, visualComment }) {
  const res = await fetch(`${serverUrl}/api/visual-comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, cardId, summary, visualComment }),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return { ok: true };
}

async function fetchWorkspaces(serverUrl) {
  const res = await fetch(`${serverUrl}/api/trpc/projects.list?batch=1&input=%7B%7D`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const json = await res.json();
  const workspaces = json?.[0]?.result?.data ?? [];
  return { ok: true, workspaces };
}

async function fetchCards(serverUrl, workspaceId) {
  const input = encodeURIComponent(JSON.stringify({ "0": { workspaceId } }));
  const res = await fetch(`${serverUrl}/api/trpc/workspace.state?batch=1&input=${input}`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const json = await res.json();
  const board = json?.[0]?.result?.data?.board ?? { cards: {}, columns: [] };
  const activeColIds = ["todo", "in_progress", "reopened", "ready_for_review", "blocked"];
  const activeIds = new Set(
    board.columns
      .filter((c) => activeColIds.includes(c.id))
      .flatMap((c) => c.taskIds)
  );
  const cards = Object.values(board.cards)
    .filter((c) => activeIds.has(c.id))
    .map((c) => ({ id: c.id, title: c.description?.split("\n")[0] ?? c.id, columnId: c.columnId }));
  return { ok: true, cards };
}
