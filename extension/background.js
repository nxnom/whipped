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
  if (msg.type === "LOGIN") {
    login(msg.serverUrl, msg.password).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
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

// ── API calls ───────────────────────────────────────────────────────────────
// host_permissions makes these CORS-exempt; credentials:"include" sends the
// session cookie set by login() so the daemon's auth gate lets us through.

// Surfaces the daemon's 401 as a clear "needs login" signal for the settings UI.
async function apiFetch(url, init) {
  const res = await fetch(url, { ...init, credentials: "include" });
  if (res.status === 401) throw new Error("Not authenticated — sign in with your Whipped password.");
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res;
}

async function login(serverUrl, password) {
  const res = await fetch(`${serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "Incorrect password" : `Server returned ${res.status}`);
  return { ok: true };
}

async function postComment({ serverUrl, workspaceId, cardId, summary, visualComment }) {
  await apiFetch(`${serverUrl}/api/visual-comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, cardId, summary, visualComment }),
  });
  return { ok: true };
}

async function fetchWorkspaces(serverUrl) {
  const res = await apiFetch(`${serverUrl}/api/projects`);
  const workspaces = await res.json();
  return { ok: true, workspaces };
}

async function fetchCards(serverUrl, workspaceId) {
  const res = await apiFetch(`${serverUrl}/api/workspace/state?workspaceId=${encodeURIComponent(workspaceId)}`);
  const json = await res.json();
  const board = json?.board ?? { cards: {}, columns: [] };
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
