// Hoff — Content Script Orchestrator
// Wires together HoffUI (chat + pills) and HoffTour (driver.js tours)

(function () {
  "use strict";

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

  async function queryBackend(query, url, cookies, origins, useResearch) {
    return bgFetch(`${BACKEND_URL}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, url, cookies, origins, use_research: useResearch }),
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
        const response = await queryBackend(query, url, cookies, origins, useResearch);
        // Backend returns { url, brand, workflows[] } — tour expects { url, brand, workflow }
        if (response && response.workflows && response.workflows.length > 0) {
          payload = { url: response.url, brand: response.brand, workflow: response.workflows[0] };
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

        for (const wf of data.workflows || []) {
          if (existingNames.has(wf.name)) continue;
          const id = generatePillId();
          const wfPayload = { url: data.url, brand: data.brand, workflow: wf };
          HoffUI.addPill(id, wf.name);
          HoffUI.completePill(id, wfPayload);
          HoffUI.setPillClickHandler(id, () => startFromPill(wfPayload));
        }
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
