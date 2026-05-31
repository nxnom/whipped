const DEFAULT_SERVER_URL = "http://localhost:50007";

const view = document.getElementById("view");
const dot = document.getElementById("dot");
const tag = document.getElementById("tag");

let serverUrl = DEFAULT_SERVER_URL;

const store = {
  get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
  set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
};

const api = (path, init) => fetch(`${serverUrl}${path}`, { credentials: "include", ...init });

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function host(url) {
  try { return new URL(url).host; } catch { return url; }
}

function field(labelText, inputEl) {
  const wrap = el(`<div class="field"><label>${labelText}</label></div>`);
  wrap.append(inputEl);
  return wrap;
}

function setDot(on) { dot.classList.toggle("on", on); }
function render(...nodes) { view.replaceChildren(...nodes); }
function renderLoading() { render(el(`<div class="spin"></div>`)); }

function serverRow() {
  const row = el(`<div class="server-row"><span class="host">${escapeHtml(host(serverUrl))}</span><button class="linkbtn">Change</button></div>`);
  row.querySelector("button").onclick = renderServerEdit;
  return row;
}

// ── Routing ─────────────────────────────────────────────────────────────────

async function route() {
  renderLoading();
  let status;
  try {
    const res = await api("/api/auth/status");
    if (!res.ok) throw new Error(String(res.status));
    status = await res.json();
  } catch {
    setDot(false);
    return renderUnreachable();
  }
  setDot(Boolean(status.authenticated));
  if (status.needsSetup) return renderSetupNotice();
  if (!status.authenticated) return renderUnlock();
  return renderMain();
}

// ── Views ─────────────────────────────────────────────────────────────────

function renderServerEdit() {
  tag.textContent = "Server";
  const input = el(`<input type="url" placeholder="http://localhost:50008" />`);
  input.value = serverUrl;
  const err = el(`<div class="alert err" style="display:none"></div>`);
  const save = el(`<button class="btn primary">Save & continue</button>`);
  const cancel = el(`<button class="linkbtn" style="margin:2px auto 0">Cancel</button>`);

  async function commit() {
    const u = input.value.trim().replace(/\/$/, "");
    if (!/^https?:\/\//i.test(u)) {
      err.textContent = "URL must start with http:// or https://";
      err.style.display = "block";
      return;
    }
    serverUrl = u;
    await store.set({ serverUrl: u });
    route();
  }
  save.onclick = commit;
  cancel.onclick = route;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });

  render(field("Whipped server URL", input), err, save, cancel);
  input.focus();
}

function renderUnreachable() {
  tag.textContent = "Offline";
  const alert = el(`<div class="alert err">Can't reach <b>${escapeHtml(host(serverUrl))}</b>. Make sure Whipped is running, then retry.</div>`);
  const retry = el(`<button class="btn ghost">Retry</button>`);
  retry.onclick = route;
  render(alert, retry, serverRow());
}

function renderSetupNotice() {
  tag.textContent = "Setup";
  const hero = el(`<div class="hero"><div class="ring">🔑</div><h2>No password yet</h2><p>This Whipped server hasn't been secured with a password.</p></div>`);
  const info = el(`<div class="alert info">Set one in the web app, or run <code>whipped auth set-password</code> on the machine running Whipped — then retry.</div>`);
  const retry = el(`<button class="btn ghost">Retry</button>`);
  retry.onclick = route;
  render(hero, info, retry, serverRow());
}

function renderUnlock() {
  tag.textContent = "Locked";
  const hero = el(`<div class="hero"><div class="ring">🔒</div><h2>Unlock Whipped</h2><p>Sign in to connect the annotator to ${escapeHtml(host(serverUrl))}.</p></div>`);
  const pass = el(`<input type="password" placeholder="Password" />`);
  const err = el(`<div class="alert err" style="display:none"></div>`);
  const unlock = el(`<button class="btn primary">Unlock</button>`);

  async function doLogin() {
    const password = pass.value;
    if (!password) return;
    unlock.disabled = true;
    unlock.textContent = "Unlocking…";
    err.style.display = "none";
    try {
      const res = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) throw new Error("Incorrect password");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      route();
    } catch (e) {
      err.textContent = e.message;
      err.style.display = "block";
      unlock.disabled = false;
      unlock.textContent = "Unlock";
      pass.focus();
    }
  }
  unlock.onclick = doLogin;
  pass.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

  render(hero, field("Password", pass), err, unlock, serverRow());
  pass.focus();
}

