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
  if (msg.type === "GET_CREATE_OPTIONS") {
    getCreateOptions(msg.payload).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === "CREATE_TASK") {
    createTask(msg.payload).then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function getCreateOptions({ serverUrl, workspaceId }) {
  const q = encodeURIComponent(workspaceId);
  const get = (path) => fetch(`${serverUrl}${path}`, { credentials: "include" });
  const [wf, br, st] = await Promise.all([
    get(`/api/workflows?workspaceId=${q}`),
    get(`/api/cards/branches?workspaceId=${q}`),
    get(`/api/workspace/state?workspaceId=${q}`),
  ]);
  if ([wf, br, st].some((r) => r.status === 401)) return { ok: false, error: "Not authenticated" };
  return {
    ok: true,
    workflows: wf.ok ? await wf.json() : [],
    branches: br.ok ? await br.json() : { branches: [], defaultBranch: "" },
    state: st.ok ? await st.json() : null,
  };
}

async function createTask({ serverUrl, body }) {
  const res = await fetch(`${serverUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (res.status === 401) return { ok: false, error: "Not authenticated" };
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return { ok: true, card: await res.json() };
}

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
