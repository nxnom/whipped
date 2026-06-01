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
  // Elements collected for the comment currently being written. Each entry:
  // { el, selector, elementText, ri, badgeEl }. One comment can reference many.
  let selections = [];
  let onViewportChange = null;
  let dragging = false;

  // "comment" = leave a visual comment on an existing card (default).
  // "create"  = two-step wizard that creates a new task (step 1: describe +
  //             pick elements, step 2: configure). Set by the popup.
  let mode = "comment";
  let createStep = 1;
  let createOptions = null; // { workflows, branches:{branches,defaultBranch}, cards:[{id,title}] }
  const createCfg = {
    description: "",
    priority: "",
    workflowId: "",
    baseRef: "",
    branchName: "",
    relationType: "waits",
    waits: [], // [{ id, title }]
    dependsOn: "",
    autoStart: true,
  };

  const CREATE_PRIORITIES = [
    { val: "urgent", label: "Urgent", color: "#ef4444" },
    { val: "high", label: "High", color: "#f59e0b" },
    { val: "medium", label: "Medium", color: "#eab308" },
    { val: "low", label: "Low", color: "#6b7280" },
  ];

  // Distinct colors so each referenced element — its page outline, its badge,
  // and the `#N` mention in the textarea — share one identity.
  const PALETTE = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc", "#f472b6", "#22d3ee", "#a3e635"];
  const colorFor = (i) => PALETTE[i % PALETTE.length];

  // ── Styles ────────────────────────────────────────────────────────────────

  const style = document.createElement("style");
  style.textContent = `
    .__wa-hl {
      outline: 2px solid #7c6aff !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }

    .__wa-badge {
      position: fixed; z-index: 2147483646; pointer-events: none;
      min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      color: #0c0c0f; border-radius: 9px; font-weight: 700;
      font: 700 11px/1 -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 2px 6px rgba(0,0,0,.5);
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
      position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;
      max-height: 75vh; overflow: hidden; display: flex; flex-direction: column;
      background: #16161c; border: 1px solid #34344a; border-radius: 12px;
      padding: 14px; width: 380px; box-shadow: 0 16px 48px rgba(0,0,0,.6);
      font-family: -apple-system, sans-serif; color: #f0f0f5;
    }
    #__wa-form .header {
      display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
      cursor: move; user-select: none; -webkit-user-select: none;
    }
    #__wa-form .header .grip { color: #4a4a5a; font-size: 13px; letter-spacing: -2px; }
    #__wa-form .header .htitle { font-size: 12px; color: #c4baff; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #__wa-form .els { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    #__wa-form .el {
      display: flex; align-items: flex-start; gap: 8px;
      background: #ffffff08; border: 1px solid #ffffff14; border-left-width: 3px; border-radius: 8px; padding: 7px 8px;
    }
    #__wa-form .el .num {
      flex-shrink: 0; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      color: #0c0c0f; border-radius: 9px; font-size: 11px; font-weight: 700;
    }
    #__wa-form .el-meta { flex: 1; min-width: 0; font-size: 11px; color: #8888a0; line-height: 1.5; }
    #__wa-form .el-meta code { font-family: monospace; color: #c4baff; word-break: break-all; }
    #__wa-form .el-meta .chain { color: #6a6a80; }
    #__wa-form .el-meta .src { color: #4a4a5a; font-family: monospace; }
    #__wa-form .el .rm {
      flex-shrink: 0; background: transparent; border: none; color: #6a6a80;
      font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px;
    }
    #__wa-form .el .rm:hover { color: #f0f0f5; }
    #__wa-form .add-hint { font-size: 11px; color: #60607a; margin-bottom: 8px; }
    #__wa-form .ta-wrap { position: relative; }
    #__wa-form .ta-backdrop, #__wa-form textarea {
      width: 100%; box-sizing: border-box; margin: 0;
      border: 1px solid #34344a; border-radius: 8px; padding: 9px;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
      white-space: pre-wrap; overflow-wrap: break-word; word-break: normal;
    }
    #__wa-form .ta-backdrop {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none;
      border-color: transparent; background: #0c0c0f; color: #f0f0f5; z-index: 0;
    }
    #__wa-form .ta-backdrop mark { padding: 0; border-radius: 3px; color: #0c0c0f; }
    #__wa-form textarea {
      position: relative; z-index: 1; display: block; resize: vertical; outline: none;
      min-height: 84px; background: transparent; color: transparent;
      -webkit-text-fill-color: transparent; caret-color: #f0f0f5;
    }
    #__wa-form textarea:focus { border-color: #7c6aff; }
    #__wa-form textarea::selection { background: #7c6aff55; -webkit-text-fill-color: #f0f0f5; }
    #__wa-form .actions { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }
    #__wa-form button { border: none; border-radius: 8px; padding: 7px 16px; font-size: 12px; cursor: pointer; font-family: inherit; font-weight: 600; }
    #__wa-form .cancel { background: #26263a; color: #9a9ab0; }
    #__wa-form .cancel:hover { background: #34344a; }
    #__wa-form .send { background: #7c6aff; color: #fff; }
    #__wa-form .send:hover { background: #6a57f0; }
    #__wa-form .send:disabled { opacity: .5; cursor: not-allowed; }

    /* Create-task config step */
    #__wa-form .cfg { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    #__wa-form .cfg > label { font-size: 10px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #6a6a80; }
    #__wa-form select, #__wa-form input[type="text"] {
      width: 100%; box-sizing: border-box; background: #0c0c0f; color: #f0f0f5;
      border: 1px solid #34344a; border-radius: 8px; padding: 9px; font-size: 13px;
      font-family: inherit; outline: none;
    }
    #__wa-form select:focus, #__wa-form input[type="text"]:focus { border-color: #7c6aff; }
    #__wa-form .pri-row { display: flex; gap: 6px; }
    #__wa-form .pri {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
      background: #0c0c0f; border: 1px solid #34344a; border-radius: 8px; color: #8888a0;
      font-size: 11px; font-weight: 600; padding: 7px 3px;
    }
    #__wa-form .pri .pdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    #__wa-form .pri[data-active="true"] { color: #f0f0f5; background: #1d1d26; border-color: #4a4a5a; }
    #__wa-form .seg { display: flex; gap: 4px; padding: 3px; background: #0c0c0f; border: 1px solid #34344a; border-radius: 8px; }
    #__wa-form .seg button { flex: 1; padding: 7px; border-radius: 6px; background: transparent; color: #8888a0; font-size: 12px; }
    #__wa-form .seg button.on { background: #1d1d26; color: #f0f0f5; }
    #__wa-form .subhint { font-size: 11px; color: #60607a; line-height: 1.45; }
    #__wa-form .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    #__wa-form .chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; background: #1d1d26; border: 1px solid #34344a; border-radius: 999px; padding: 3px 6px 3px 10px; font-size: 11px; color: #c4c4d4; }
    #__wa-form .chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
    #__wa-form .chip button { background: none; color: #6a6a80; font-size: 14px; padding: 0 2px; }
    #__wa-form .chip button:hover { color: #f0f0f5; }
    #__wa-form .switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; font-weight: 600; color: #c4c4d4; }
    #__wa-form .switch input { display: none; }
    #__wa-form .switch .track { width: 34px; height: 19px; border-radius: 999px; flex-shrink: 0; position: relative; background: #1d1d26; border: 1px solid #4a4a5a; transition: background .15s; }
    #__wa-form .switch .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #8a8a9e; transition: transform .15s, background .15s; }
    #__wa-form .switch input:checked + .track { background: #7c6aff; border-color: #7c6aff; }
    #__wa-form .switch input:checked + .track::after { transform: translateX(15px); background: #fff; }
    #__wa-form .step-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 16px; }
    #__wa-form .err { font-size: 11px; color: #ffb4b4; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.25); border-radius: 8px; padding: 8px; margin-top: 8px; }
    #__wa-toast {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      background: #16161c; border: 1px solid #34344a; border-radius: 10px;
      padding: 10px 14px; color: #34d399; font: 600 13px -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 8px 30px rgba(0,0,0,.45);
    }
  `;
  document.head.appendChild(style);

  // ── Annotating indicator bar ────────────────────────────────────────────────

  function showIndicator() {
    if (indicator) indicator.remove();
    indicator = document.createElement("div");
    indicator.id = "__wa-bar";
    indicator.innerHTML = `
      <span class="pulse"></span>
      <span class="label">${mode === "create" ? "New task" : "Annotating"}</span>
      ${mode !== "create" && cardTitle ? `<span class="card">· ${escHtml(cardTitle)}</span>` : ""}
      <span class="hint">· click elements${mode === "create" ? " (optional)" : ""}</span>
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
    chrome.storage.local.get(["serverUrl", "workspaceId", "cardId", "cardTitle", "mode"], (d) => {
      serverUrl = d.serverUrl ?? null;
      workspaceId = d.workspaceId ?? null;
      cardId = d.cardId ?? null;
      cardTitle = d.cardTitle ?? null;
      mode = d.mode === "create" ? "create" : "comment";
      // A comment needs a target card; creating a task only needs the workspace.
      if (!serverUrl || !workspaceId || (mode !== "create" && !cardId)) return;
      active = true;
      createStep = 1;
      document.body.style.cursor = "crosshair";
      showIndicator();
      if (!onViewportChange) {
        onViewportChange = () => positionBadges();
        window.addEventListener("scroll", onViewportChange, true);
        window.addEventListener("resize", onViewportChange, true);
      }
      // In create mode the description is required but elements are optional, so
      // open the form right away instead of waiting for the first element click.
      if (mode === "create") renderForm();
    });
  }
  window.__whippedActivate = activate;

  function deactivate() {
    active = false;
    document.body.style.cursor = "";
    if (hl) { hl.classList.remove("__wa-hl"); hl = null; }
    closeForm();
    hideIndicator();
    if (onViewportChange) {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange, true);
      onViewportChange = null;
    }
    resetCreateState();
  }

  function resetCreateState() {
    createStep = 1;
    createOptions = null;
    createCfg.description = "";
    createCfg.priority = "";
    createCfg.workflowId = "";
    createCfg.baseRef = "";
    createCfg.branchName = "";
    createCfg.relationType = "waits";
    createCfg.waits = [];
    createCfg.dependsOn = "";
    createCfg.autoStart = true;
  }

  function inOwnUi(target) {
    return (indicator && indicator.contains(target)) || (form && form.contains(target));
  }

  // ── Comment form ──────────────────────────────────────────────────────────

  function clearSelections() {
    for (const s of selections) {
      s.el.style.removeProperty("outline");
      s.el.style.removeProperty("outline-offset");
      s.badgeEl.remove();
    }
    selections = [];
  }

  // Re-applies each element's outline + badge color to match its current index,
  // so colors stay in sync after a removal renumbers the list.
  function recolorSelections() {
    selections.forEach((s, i) => {
      const c = colorFor(i);
      s.el.style.setProperty("outline", `2px solid ${c}`, "important");
      s.el.style.setProperty("outline-offset", "2px", "important");
      s.badgeEl.style.background = c;
    });
  }

  // Closes the form and drops every collected element (outlines + badges).
  function closeForm() {
    if (form) { form.remove(); form = null; }
    clearSelections();
  }

  // Small standalone confirmation, independent of the form so it survives the
  // form being torn down. Self-removes after a moment.
  function showToast(text) {
    const t = document.createElement("div");
    t.id = "__wa-toast";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }

  // Inline error inside the current form (no native alert — it's jarring on the
  // host page). Inserted above whichever footer the active step renders.
  function showFormError(text) {
    if (!form) return;
    let box = form.querySelector(".err");
    if (!box) {
      box = document.createElement("div");
      box.className = "err";
      const foot = form.querySelector(".step-foot") || form.querySelector(".actions");
      foot ? form.insertBefore(box, foot) : form.appendChild(box);
    }
    box.textContent = text;
  }

  function positionBadges() {
    selections.forEach((s, i) => {
      const r = s.el.getBoundingClientRect();
      s.badgeEl.textContent = String(i + 1);
      s.badgeEl.style.left = `${Math.max(2, r.left)}px`;
      s.badgeEl.style.top = `${Math.max(2, r.top)}px`;
    });
  }

  function removeSelection(idx) {
    const removedNum = idx + 1;
    const [s] = selections.splice(idx, 1);
    if (s) {
      s.el.style.removeProperty("outline");
      s.el.style.removeProperty("outline-offset");
      s.badgeEl.remove();
    }
    // A comment with no elements left has nothing to attach to; a task can still
    // be created with a description alone, so keep its form open.
    if (!selections.length && mode !== "create") { closeForm(); return; }
    const ta = form?.querySelector("textarea");
    if (ta) {
      ta.value = renumberMentions(ta.value, removedNum);
      if (mode === "create") createCfg.description = ta.value;
    }
    recolorSelections();
    positionBadges();
    renderForm();
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

  // Adds a clicked element to the current comment's selection, then (re)renders
  // the form. The form stays open so further clicks keep appending elements.
  async function addSelection(el) {
    if (selections.some((s) => s.el === el)) return;
    const selector = cssSelector(el);
    const rawText = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    const elementText = rawText.slice(0, 300);
    const ri = await reactInfoAsync(el);

    el.classList.remove("__wa-hl");
    const badgeEl = document.createElement("div");
    badgeEl.className = "__wa-badge";
    document.body.appendChild(badgeEl);

    selections.push({ el, selector, elementText, ri, badgeEl });
    recolorSelections();
    positionBadges();
    renderForm();
  }

  function selectionMetaHtml(s, i) {
    const chain = Array.isArray(s.ri.componentChain) && s.ri.componentChain.length
      ? s.ri.componentChain.join(" → ")
      : s.ri.componentName;
    const shortFile = s.ri.sourceFile ? s.ri.sourceFile.split("/").slice(-2).join("/") : null;
    const c = colorFor(i);
    return `
      <div class="el" style="border-left-color:${c}">
        <span class="num" style="background:${c}">${i + 1}</span>
        <div class="el-meta">
          <div><code>${escHtml(s.selector)}</code></div>
          ${chain ? `<div class="chain">🧩 ${escHtml(chain)}</div>` : ""}
          ${shortFile ? `<div class="src">📄 ${escHtml(shortFile)}${s.ri.sourceLine ? ":" + s.ri.sourceLine : ""}</div>` : ""}
        </div>
        <button class="rm" data-idx="${i}" title="Remove">×</button>
      </div>
    `;
  }

  // Keeps textarea `#N` references in sync when element `removedNum` is dropped:
  // its own mention is deleted and every higher reference shifts down by one,
  // matching how the remaining elements renumber.
  function renumberMentions(text, removedNum) {
    return text.replace(/#(\d+)( ?)/g, (m, n, sp) => {
      const num = Number(n);
      if (num === removedNum) return "";
      if (num > removedNum) return `#${num - 1}${sp}`;
      return m;
    });
  }

  // Mirrors the textarea text into the backdrop, wrapping each valid `#N`
  // reference in a chip colored to match element N.
  function renderBackdrop(backdrop, text) {
    const html = escHtml(text).replace(/#(\d+)/g, (m, n) => {
      const idx = Number(n) - 1;
      if (idx < 0 || idx >= selections.length) return m;
      return `<mark style="background:${colorFor(idx)}">#${n}</mark>`;
    });
    backdrop.innerHTML = text.endsWith("\n") ? `${html}\n` : html;
  }

  function makeDraggable(handle) {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const rect = form.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      form.style.right = "auto";
      form.style.bottom = "auto";
      dragging = true;
      const onMove = (ev) => {
        const maxL = window.innerWidth - form.offsetWidth - 4;
        const maxT = window.innerHeight - form.offsetHeight - 4;
        form.style.left = `${Math.max(4, Math.min(ev.clientX - offX, maxL))}px`;
        form.style.top = `${Math.max(4, Math.min(ev.clientY - offY, maxT))}px`;
      };
      const onUp = () => {
        dragging = false;
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      };
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    });
  }

  function renderForm() {
    if (!form) {
      form = document.createElement("div");
      form.id = "__wa-form";
      document.body.appendChild(form);
    }
    if (mode === "create" && createStep === 2) { renderCreateConfig(); return; }
    renderDescribeStep();
  }

  // Step shared by comments and create-step-1: element basket + description.
  function renderDescribeStep() {
    const isCreate = mode === "create";
    const prevText = isCreate ? createCfg.description : (form.querySelector("textarea")?.value ?? "");
    const title = isCreate ? "New task" : cardTitle ? `📌 ${escHtml(cardTitle)}` : "New comment";
    const hint = isCreate
      ? "Click elements to reference them by number (optional), then describe the task."
      : "Click more elements to reference them by number, then describe the change.";
    const placeholder = isCreate
      ? "Describe the task… (reference elements by number, e.g. #1, #2)"
      : "Describe the change… (reference elements by number, e.g. #1, #2)";
    form.innerHTML = `
      <div class="header">
        <span class="grip">⠿</span>
        <span class="htitle">${title}</span>
      </div>
      <div class="els">${selections.map((s, i) => selectionMetaHtml(s, i)).join("")}</div>
      <div class="add-hint">${hint}</div>
      <div class="ta-wrap">
        <div class="ta-backdrop"></div>
        <textarea rows="5" placeholder="${placeholder}"></textarea>
      </div>
      <div class="actions">
        <button class="cancel">Cancel</button>
        <button class="send">${isCreate ? "Next →" : "Send"}</button>
      </div>
    `;

    const ta = form.querySelector("textarea");
    const backdrop = form.querySelector(".ta-backdrop");
    ta.value = prevText;
    renderBackdrop(backdrop, prevText);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const onCancel = isCreate ? deactivate : closeForm;
    const onPrimary = isCreate ? () => goToConfig(ta) : () => submitComment(ta);

    makeDraggable(form.querySelector(".header"));
    for (const btn of form.querySelectorAll(".rm")) {
      btn.addEventListener("click", () => removeSelection(Number(btn.dataset.idx)));
    }
    form.querySelector(".cancel").addEventListener("click", onCancel);
    form.querySelector(".send").addEventListener("click", onPrimary);

    ta.addEventListener("input", () => {
      if (isCreate) createCfg.description = ta.value;
      renderBackdrop(backdrop, ta.value);
    });
    ta.addEventListener("scroll", () => { backdrop.scrollTop = ta.scrollTop; });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onPrimary(); }
      if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    });
  }

  function submitComment(ta) {
    const text = ta.value.trim();
    if (!text || !selections.length) return;
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
          elements: selections.map((s) => ({
            elementSelector: s.selector,
            elementText: s.elementText || undefined,
            componentName: s.ri.componentName || undefined,
            componentChain: s.ri.componentChain || undefined,
            sourceFile: s.ri.sourceFile || undefined,
            sourceLine: s.ri.sourceLine || undefined,
          })),
        },
      },
    }, (res) => {
      if (res?.ok) {
        closeForm();
      } else {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        const authErr = Boolean(res?.error) && /authenticated|\b401\b/i.test(res.error);
        showFormError(authErr ? "Sign in required — open the Whipped extension to log in." : `Failed: ${res?.error ?? "unknown error"}`);
      }
    });
  }

  // ── Create-task: step 2 (configuration) ─────────────────────────────────────

  function goToConfig(ta) {
    if (!ta.value.trim()) { ta.focus(); return; }
    createCfg.description = ta.value;
    createStep = 2;
    renderForm();
    if (!createOptions) loadCreateOptions();
  }

  function extractActiveCards(state) {
    const board = state?.board ?? { cards: {}, columns: [] };
    const activeColIds = ["todo", "in_progress", "reopened", "ready_for_review", "blocked"];
    const activeIds = new Set(
      (board.columns ?? []).filter((c) => activeColIds.includes(c.id)).flatMap((c) => c.taskIds ?? []),
    );
    return Object.values(board.cards ?? {})
      .filter((c) => activeIds.has(c.id))
      .map((c) => ({ id: c.id, title: c.description?.split("\n")[0] ?? c.id }));
  }

  function loadCreateOptions() {
    chrome.runtime.sendMessage({ type: "GET_CREATE_OPTIONS", payload: { serverUrl, workspaceId } }, (res) => {
      if (!res?.ok) {
        createOptions = { error: res?.error || "Couldn't load task options." };
      } else {
        const workflows = (Array.isArray(res.workflows) ? res.workflows : []).filter((w) => !w.forStory);
        const branches = res.branches || { branches: [], defaultBranch: "" };
        createOptions = { workflows, branches, cards: extractActiveCards(res.state) };
        if (!createCfg.workflowId && workflows.length) {
          createCfg.workflowId = (workflows.find((w) => w.isDefault) ?? workflows[0]).id;
        }
        if (!createCfg.baseRef && branches.defaultBranch) createCfg.baseRef = branches.defaultBranch;
      }
      if (mode === "create" && createStep === 2) renderCreateConfig();
    });
  }

  function relOptionsHtml() {
    const cards = createOptions?.cards ?? [];
    const isWaits = createCfg.relationType === "waits";
    const taken = new Set(isWaits ? createCfg.waits.map((w) => w.id) : []);
    return `<option value="">${isWaits ? "Add a task…" : "None"}</option>` +
      cards.filter((c) => !taken.has(c.id)).map((c) =>
        `<option value="${escHtml(c.id)}" ${!isWaits && createCfg.dependsOn === c.id ? "selected" : ""}>${escHtml(c.title)}</option>`,
      ).join("");
  }

  function configBodyHtml(opts) {
    const pills = CREATE_PRIORITIES.map((p) =>
      `<button class="pri" data-pri="${p.val}" data-active="${createCfg.priority === p.val}"><span class="pdot" style="background:${p.color}"></span>${p.label}</button>`,
    ).join("");
    const wfOpts = opts.workflows.length
      ? opts.workflows.map((w) =>
          `<option value="${escHtml(w.id)}" ${createCfg.workflowId === w.id ? "selected" : ""}>${escHtml(w.name)}${w.isDefault ? " (default)" : ""}</option>`,
        ).join("")
      : `<option value="">Default</option>`;
    const branchList = Array.isArray(opts.branches.branches) ? opts.branches.branches : [];
    const baseOpts = branchList.length
      ? branchList.map((b) => `<option value="${escHtml(b)}" ${createCfg.baseRef === b ? "selected" : ""}>${escHtml(b)}</option>`).join("")
      : `<option value="">—</option>`;
    const isWaits = createCfg.relationType === "waits";
    const chips = createCfg.waits.map((c, i) =>
      `<div class="chip"><span>${escHtml(c.title)}</span><button data-chip="${i}" title="Remove">×</button></div>`,
    ).join("");
    return `
      <div class="cfg"><label>Workflow</label><select data-f="workflow" ${opts.workflows.length ? "" : "disabled"}>${wfOpts}</select></div>
      <div class="cfg"><label>Priority</label><div class="pri-row">${pills}</div></div>
      <div class="cfg"><label>Branch name (optional)</label><input type="text" data-f="branch" placeholder="auto-generated from description" value="${escHtml(createCfg.branchName)}"></div>
      <div class="cfg"><label>Base branch</label><select data-f="base" ${branchList.length ? "" : "disabled"}>${baseOpts}</select></div>
      <div class="cfg">
        <label>Relation</label>
        <div class="seg"><button data-rel="waits" class="${isWaits ? "on" : ""}">Waits for</button><button data-rel="depends" class="${isWaits ? "" : "on"}">Depends on</button></div>
        ${isWaits ? `<div class="subhint">Starts in a fresh branch once all of these are merged.</div>` : ""}
        <select data-f="rel" ${(createOptions?.cards?.length ?? 0) ? "" : "disabled"}>${relOptionsHtml()}</select>
        <div class="chips" ${isWaits ? "" : `style="display:none"`}>${chips}</div>
      </div>
      <label class="switch"><input type="checkbox" data-f="autostart" ${createCfg.autoStart ? "checked" : ""}><span class="track"></span>Auto-start</label>
    `;
  }

  function wireConfigControls() {
    const q = (sel) => form.querySelector(sel);
    q('[data-f="workflow"]')?.addEventListener("change", (e) => { createCfg.workflowId = e.target.value; });
    q('[data-f="base"]')?.addEventListener("change", (e) => { createCfg.baseRef = e.target.value; });
    q('[data-f="branch"]')?.addEventListener("input", (e) => { createCfg.branchName = e.target.value; });
    q('[data-f="autostart"]')?.addEventListener("change", (e) => { createCfg.autoStart = e.target.checked; });
    for (const b of form.querySelectorAll(".pri")) {
      b.addEventListener("click", () => {
        createCfg.priority = createCfg.priority === b.dataset.pri ? "" : b.dataset.pri;
        renderCreateConfig();
      });
    }
    for (const b of form.querySelectorAll(".seg button")) {
      b.addEventListener("click", () => {
        createCfg.relationType = b.dataset.rel;
        createCfg.waits = [];
        createCfg.dependsOn = "";
        renderCreateConfig();
      });
    }
    const rel = q('[data-f="rel"]');
    rel?.addEventListener("change", () => {
      if (createCfg.relationType === "waits") {
        const c = (createOptions?.cards ?? []).find((x) => x.id === rel.value);
        if (c && !createCfg.waits.some((w) => w.id === c.id)) createCfg.waits.push(c);
        renderCreateConfig();
      } else {
        createCfg.dependsOn = rel.value;
      }
    });
    for (const btn of form.querySelectorAll(".chip button")) {
      btn.addEventListener("click", () => {
        createCfg.waits.splice(Number(btn.dataset.chip), 1);
        renderCreateConfig();
      });
    }
  }

  function renderCreateConfig() {
    const opts = createOptions;
    const ready = opts && !opts.error;
    form.innerHTML = `
      <div class="header">
        <span class="grip">⠿</span>
        <span class="htitle">Configure task</span>
      </div>
      ${!opts ? `<div class="subhint">Loading options…</div>` : opts.error ? `<div class="err">${escHtml(opts.error)}</div>` : configBodyHtml(opts)}
      <div class="step-foot">
        <button class="cancel" data-act="back">← Back</button>
        <button class="send" data-act="create" ${ready ? "" : "disabled"}>+ Create Task</button>
      </div>
    `;
    makeDraggable(form.querySelector(".header"));
    form.querySelector('[data-act="back"]').addEventListener("click", () => { createStep = 1; renderForm(); });
    if (ready) {
      wireConfigControls();
      form.querySelector('[data-act="create"]').addEventListener("click", submitCreate);
    }
  }

  function submitCreate() {
    const description = createCfg.description.trim();
    if (!description) { createStep = 1; renderForm(); return; }
    const btn = form.querySelector('[data-act="create"]');
    btn.disabled = true;
    btn.textContent = "Creating…";
    const elements = selections.map((s) => ({
      elementSelector: s.selector,
      elementText: s.elementText || undefined,
      componentName: s.ri.componentName || undefined,
      componentChain: s.ri.componentChain || undefined,
      sourceFile: s.ri.sourceFile || undefined,
      sourceLine: s.ri.sourceLine || undefined,
    }));
    const body = {
      workspaceId,
      description,
      priority: createCfg.priority || undefined,
      workflowId: createCfg.workflowId || undefined,
      baseRef: createCfg.baseRef || undefined,
      branchName: createCfg.branchName.trim() || undefined,
      readyForDev: createCfg.autoStart || undefined,
      waitsFor: createCfg.relationType === "waits" && createCfg.waits.length ? createCfg.waits.map((w) => w.id) : undefined,
      dependsOn: createCfg.relationType === "depends" && createCfg.dependsOn ? createCfg.dependsOn : undefined,
      visualComment: elements.length ? { pageUrl: window.location.href, elements } : undefined,
    };
    chrome.runtime.sendMessage({ type: "CREATE_TASK", payload: { serverUrl, body } }, (res) => {
      if (res?.ok) {
        deactivate();
        showToast("✓ Task created");
      } else {
        btn.disabled = false;
        btn.textContent = "+ Create Task";
        const authErr = Boolean(res?.error) && /authenticated|\b401\b/i.test(res.error);
        showFormError(authErr ? "Sign in required — open the Whipped extension to log in." : `Failed: ${res?.error ?? "unknown error"}`);
      }
    });
  }

  // ── Element selection (gated on `active`) ──────────────────────────────────

  // Element picking is live for comments and for create step 1 only.
  const picking = () => active && !dragging && !(mode === "create" && createStep !== 1);

  document.addEventListener("mouseover", (e) => {
    if (!picking() || inOwnUi(e.target)) return;
    if (hl) hl.classList.remove("__wa-hl");
    hl = selections.some((s) => s.el === e.target) ? null : e.target;
    if (hl) hl.classList.add("__wa-hl");
  }, true);

  document.addEventListener("click", (e) => {
    if (!picking() || inOwnUi(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (hl) hl.classList.remove("__wa-hl");
    void addSelection(e.target);
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
