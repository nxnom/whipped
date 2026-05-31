const serverUrlEl = document.getElementById("serverUrl");
const passwordEl = document.getElementById("password");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

chrome.storage.local.get("serverUrl", (data) => {
  serverUrlEl.value = data.serverUrl || "http://localhost:50007";
});

const sendMessage = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

for (const el of [serverUrlEl, passwordEl]) {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
  });
}

saveBtn.addEventListener("click", async () => {
  const url = serverUrlEl.value.trim().replace(/\/$/, "");
  const password = passwordEl.value;
  if (!url) { setStatus("Enter the URL", "err"); return; }
  if (!/^https?:\/\//i.test(url)) { setStatus("Must start with http:// or https://", "err"); return; }

  saveBtn.disabled = true;

  // Sign in first (if a password was given) so the session cookie is set, then
  // verify by fetching projects.
  try {
    if (password) {
      setStatus("Signing in…");
      const login = await sendMessage({ type: "LOGIN", serverUrl: url, password });
      if (!login?.ok) throw new Error(login?.error ?? "Sign-in failed");
    }
    setStatus("Verifying…");
    const res = await sendMessage({ type: "FETCH_WORKSPACES", serverUrl: url });
    if (!res?.ok) throw new Error(res?.error ?? "Could not reach server");
  } catch (err) {
    setStatus(err.message, "err");
    saveBtn.disabled = false;
    return;
  }

  chrome.storage.local.set({ serverUrl: url }, () => {
    setStatus("Saved. Opening annotator on the active tab…", "ok");
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "OPEN_PANEL" }, () => {
        window.close();
      });
    }, 600);
  });
});

function setStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = "status show" + (type ? " " + type : "");
}
