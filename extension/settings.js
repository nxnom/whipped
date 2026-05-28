const serverUrlEl = document.getElementById("serverUrl");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

chrome.storage.local.get("serverUrl", (data) => {
  serverUrlEl.value = data.serverUrl || "http://localhost:50007";
});

serverUrlEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

saveBtn.addEventListener("click", async () => {
  const url = serverUrlEl.value.trim().replace(/\/$/, "");
  if (!url) { setStatus("Enter the URL", "err"); return; }
  if (!/^https?:\/\//i.test(url)) { setStatus("Must start with http:// or https://", "err"); return; }

  saveBtn.disabled = true;
  setStatus("Verifying…");

  // Verify by trying to fetch projects
  try {
    const res = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: "FETCH_WORKSPACES", serverUrl: url }, resolve)
    );
    if (!res?.ok) throw new Error(res?.error ?? "Could not reach server");
  } catch (err) {
    setStatus("Could not reach server: " + err.message, "err");
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
