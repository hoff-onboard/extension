// Hoff — Content Script Orchestrator
// Wires together HoffUI (chat + pills) and HoffTour (driver.js tours)

(function () {
  "use strict";

  // Don't run on the Hoff frontend
  if (window.location.origin === "http://localhost:5173") return;

  const BACKEND_URL = "http://localhost:8000";

  function getCookies(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getCookies", url }, (cookies) => {
        resolve(cookies || []);
      });
    });
  }

  function getOrigins() {
    const origin = window.location.origin;
    const localStorage = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const name = window.localStorage.key(i);
      localStorage.push({ name, value: window.localStorage.getItem(name) });
    }
    const sessionStorage = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const name = window.sessionStorage.key(i);
      sessionStorage.push({ name, value: window.sessionStorage.getItem(name) });
    }
    return [{ origin, localStorage, sessionStorage }];
  }

  const FRONTEND_URL = "http://localhost:5173";

  /** Route fetch through the background service worker to bypass PNA restrictions */
  function bgFetch(url, options) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "proxyFetch", url, options }, (resp) => {
        if (!resp || resp.error) return reject(new Error(resp?.error || "proxyFetch failed"));
        if (!resp.ok) return reject(new Error(`Backend responded ${resp.status}`));
        resolve(JSON.parse(resp.body));
      });
    });
  }

  async function startJob(query, url, cookies, origins, useResearch) {
    return bgFetch(`${BACKEND_URL}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, url, cookies, origins, use_research: useResearch }),
    });
    if (!res.ok) throw new Error(`Backend responded ${res.status}`);
    return await res.json(); // { job_id }
  }

  async function pollJobResult(jobId) {
    // Poll until done, then fetch the workflow from the done event
    const es = new EventSource(`${BACKEND_URL}/jobs/${jobId}/stream`);
    return new Promise((resolve, reject) => {
      let result = null;
      es.addEventListener("workflow", (e) => {
        const data = JSON.parse(e.data);
        result = data.workflow;
      });
      es.addEventListener("done", () => {
        es.close();
        resolve(result);
      });
      es.addEventListener("error", () => {
        es.close();
        reject(new Error("Job stream error"));
      });
    });
  }

  let pillIdCounter = Date.now();

  function generatePillId() {
    return "pill_" + pillIdCounter++;
  }

  /** Start a workflow from a pill click — navigate to URL if first step element isn't on page */
  async function startFromPill(payload) {
    const firstStep = payload.workflow.steps[0];
    const el = firstStep ? HoffTour.findElement(firstStep) : null;
    if (!el && payload.url) {
      HoffTour.clearState();
      await chrome.storage.local.set({
        hoff_tour_state: { payload, stepIndex: 0, lastUrl: null },
      });
      window.location.href = payload.url;
    } else {
      startWorkflow(payload);
    }
  }

  /** Start a workflow: begin the tour from step 0 */
  function startWorkflow(payload) {
    HoffUI.setTourActive(true);
    HoffUI.collapsePills();
    HoffUI.collapseChatBar();
    HoffTour.start(payload, 0);
  }

  /** Main init — runs on every page load */
  async function init() {
    // 0. Check if the frontend set a pending tour for us to play
    try {
      const pendingRaw = window.localStorage.getItem("hoff_pending_tour");
      if (pendingRaw) {
        window.localStorage.removeItem("hoff_pending_tour");
        const payload = JSON.parse(pendingRaw);
        if (payload && payload.workflow && payload.workflow.steps && payload.workflow.steps.length > 0) {
          // Store tour state so it resumes after UI init
          await chrome.storage.local.set({
            hoff_tour_state: { payload, stepIndex: 0, lastUrl: null },
          });
        }
      }
    } catch (e) {
      console.debug("Hoff: no pending tour", e);
    }

    // 1. Initialize UI (chat bar + pills)
    await HoffUI.init();

    // 2. Wire up the chat submit handler
    HoffUI.onSubmit = async (query) => {
      HoffUI.setLoading(true);

      let payload;
      try {
        const url = window.location.href;
        const cookies = await getCookies(url);
        const origins = getOrigins();
        const useResearch = HoffUI.getResearchMode();
        const { job_id } = await startJob(query, url, cookies, origins, useResearch);

        // Open frontend after a short delay so user sees the pill created
        await new Promise((r) => setTimeout(r, 3500));
        window.open(`${FRONTEND_URL}/?job=${job_id}&source=${encodeURIComponent(url)}`, "_blank");

        // Wait for the workflow result via SSE
        const workflow = await pollJobResult(job_id);
        if (workflow) {
          payload = { url, brand: null, workflow };
        }
      } catch (e) {
        console.warn("Hoff: backend error:", e);
        HoffUI.showError();
        return;
      }

      if (!payload) {
        HoffUI.showError();
        return;
      }

      HoffUI.setLoading(false);

      const id = generatePillId();
      HoffUI.addPill(id, query);
      HoffUI.completePill(id, payload);
      HoffUI.setPillClickHandler(id, () => startFromPill(payload));

      // Auto-start the tour
      startWorkflow(payload);
    };

    // 3. Wire tour collapse → show continue prompt in chat bar
    HoffTour.onCollapse = (payload, stepIndex, lastUrl) => {
      HoffUI.setTourActive(false);
      HoffUI.expandPills();
      HoffUI.expandChatBar();
      HoffUI.showContinuePrompt(
        // Yes — resume tour
        async () => {
          HoffUI.collapsePills();
          HoffUI.collapseChatBar();
          const targetStep = payload.workflow.steps[stepIndex];
          if (targetStep) {
            if (lastUrl && lastUrl !== window.location.href) {
              await chrome.storage.local.set({
                hoff_tour_state: { payload, stepIndex, lastUrl: null },
              });
              window.location.href = lastUrl;
              return;
            }
            await HoffTour.waitForElement(targetStep);
          }
          HoffTour.start(payload, stepIndex);
        },
        // No — dismiss tour
        () => {
          HoffTour.clearState();
        }
      );
    };

    // 4. Wire tour complete → reset input and expand pills
    HoffTour.onComplete = () => {
      HoffUI.setTourActive(false);
      HoffUI.expandPills();
      HoffUI.expandChatBar();
      HoffUI.resetInput();
    };

    // 4.5. Fetch saved workflows from backend for this domain
    try {
      const domain = window.location.hostname;
      const data = await bgFetch(`${BACKEND_URL}/workflows/${encodeURIComponent(domain)}`);
      {
        const existingPills = HoffUI.getPills();
        const existingNames = new Set(existingPills.map((p) => p.text));
        // Also check locally deleted names so we don't re-add them
        const deletedKey = "hoff_deleted_" + domain;
        const deletedResult = await new Promise((r) =>
          chrome.storage.local.get(deletedKey, (d) => r(d[deletedKey] || []))
        );
        const deletedNames = new Set(deletedResult);

        const backendNames = new Set((data.workflows || []).map((w) => w.name));
        for (const wf of data.workflows || []) {
          if (existingNames.has(wf.name) || deletedNames.has(wf.name)) continue;
          const id = generatePillId();
          const wfPayload = { url: data.url, brand: data.brand, workflow: wf };
          HoffUI.addPill(id, wf.name);
          HoffUI.completePill(id, wfPayload);
          HoffUI.setPillClickHandler(id, () => startFromPill(wfPayload));
        }

        // Clean up deleted names that the backend already removed
        const stillDeleted = deletedResult.filter((n) => backendNames.has(n));
        chrome.storage.local.set({ [deletedKey]: stillDeleted });
      }
    } catch (e) {
      console.debug("Hoff: no saved workflows for this domain", e);
    }

    // 5. Check for an in-progress tour to resume
    const tourState = await HoffTour.getStoredState();
    if (tourState) {
      const { payload, stepIndex, lastUrl } = tourState;
      const targetStep = payload.workflow.steps[stepIndex];

      if (!targetStep) {
        HoffTour.clearState();
        return;
      }

      // Try to find the element on this page
      const el = await HoffTour.waitForElement(targetStep, 3000);
      if (el) {
        HoffUI.setTourActive(true);
        HoffUI.collapsePills();
        HoffUI.collapseChatBar();
        HoffTour.start(payload, stepIndex);
      } else if (lastUrl && lastUrl !== window.location.href) {
        // Different page — show continue prompt
        HoffUI.showContinuePrompt(
          async () => {
            await chrome.storage.local.set({
              hoff_tour_state: { payload, stepIndex, lastUrl: null },
            });
            window.location.href = lastUrl;
          },
          () => {
            HoffTour.clearState();
            HoffUI.resetInput();
          }
        );
      } else {
        // Element not found, same page — show continue prompt
        HoffUI.showContinuePrompt(
          () => HoffTour.start(payload, stepIndex),
          () => {
            HoffTour.clearState();
            HoffUI.resetInput();
          }
        );
      }
    }

    // 6. Re-attach click handlers on restored completed pills
    const restoredPills = HoffUI.getPills();
    restoredPills.forEach((pill) => {
      if (pill.status === "complete" && pill.workflowPayload) {
        HoffUI.setPillClickHandler(pill.id, () => startFromPill(pill.workflowPayload));
      }
    });
  }

  // Run on page load
  init();
})();