function extractCards(json) {
  const board = json?.board ?? { cards: {}, columns: [] };
  const activeColIds = ["todo", "in_progress", "reopened", "ready_for_review", "blocked"];
  const activeIds = new Set(
    board.columns.filter((c) => activeColIds.includes(c.id)).flatMap((c) => c.taskIds),
  );
  return Object.values(board.cards)
    .filter((c) => activeIds.has(c.id))
    .map((c) => ({ id: c.id, title: c.description?.split("\n")[0] ?? c.id }));
}

async function startAnnotating() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch {
    // already injected, or a restricted page (chrome://, web store) — ignore
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "START_ANNOTATING" });
  } catch {
    /* restricted page — nothing to do */
  }
  window.close();
}

async function renderMain() {
  tag.textContent = "Annotate";
  const conn = el(`<div class="conn"><span class="cdot"></span><span class="host">${escapeHtml(host(serverUrl))}</span><button class="linkbtn danger">Disconnect</button></div>`);
  conn.querySelector("button").onclick = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch { /* */ }
    route();
  };

  const projectSel = el(`<select><option value="">Loading projects…</option></select>`);
  const cardSel = el(`<select disabled><option value="">Select a project first</option></select>`);
  const start = el(`<button class="btn primary" disabled>✏️ Start annotating</button>`);
  const hint = el(`<div class="hint">Then click any element on the page to leave a comment.</div>`);
  const err = el(`<div class="alert err" style="display:none"></div>`);
  start.onclick = startAnnotating;

  render(conn, field("Project", projectSel), field("Card", cardSel), start, hint, err);

  async function loadCards(wsId, preselect) {
    start.disabled = true;
    if (!wsId) {
      cardSel.disabled = true;
      cardSel.innerHTML = `<option value="">Select a project first</option>`;
      return;
    }
    cardSel.disabled = true;
    cardSel.innerHTML = `<option value="">Loading cards…</option>`;
    let cards = [];
    try {
      const res = await api(`/api/workspace/state?workspaceId=${encodeURIComponent(wsId)}`);
      if (!res.ok) throw new Error();
      cards = extractCards(await res.json());
    } catch {
      cardSel.innerHTML = `<option value="">Couldn't load cards</option>`;
      return;
    }
    cardSel.disabled = false;
    cardSel.innerHTML = `<option value="">— select card —</option>` +
      cards.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join("");
    if (preselect && cards.some((c) => c.id === preselect)) {
      cardSel.value = preselect;
      start.disabled = false;
      await store.set({ cardTitle: cardSel.selectedOptions[0]?.textContent ?? null });
    }
  }

  projectSel.onchange = async () => {
    await store.set({ workspaceId: projectSel.value || null, cardId: null, cardTitle: null });
    await loadCards(projectSel.value, null);
  };
  cardSel.onchange = async () => {
    start.disabled = !cardSel.value;
    await store.set({
      cardId: cardSel.value || null,
      cardTitle: cardSel.value ? cardSel.selectedOptions[0]?.textContent ?? null : null,
    });
  };

  const saved = await store.get(["workspaceId", "cardId"]);
  let projects = [];
  try {
    const res = await api("/api/projects");
    if (!res.ok) throw new Error();
    projects = await res.json();
  } catch {
    err.textContent = "Couldn't load projects.";
    err.style.display = "block";
  }
  projectSel.innerHTML = `<option value="">— select project —</option>` +
    projects.map((p) => `<option value="${escapeHtml(p.workspaceId)}">${escapeHtml(p.name || p.workspaceId)}</option>`).join("");

  if (saved.workspaceId && projects.some((p) => p.workspaceId === saved.workspaceId)) {
    projectSel.value = saved.workspaceId;
    await loadCards(saved.workspaceId, saved.cardId);
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────

(async () => {
  const { serverUrl: stored } = await store.get(["serverUrl"]);
  serverUrl = stored || DEFAULT_SERVER_URL;
  route();
})();
