// Content script — injected on demand by the Whipped popup (and by the kanban
// "Save & Open" deep-link). It only does crosshair element selection + the
// comment form. Connecting, login, and project/card selection live in the popup.

(function () {
  if (window.__whippedAnnotate) {
    // Already injected on this page — just re-activate with the latest context.
    window.__whippedActivate?.();
    return;
  }
  window.__whippedAnnotate = true;

  let serverUrl = null;
  let workspaceId = null;
  let cardId = null;
  let cardTitle = null;
  let active = false;
  let hl = null;
  let form = null;
  let indicator = null;
  let barMove = null;

  // ── Styles ────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
    .__wa-hl {
      outline: 2px solid #7c6aff !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }

    #__wa-bar {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; display: flex; align-items: center; gap: 8px;
      padding: 6px 6px 6px 12px; border-radius: 999px;
      background: rgba(20, 20, 28, 0.92); backdrop-filter: blur(12px);
      border: 1px solid rgba(124, 106, 255, 0.35);
      box-shadow: 0 8px 30px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.2);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #f0f0f5;
      font-size: 12px; user-select: none; -webkit-user-select: none;
      animation: __wa-pop .18s ease-out;
      /* Click-through so elements underneath stay selectable; only the exit
         button opts back in. Fades out (below) while the cursor is over it. */
      pointer-events: none; transition: opacity .15s ease;
    }
    #__wa-bar.faded { opacity: .12; }
    @keyframes __wa-pop { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
    #__wa-bar .pulse { width: 8px; height: 8px; border-radius: 50%; background: #7c6aff; box-shadow: 0 0 0 0 rgba(124,106,255,.6); animation: __wa-pulse 1.6s infinite; flex-shrink: 0; }
    @keyframes __wa-pulse { 0% { box-shadow: 0 0 0 0 rgba(124,106,255,.5); } 70% { box-shadow: 0 0 0 7px rgba(124,106,255,0); } 100% { box-shadow: 0 0 0 0 rgba(124,106,255,0); } }
    #__wa-bar .label { font-weight: 600; }
    #__wa-bar .card { color: #c4baff; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #__wa-bar .hint { color: #60607a; }
    #__wa-bar .exit {
      background: rgba(255,255,255,.06); border: none; color: #9a9ab0;
      font-family: inherit; font-size: 11px; font-weight: 600;
      padding: 5px 10px; border-radius: 999px;
    }

    #__wa-form {
      position: fixed; z-index: 2147483646;
      background: #16161c; border: 1px solid #34344a; border-radius: 12px;
      padding: 14px; width: 300px; box-shadow: 0 16px 48px rgba(0,0,0,.6);
      font-family: -apple-system, sans-serif; color: #f0f0f5;
    }
    #__wa-form .meta { font-size: 11px; color: #8888a0; margin-bottom: 10px; line-height: 1.6; }
    #__wa-form .meta code { font-family: monospace; color: #c4baff; background: #7c6aff18; padding: 1px 5px; border-radius: 4px; }
    #__wa-form .meta .src { color: #4a4a5a; font-family: monospace; }
    #__wa-form textarea {
      width: 100%; box-sizing: border-box; background: #0c0c0f; color: #f0f0f5;
      border: 1px solid #34344a; border-radius: 8px; padding: 9px;
      font-size: 13px; resize: none; outline: none; font-family: inherit; display: block;
    }
    #__wa-form textarea:focus { border-color: #7c6aff; }
    #__wa-form .actions { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
    #__wa-form button { border: none; border-radius: 8px; padding: 7px 16px; font-size: 12px; cursor: pointer; font-family: inherit; font-weight: 600; }
    #__wa-form .cancel { background: #26263a; color: #9a9ab0; }
    #__wa-form .cancel:hover { background: #34344a; }
    #__wa-form .send { background: #7c6aff; color: #fff; }
    #__wa-form .send:hover { background: #6a57f0; }
    #__wa-form .send:disabled { opacity: .5; cursor: not-allowed; }
  `;
  document.head.appendChild(style);

  // ── Annotating indicator bar ────────────────────────────────────────────────

  function showIndicator() {
    if (indicator) indicator.remove();
    indicator = document.createElement("div");
    indicator.id = "__wa-bar";
    indicator.innerHTML = `
      <span class="pulse"></span>
      <span class="label">Annotating</span>
      ${cardTitle ? `<span class="card">· ${escHtml(cardTitle)}</span>` : ""}
      <span class="hint">· click an element</span>
      <span class="exit">Esc to exit</span>
    `;
    document.body.appendChild(indicator);

    // Fade the bar out of the way while the cursor is over it, so the element
    // hidden underneath stays visible (and selectable — the bar is click-through).
    barMove = (e) => {
      if (!indicator) return;
      const r = indicator.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      indicator.classList.toggle("faded", over);
    };
    document.addEventListener("mousemove", barMove, true);
  }

  function hideIndicator() {
    if (barMove) { document.removeEventListener("mousemove", barMove, true); barMove = null; }
    if (indicator) { indicator.remove(); indicator = null; }
  }

  // ── Activation ──────────────────────────────────────────────────────────────

  function activate() {
    chrome.storage.local.get(["serverUrl", "workspaceId", "cardId", "cardTitle"], (d) => {
      serverUrl = d.serverUrl ?? null;
      workspaceId = d.workspaceId ?? null;
      cardId = d.cardId ?? null;
      cardTitle = d.cardTitle ?? null;
      if (!serverUrl || !workspaceId || !cardId) return;
      active = true;
      document.body.style.cursor = "crosshair";
      showIndicator();
    });
  }
  window.__whippedActivate = activate;

  function deactivate() {
    active = false;
    document.body.style.cursor = "";
    if (hl) { hl.classList.remove("__wa-hl"); hl = null; }
    removeForm();
    hideIndicator();
  }

  function inOwnUi(target) {
    return (indicator && indicator.contains(target)) || (form && form.contains(target));
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
        resolve({});
      }, 5000);

      function listener(e) {
        if (e.source !== window) return;
        if (e.data?.type !== "__WA_REACT_RESULT") return;
        if (e.data.requestId !== requestId) return;
        clearTimeout(timer);
        cleanup();
        const result = e.data.result || {};
        resolve({
          componentName: result.componentName || null,
          componentChain: result.componentChain || null,
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
    const chainText = Array.isArray(ri.componentChain) && ri.componentChain.length
      ? ri.componentChain.join(" → ")
      : ri.componentName;
    form.innerHTML = `
      <div class="meta">
        ${cardTitle ? `<div>📌 ${escHtml(cardTitle)}</div>` : ""}
        <div>🎯 <code>${escHtml(selector)}</code></div>
        ${chainText ? `<div>⚛ ${escHtml(chainText)}</div>` : ""}
        ${shortFile ? `<div class="src">📄 ${escHtml(shortFile)}${ri.sourceLine ? ":" + ri.sourceLine : ""}</div>` : ""}
      </div>
      <textarea rows="3" placeholder="Describe the change…"></textarea>
      <div class="actions">
        <button class="cancel">Cancel</button>
        <button class="send">Send</button>
      </div>
    `;
    // Render off-screen first so we can measure the real size before placing it
    form.style.left = "-9999px";
    form.style.top = "0";
    document.body.appendChild(form);
    const rect = form.getBoundingClientRect();
    const fw = rect.width, fh = rect.height;
    const margin = 8, gap = 12;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left;
    if (x + gap + fw <= vw - margin) left = x + gap;
    else if (x - gap - fw >= margin) left = x - gap - fw;
    else left = Math.max(margin, vw - fw - margin);
    let top;
    if (y + gap + fh <= vh - margin) top = y + gap;
    else if (y - gap - fh >= margin) top = y - gap - fh;
    else top = Math.max(margin, vh - fh - margin);
    form.style.left = left + "px";
    form.style.top = top + "px";

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
          workspaceId,
          cardId,
          summary: text,
          visualComment: {
            pageUrl: window.location.href,
            elementSelector: selector,
            elementText: elementText || undefined,
            componentName: ri.componentName || undefined,
            componentChain: ri.componentChain || undefined,
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
          const authErr = Boolean(res?.error) && /authenticated|\b401\b/i.test(res.error);
          alert(authErr ? "Sign in required — open the Whipped extension to log in." : "Failed: " + (res?.error ?? "unknown error"));
        }
      });
    });

    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.querySelector(".send").click(); }
      if (e.key === "Escape") { e.stopPropagation(); removeForm(); }
    });
  }

  // ── Element selection (gated on `active`) ──────────────────────────────────

  document.addEventListener("mouseover", (e) => {
    if (!active || inOwnUi(e.target)) return;
    if (hl) hl.classList.remove("__wa-hl");
    hl = e.target;
    if (hl) hl.classList.add("__wa-hl");
  }, true);

  document.addEventListener("click", (e) => {
    if (!active || inOwnUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (hl) hl.classList.remove("__wa-hl");
    void showCommentForm(e.target, e.clientX, e.clientY);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (active && !form && e.key === "Escape") deactivate();
  });

  // ── Messages from the popup ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "START_ANNOTATING") activate();
    if (msg.type === "STOP_ANNOTATING") deactivate();
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
      {
        serverUrl: ctx.serverUrl,
        workspaceId: ctx.workspaceId,
        cardId: ctx.cardId,
        cardTitle: ctx.cardTitle || ctx.cardId,
      },
      () => {
        activate();
        cleanHash();
      },
    );
  }
})();
