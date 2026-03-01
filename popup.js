// Scan test-flows/ directory and let user pick a flow to run

(async function () {
  const contentEl = document.getElementById("content");
  const flows = await loadFlowIndex();

  if (flows.length === 0) {
    contentEl.innerHTML = '<div class="empty">No flows found in test-flows/</div>';
    return;
  }

  // Load all flow JSON files
  const payloads = {};
  for (const name of flows) {
    try {
      const url = chrome.runtime.getURL(`test-flows/${name}`);
      const res = await fetch(url);
      payloads[name] = await res.json();
    } catch (e) {
      console.warn(`Failed to load ${name}:`, e);
    }
  }

  const names = Object.keys(payloads);
  if (names.length === 0) {
    contentEl.innerHTML = '<div class="empty">No valid flows found</div>';
    return;
  }

  contentEl.innerHTML = `
    <label>Test Flow</label>
    <select id="flow-select">${names.map((n) => `<option value="${n}">${formatName(n)}</option>`).join("")}</select>
    <div class="workflow-info">
      <div class="workflow-name" id="wf-name"></div>
      <div class="workflow-desc" id="wf-desc"></div>
      <div class="step-count" id="wf-steps"></div>
    </div>
    <button id="start-btn">Start Onboarding</button>
  `;

  const select = document.getElementById("flow-select");
  const nameEl = document.getElementById("wf-name");
  const descEl = document.getElementById("wf-desc");
  const stepsEl = document.getElementById("wf-steps");
  const btn = document.getElementById("start-btn");

  function showInfo(key) {
    const p = payloads[key];
    nameEl.textContent = p.workflow.name;
    descEl.textContent = p.workflow.description;
    stepsEl.textContent = `${p.workflow.steps.length} step${p.workflow.steps.length !== 1 ? "s" : ""}`;
  }

  select.addEventListener("change", () => showInfo(select.value));
  showInfo(names[0]);

  btn.addEventListener("click", async () => {
    const payload = payloads[select.value];
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: "startTour", payload });
    }
    window.close();
  });
})();

/** Load the flow index file listing all JSON filenames. */
async function loadFlowIndex() {
  try {
    const url = chrome.runtime.getURL("test-flows/index.json");
    const res = await fetch(url);
    return await res.json();
  } catch {
    return [];
  }
}

/** Convert filename to display name: "github-create-repo.json" → "Github Create Repo" */
function formatName(filename) {
  return filename
    .replace(/\.json$/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
