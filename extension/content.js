// Content script — injected on every page.
// Renders a small draggable FAB. Annotation mode starts automatically when
// activated (extension icon or #whipped= hash). Project/card panel only
// appears when the user clicks the ⚙ button on the FAB.

(function () {
  if (window.__whippedAnnotate) return;
  window.__whippedAnnotate = true;

  // ── State ─────────────────────────────────────────────────────────────────
  let serverUrl = null;
  let projects = [];
  let cards = [];
  let selectedWsId = null;
  let selectedCardId = null;
  let selectedCardTitle = null;
  let active = false;       // crosshair mode on/off
  let fabVisible = false;
  let panelOpen = false;
  let hl = null;
  let form = null;

  // ── Styles ────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
    #__wa-fab {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
      display: none; align-items: center; gap: 2px; padding: 4px;
      background: rgba(20, 20, 30, 0.92); backdrop-filter: blur(10px);
      border: 1px solid rgba(124, 106, 255, 0.25); border-radius: 22px;
      box-shadow: 0 4px 20px rgba(0,0,0,.45);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      user-select: none; -webkit-user-select: none;
    }
    #__wa-fab.show { display: flex; }

    #__wa-fab .grip {
      width: 22px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      color: #4a4a5a; cursor: grab; flex-shrink: 0;
    }
    #__wa-fab .grip:active { cursor: grabbing; }
    #__wa-fab .grip:hover { color: #8888a0; }

    #__wa-fab .btn {
      width: 36px; height: 36px; border-radius: 18px; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 15px; transition: background .15s, transform .1s;
      font-family: inherit; padding: 0;
    }
    #__wa-fab .btn:active { transform: scale(0.95); }

    #__wa-fab .annotate {
      background: #7c6aff; color: white; font-weight: 600;
      box-shadow: 0 0 12px rgba(124, 106, 255, 0.35);
    }
    #__wa-fab .annotate:hover { background: #6a57f0; }
    #__wa-fab .annotate.on { background: #ef4444; box-shadow: 0 0 12px rgba(239, 68, 68, 0.35); }
    #__wa-fab .annotate.on:hover { background: #dc2626; }

    #__wa-fab .settings {
      background: transparent; color: #8888a0; font-size: 14px;
      width: 30px; height: 36px; border-radius: 6px;
    }
    #__wa-fab .settings:hover { color: #f0f0f5; background: rgba(255,255,255,0.05); }

    #__wa-fab .card-chip {
      display: none; padding: 0 10px; max-width: 160px;
      font-size: 11px; color: #c4baff; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis; line-height: 36px;
    }
    #__wa-fab.has-card .card-chip { display: block; }

    #__wa-panel {
      position: fixed; z-index: 2147483646; width: 280px;
      background: #1a1a24; border: 1px solid #3a3a50; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.5);
      font-family: -apple-system, sans-serif; color: #f0f0f5;
      display: none; flex-direction: column;
    }
    #__wa-panel.show { display: flex; }
    #__wa-panel .header {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border-bottom: 1px solid #2a2a38;
    }
    #__wa-panel .header .title { font-weight: 600; font-size: 13px; flex: 1; }
    #__wa-panel .header .close {
      background: transparent; border: none; color: #8888a0;
      cursor: pointer; padding: 0 6px; font-size: 16px;
      line-height: 1; font-family: inherit; border-radius: 4px;
    }
    #__wa-panel .header .close:hover { color: #f0f0f5; background: #2a2a38; }
    #__wa-panel .body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    #__wa-panel label {
      font-size: 10px; color: #8888a0; font-weight: 600;
      letter-spacing: .4px; text-transform: uppercase;
      display: block; margin-bottom: 4px;
    }
    #__wa-panel select {
      width: 100%; box-sizing: border-box;
      background: #0d0d12; border: 1px solid #2a2a38; color: #f0f0f5;
      padding: 7px 10px; border-radius: 6px; font-size: 12px;
      font-family: inherit; cursor: pointer; outline: none;
      appearance: none; -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2360607a' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px;
    }
    #__wa-panel select:focus { border-color: #7c6aff; }
    #__wa-panel select option { background: #0d0d12; color: #f0f0f5; }
    #__wa-panel .status {
      font-size: 11px; color: #8888a0; padding: 6px 10px;
      background: #141418; border-radius: 6px; border: 1px solid #2a2a35;
      display: none;
    }
    #__wa-panel .status.show { display: block; }
    #__wa-panel .status.err { color: #ef4444; border-color: #ef444430; background: #ef444410; }

    .__wa-hl {
      outline: 2px solid #7c6aff !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }

    #__wa-form {
      position: fixed; z-index: 2147483646;
      background: #1a1a24; border: 1px solid #3a3a50; border-radius: 10px;
      padding: 14px; width: 300px; box-shadow: 0 4px 32px rgba(0,0,0,.6);
      font-family: -apple-system, sans-serif; color: #f0f0f5;
    }
    #__wa-form .meta { font-size: 11px; color: #8888a0; margin-bottom: 10px; line-height: 1.5; }
    #__wa-form .meta code { font-family: monospace; color: #c4baff; background: #7c6aff18; padding: 1px 4px; border-radius: 3px; }
    #__wa-form .meta .src { color: #4a4a5a; font-family: monospace; }
    #__wa-form textarea {
      width: 100%; box-sizing: border-box; background: #0d0d12; color: #f0f0f5;
      border: 1px solid #3a3a50; border-radius: 6px; padding: 8px;
      font-size: 13px; resize: none; outline: none; font-family: inherit; display: block;
    }
    #__wa-form textarea:focus { border-color: #7c6aff; }
    #__wa-form .actions { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
    #__wa-form button { border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; cursor: pointer; font-family: inherit; }
    #__wa-form .cancel { background: #2a2a38; color: #8888a0; }
    #__wa-form .cancel:hover { background: #3a3a50; }
    #__wa-form .send { background: #7c6aff; color: #fff; font-weight: 600; }
    #__wa-form .send:hover { background: #6a57f0; }
    #__wa-form .send:disabled { opacity: .5; cursor: not-allowed; }
  `;
  document.head.appendChild(style);

  // ── FAB ────────────────────────────────────────────────────────────────────

  const fab = document.createElement("div");
  fab.id = "__wa-fab";
  fab.innerHTML = `
    <div class="grip" title="Drag to move">
      <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
        <circle cx="2" cy="2" r="1"/><circle cx="8" cy="2" r="1"/>
        <circle cx="2" cy="7" r="1"/><circle cx="8" cy="7" r="1"/>
        <circle cx="2" cy="12" r="1"/><circle cx="8" cy="12" r="1"/>
      </svg>
    </div>
    <span class="card-chip" title=""></span>
    <button class="btn annotate" title="Toggle annotation">💬</button>
    <button class="btn settings" title="Change card">⚙</button>
  `;
  document.body.appendChild(fab);

  const grip = fab.querySelector(".grip");
  const annotateBtn = fab.querySelector(".annotate");
  const settingsBtn = fab.querySelector(".settings");
  const cardChip = fab.querySelector(".card-chip");

  annotateBtn.addEventListener("click", toggleCrosshair);
  settingsBtn.addEventListener("click", togglePanel);

  // ── FAB drag ──────────────────────────────────────────────────────────────

  let dragOffset = null;

  grip.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = fab.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  });

  function onDragMove(e) {
    if (!dragOffset) return;
    const w = fab.offsetWidth, h = fab.offsetHeight;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - dragOffset.x));
    const y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - dragOffset.y));
    fab.style.left = x + "px";
    fab.style.top = y + "px";
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    if (panelOpen) positionPanel();
  }

  function onDragEnd() {
    if (!dragOffset) return;
    dragOffset = null;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    const rect = fab.getBoundingClientRect();
    chrome.storage.local.set({ fabPosition: { left: rect.left, top: rect.top } });
  }

  function restoreFabPosition() {
    chrome.storage.local.get("fabPosition", (data) => {
      if (!data.fabPosition) return;
      const w = fab.offsetWidth || 120, h = fab.offsetHeight || 44;
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, data.fabPosition.left));
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, data.fabPosition.top));
      fab.style.left = x + "px";
      fab.style.top = y + "px";
      fab.style.right = "auto";
      fab.style.bottom = "auto";
    });
  }

  // ── Panel ──────────────────────────────────────────────────────────────────

  const panel = document.createElement("div");
  panel.id = "__wa-panel";
  panel.innerHTML = `
    <div class="header">
      <span class="title">Pick card</span>
      <button class="close" title="Close">✕</button>
    </div>
    <div class="body">
      <div>
        <label>Project</label>
        <select class="project"><option value="">— select project —</option></select>
      </div>
      <div>
        <label>Card</label>
        <select class="card"><option value="">— select project first —</option></select>
      </div>
      <div class="status"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const projectSel = panel.querySelector(".project");
  const cardSel = panel.querySelector(".card");
  const statusEl = panel.querySelector(".status");

  panel.querySelector(".close").addEventListener("click", hidePanel);
  projectSel.addEventListener("change", onProjectChange);
  cardSel.addEventListener("change", onCardChange);

  // Close panel when clicking outside
  document.addEventListener("mousedown", (e) => {
    if (!panelOpen) return;
    if (panel.contains(e.target) || fab.contains(e.target)) return;
    hidePanel();
  });

  function setStatus(msg, type) {
    if (!msg) { statusEl.className = "status"; statusEl.textContent = ""; return; }
    statusEl.textContent = msg;
    statusEl.className = "status show" + (type ? " " + type : "");
  }

  function positionPanel() {
    const fabRect = fab.getBoundingClientRect();
    const panelW = 280, panelH = panel.offsetHeight || 220;
    // Prefer above the FAB; fall back to below
    let top = fabRect.top - panelH - 8;
    if (top < 8) top = fabRect.bottom + 8;
    let left = fabRect.right - panelW;
    if (left < 8) left = 8;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  function showPanel() {
    if (panelOpen) return;
    panelOpen = true;
    panel.classList.add("show");
    positionPanel();
    if (projects.length > 0) {
      renderProjectDropdown();
      if (cards.length > 0) renderCardDropdown();
      else if (selectedWsId) loadCards();
    } else {
      loadProjects();
    }
  }

  function hidePanel() {
    panelOpen = false;
    panel.classList.remove("show");
  }

  function togglePanel() {
    if (panelOpen) hidePanel();
    else showPanel();
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  function renderProjectDropdown() {
    projectSel.innerHTML = '<option value="">— select project —</option>' +
      projects.map((p) => `<option value="${escHtml(p.workspaceId)}">${escHtml(p.name || p.workspaceId)}</option>`).join("");
    if (selectedWsId && projects.some((p) => p.workspaceId === selectedWsId)) {
      projectSel.value = selectedWsId;
    }
  }

  function renderCardDropdown() {
    cardSel.innerHTML = '<option value="">— select card —</option>' +
      cards.map((c) => `<option value="${escHtml(c.id)}">[${escHtml(c.columnId)}] ${escHtml(c.title)}</option>`).join("");
    if (selectedCardId && cards.some((c) => c.id === selectedCardId)) {
      cardSel.value = selectedCardId;
    }
  }

  function loadProjects() {
    if (!serverUrl) { setStatus("Server URL not set", "err"); return; }
    setStatus("Loading projects…");
    chrome.runtime.sendMessage({ type: "FETCH_WORKSPACES", serverUrl }, (res) => {
      if (!res?.ok) { setStatus("Failed: " + (res?.error ?? "unknown"), "err"); return; }
      projects = res.workspaces;
      renderProjectDropdown();
      if (selectedWsId) loadCards();
      else setStatus(null);
    });
  }

  function loadCards() {
    if (!selectedWsId) return;
    setStatus("Loading cards…");
    chrome.runtime.sendMessage({ type: "FETCH_CARDS", serverUrl, workspaceId: selectedWsId }, (res) => {
      if (!res?.ok) { setStatus("Failed: " + (res?.error ?? "unknown"), "err"); return; }
      cards = res.cards;
      renderCardDropdown();
      updateCardChip();
      setStatus(null);
    });
  }

  function onProjectChange() {
    selectedWsId = projectSel.value || null;
    selectedCardId = null;
    selectedCardTitle = null;
    cardSel.innerHTML = '<option value="">— select card —</option>';
    cards = [];
    updateCardChip();
    chrome.storage.local.set({ workspaceId: selectedWsId, cardId: null });
    if (selectedWsId) loadCards();
  }

  function onCardChange() {
    selectedCardId = cardSel.value || null;
    const card = cards.find((c) => c.id === selectedCardId);
    selectedCardTitle = card?.title ?? null;
    chrome.storage.local.set({ cardId: selectedCardId });
    updateCardChip();
    // Auto-close panel and start crosshair when a card is picked
    if (selectedCardId) {
      hidePanel();
      if (!active) activateCrosshair();
    }
  }

  function updateCardChip() {
    if (selectedCardTitle) {
      cardChip.textContent = selectedCardTitle;
      cardChip.title = selectedCardTitle;
      fab.classList.add("has-card");
    } else {
      fab.classList.remove("has-card");
    }
  }

  // ── Crosshair mode ────────────────────────────────────────────────────────

  function activateCrosshair() {
    if (!selectedWsId || !selectedCardId) {
      // Need to pick a card first
      showPanel();
      return;
    }
    active = true;
    document.body.style.cursor = "crosshair";
    annotateBtn.classList.add("on");
    annotateBtn.textContent = "✕";
    annotateBtn.title = "Stop annotating";
  }

  function deactivateCrosshair() {
    active = false;
    document.body.style.cursor = "";
    annotateBtn.classList.remove("on");
    annotateBtn.textContent = "💬";
    annotateBtn.title = "Toggle annotation";
    if (hl) { hl.classList.remove("__wa-hl"); hl = null; }
    removeForm();
  }

  function toggleCrosshair() {
    if (active) deactivateCrosshair();
    else activateCrosshair();
  }

  // ── FAB visibility ─────────────────────────────────────────────────────────

  function showFab() {
    fabVisible = true;
    fab.classList.add("show");
    restoreFabPosition();
  }

  function hideFab() {
    fabVisible = false;
    fab.classList.remove("show");
    deactivateCrosshair();
    hidePanel();
  }

  function toggleOverlay() {
    if (fabVisible) {
      hideFab();
    } else {
      showFab();
      loadFromStorage(() => {
        // After loading state, decide what to do
        if (selectedWsId && selectedCardId) {
          activateCrosshair(); // auto-start
        } else {
          showPanel(); // user needs to pick a card first
        }
      });
    }
  }

  function loadFromStorage(cb) {
    chrome.storage.local.get(["serverUrl", "workspaceId", "cardId"], (data) => {
      serverUrl = data.serverUrl ?? null;
      selectedWsId = data.workspaceId ?? null;
      selectedCardId = data.cardId ?? null;
      // Preload projects/cards so the chip / panel are ready
      if (serverUrl) {
        chrome.runtime.sendMessage({ type: "FETCH_WORKSPACES", serverUrl }, (res) => {
          if (res?.ok) projects = res.workspaces;
          if (selectedWsId) {
            chrome.runtime.sendMessage({ type: "FETCH_CARDS", serverUrl, workspaceId: selectedWsId }, (res2) => {
              if (res2?.ok) {
                cards = res2.cards;
                const card = cards.find((c) => c.id === selectedCardId);
                selectedCardTitle = card?.title ?? null;
                updateCardChip();
              }
              cb?.();
            });
          } else {
            cb?.();
          }
        });
      } else {
        cb?.();
      }
    });
  }

  // ── Comment form ──────────────────────────────────────────────────────────

  function removeForm() {
    if (form) { form.remove(); form = null; }
  }

  function cssSelector(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body) {
      let sel = node.tagName.toLowerCase();
      if (node.id) { sel += "#" + node.id; parts.unshift(sel); break; }
      const cls = typeof node.className === "string"
        ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".")
        : null;
      if (cls) sel += "." + cls;
      parts.unshift(sel);
      node = node.parentElement;
      if (parts.length >= 4) break;
    }
    return parts.join(" > ");
  }

  // React fiber lives in the page's main world (isolated content scripts can't
  // see __reactFiber$xxx properties). content-main.js runs in MAIN world and
  // bridges back via window.postMessage.
  function reactInfoAsync(el) {
    return new Promise((resolve) => {
      const requestId = "r" + Math.random().toString(36).slice(2);
      const marker = requestId;
      el.setAttribute("data-wa-marker", marker);

      function cleanup() {
        window.removeEventListener("message", listener);
        el.removeAttribute("data-wa-marker");
      }

      const timer = setTimeout(() => {
        cleanup();
        console.warn("[whipped] reactInfo timeout — content-main.js not responding");
        resolve({});
      }, 1500);

      function listener(e) {
        if (e.source !== window) return;
        if (e.data?.type !== "__WA_REACT_RESULT") return;
        if (e.data.requestId !== requestId) return;
        clearTimeout(timer);
        cleanup();
        const result = e.data.result || {};
        console.log("[whipped] reactInfo result:", result);
        if (result.error) console.warn("[whipped] reactInfo error:", result.error, "debugKeys:", result.debugKeys);
        if (result.trace) console.log("[whipped] fiber trace:", result.trace);
        resolve({
          componentName: result.componentName || null,
          sourceFile: result.sourceFile || null,
          sourceLine: result.sourceLine || null,
        });
      }

      window.addEventListener("message", listener);
      window.postMessage({ type: "__WA_REACT_EXTRACT", requestId, marker }, "*");
    });
  }

  function escHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async function showCommentForm(el, x, y) {
    removeForm();
    const selector = cssSelector(el);
    const rawText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    const elementText = rawText.slice(0, 300);
    const ri = await reactInfoAsync(el);
    const shortFile = ri.sourceFile ? ri.sourceFile.split("/").slice(-2).join("/") : null;

    form = document.createElement("div");
    form.id = "__wa-form";
    form.innerHTML = `
      <div class="meta">
        ${selectedCardTitle ? `<div>📌 ${escHtml(selectedCardTitle)}</div>` : ""}
        <div>🎯 <code>${escHtml(selector)}</code></div>
        ${ri.componentName ? `<div>⚛ ${escHtml(ri.componentName)}</div>` : ""}
        ${shortFile ? `<div class="src">📄 ${escHtml(shortFile)}${ri.sourceLine ? ":" + ri.sourceLine : ""}</div>` : ""}
      </div>
      <textarea rows="3" placeholder="Describe the change…"></textarea>
      <div class="actions">
        <button class="cancel">Cancel</button>
        <button class="send">Send</button>
      </div>
    `;
    document.body.appendChild(form);

    const fw = 300, fh = 220;
    form.style.left = Math.min(x + 12, window.innerWidth - fw - 12) + "px";
    form.style.top = Math.min(y + 12, window.innerHeight - fh - 12) + "px";

    const ta = form.querySelector("textarea");
    ta.focus();

    form.querySelector(".cancel").addEventListener("click", removeForm);
    form.querySelector(".send").addEventListener("click", () => {
      const text = ta.value.trim();
      if (!text) return;
      const sendBtn = form.querySelector(".send");
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      chrome.runtime.sendMessage({
        type: "POST_COMMENT",
        payload: {
          serverUrl,
          workspaceId: selectedWsId,
          cardId: selectedCardId,
          summary: text,
          visualComment: {
            pageUrl: window.location.href,
            elementSelector: selector,
            elementText: elementText || undefined,
            componentName: ri.componentName || undefined,
            sourceFile: ri.sourceFile || undefined,
            sourceLine: ri.sourceLine || undefined,
          },
        },
      }, (res) => {
        if (res?.ok) {
          removeForm();
        } else {
          sendBtn.disabled = false;
          sendBtn.textContent = "Send";
          alert("Failed: " + (res?.error ?? "unknown error"));
        }
      });
    });

    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.querySelector(".send").click(); }
      if (e.key === "Escape") removeForm();
    });
  }

  // ── Element selection (gated on `active`) ──────────────────────────────────

  document.addEventListener("mouseover", (e) => {
    if (!active) return;
    if (fab.contains(e.target) || panel.contains(e.target)) return;
    if (form && form.contains(e.target)) return; // skip the form itself, but keep highlighting elsewhere
    if (hl) hl.classList.remove("__wa-hl");
    hl = e.target;
    if (hl) hl.classList.add("__wa-hl");
  }, true);

  document.addEventListener("click", (e) => {
    if (!active) return;
    if (fab.contains(e.target) || panel.contains(e.target)) return;
    if (form && form.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (hl) hl.classList.remove("__wa-hl");
    void showCommentForm(e.target, e.clientX, e.clientY);
  }, true);

  // ── Messages from background ──────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TOGGLE_OVERLAY") toggleOverlay();
  });

  // ── URL-hash auto-activation (from kanban "Save & Open") ──────────────────

  function utf8Atob(b64) {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch { return null; }
  }

  function readHashContext() {
    const hash = location.hash;
    if (!hash) return null;
    const m = hash.match(/[#&]whipped=([^&]+)/);
    if (!m) return null;
    const json = utf8Atob(decodeURIComponent(m[1]));
    if (!json) return null;
    try {
      const data = JSON.parse(json);
      if (data && data.serverUrl && data.workspaceId && data.cardId) return data;
    } catch { /* */ }
    return null;
  }

  function cleanHash() {
    const hash = location.hash;
    const cleaned = hash.replace(/(^#|&)whipped=[^&]+/, (m) => (m.startsWith("&") ? "" : "#"));
    const finalHash = cleaned === "#" ? "" : cleaned;
    history.replaceState(null, "", location.pathname + location.search + finalHash);
  }

  const ctx = readHashContext();
  if (ctx) {
    chrome.storage.local.set(
      { serverUrl: ctx.serverUrl, workspaceId: ctx.workspaceId, cardId: ctx.cardId },
      () => {
        serverUrl = ctx.serverUrl;
        selectedWsId = ctx.workspaceId;
        selectedCardId = ctx.cardId;
        selectedCardTitle = ctx.cardTitle || ctx.cardId;
        showFab();
        updateCardChip();
        activateCrosshair(); // auto-start annotation
      }
    );
    cleanHash();
  }
})();
