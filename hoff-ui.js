// Hoff — UI Components (Chat Input Bar + Query Pills)
// Exposes global HoffUI object

(function () {
  "use strict";

  const PILLS_STORAGE_KEY = "hoff_pills";
  let container = null; // Root element with data-hoff-theme
  let chatBar = null;
  let pillsBox = null;
  let pillsContainer = null;
  let pills = []; // { id, text, status, workflowPayload }

  /** Detect if page background is light or dark */
  function detectTheme() {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return "dark";
    const [, r, g, b] = match.map(Number);
    // Relative luminance formula
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "light" : "dark";
  }

  /** Save pills to storage */
  function savePills() {
    chrome.storage.local.set({ [PILLS_STORAGE_KEY]: pills });
  }

  /** Load pills from storage */
  function loadPills() {
    return new Promise((resolve) => {
      chrome.storage.local.get(PILLS_STORAGE_KEY, (result) => {
        resolve(result[PILLS_STORAGE_KEY] || []);
      });
    });
  }

  /** Create the root container with theme detection */
  function createContainer() {
    container = document.createElement("div");
    container.id = "hoff-root";
    container.dataset.hoffTheme = detectTheme();
    document.body.appendChild(container);
    return container;
  }

  /** Create the chat input bar */
  function createChatBar() {
    chatBar = document.createElement("div");
    chatBar.id = "hoff-chat-bar";
    chatBar.className = "hoff-glass";
    setInputMode();
    container.appendChild(chatBar);
  }

  /** Set the chat bar to default input mode */
  function setInputMode() {
    chatBar.classList.remove("hoff-loading");
    chatBar.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "What do you want to do?";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        const query = input.value.trim();
        input.value = "";
        if (window.HoffUI.onSubmit) {
          window.HoffUI.onSubmit(query);
        }
      }
    });
    chatBar.appendChild(input);
  }

  /** Create the pills box (glass container) and inner scrollable list */
  function createPillsContainer() {
    pillsBox = document.createElement("div");
    pillsBox.id = "hoff-pills-box";
    pillsBox.className = "hoff-glass";
    pillsContainer = document.createElement("div");
    pillsContainer.id = "hoff-pills-container";
    pillsBox.appendChild(pillsContainer);
    container.appendChild(pillsBox);
  }

  /** Render a single pill DOM element */
  function renderPill(pill) {
    const el = document.createElement("div");
    el.className = `hoff-pill hoff-glass ${pill.status}`;
    el.dataset.pillId = pill.id;

    const textSpan = document.createElement("span");
    textSpan.className = "hoff-pill-text";
    textSpan.textContent = pill.text;
    el.appendChild(textSpan);

    if (pill.status === "loading") {
      const sparkle = document.createElement("span");
      sparkle.className = "hoff-sparkle";
      sparkle.textContent = "✦";
      el.appendChild(sparkle);
    } else if (pill.status === "complete") {
      const check = document.createElement("span");
      check.className = "hoff-check";
      check.textContent = "✓";
      el.appendChild(check);
    }

    return el;
  }

  /** Re-render all pills */
  function renderAllPills() {
    pillsContainer.innerHTML = "";
    pills.forEach((pill) => {
      const el = renderPill(pill);
      if (pill.status === "complete" && pill._clickHandler) {
        el.addEventListener("click", pill._clickHandler);
      }
      pillsContainer.appendChild(el);
    });
  }

  // --- Public API ---
  window.HoffUI = {
    onSubmit: null, // Set by content.js

    async init() {
      createContainer();
      createChatBar();
      createPillsContainer();

      // Restore saved pills
      const saved = await loadPills();
      pills = saved.map((p) => ({ ...p, _clickHandler: null }));
      renderAllPills();

      // Check if UI was hidden
      const { hoff_hidden } = await chrome.storage.local.get("hoff_hidden");
      if (hoff_hidden) container.style.display = "none";

      // Listen for toggle message from background script (icon click)
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "toggleUI") {
          if (container.style.display === "none") {
            window.HoffUI.show();
          } else {
            window.HoffUI.hide();
          }
        }
      });
    },

    /** Get the current theme */
    getTheme() {
      return container ? container.dataset.hoffTheme : "dark";
    },

    /** Set loading state on chat bar */
    setLoading(loading) {
      if (loading) {
        chatBar.classList.add("hoff-loading");
        chatBar.innerHTML = "";
        const text = document.createElement("div");
        text.className = "hoff-loading-text";
        text.textContent = "Working on it...";
        chatBar.appendChild(text);
      } else {
        setInputMode();
      }
    },

    /** Show "Continue onboarding?" prompt in chat bar */
    showContinuePrompt(onYes, onNo) {
      chatBar.classList.remove("hoff-loading");
      chatBar.innerHTML = "";
      const prompt = document.createElement("div");
      prompt.className = "hoff-continue-prompt";

      const label = document.createElement("span");
      label.textContent = "Continue onboarding?";

      const yesBtn = document.createElement("button");
      yesBtn.className = "hoff-continue-btn hoff-yes";
      yesBtn.textContent = "Yes";
      yesBtn.addEventListener("click", () => {
        setInputMode();
        if (onYes) onYes();
      });

      const noBtn = document.createElement("button");
      noBtn.className = "hoff-continue-btn hoff-no";
      noBtn.textContent = "No";
      noBtn.addEventListener("click", () => {
        setInputMode();
        if (onNo) onNo();
      });

      prompt.appendChild(label);
      prompt.appendChild(yesBtn);
      prompt.appendChild(noBtn);
      chatBar.appendChild(prompt);
    },

    /** Reset chat bar to default input mode */
    resetInput() {
      setInputMode();
    },

    /** Add a new query pill (loading state) */
    addPill(id, queryText) {
      const pill = { id, text: queryText, status: "loading", workflowPayload: null };
      pills.push(pill);
      savePills();
      const el = renderPill(pill);
      pillsContainer.appendChild(el);
    },

    /** Mark a pill as complete */
    completePill(id, workflowPayload) {
      const pill = pills.find((p) => p.id === id);
      if (!pill) return;
      pill.status = "complete";
      pill.workflowPayload = workflowPayload;
      savePills();
      renderAllPills();
    },

    /** Set click handler for a pill */
    setPillClickHandler(id, callback) {
      const pill = pills.find((p) => p.id === id);
      if (!pill) return;
      pill._clickHandler = callback;
      // Re-render to attach handler
      renderAllPills();
    },

    /** Get all pills */
    getPills() {
      return pills;
    },

    /** Collapse pills box (during active tour) */
    collapsePills() {
      if (pillsBox) pillsBox.classList.add("hoff-collapsed");
    },

    /** Expand pills box */
    expandPills() {
      if (pillsBox) pillsBox.classList.remove("hoff-collapsed");
    },

    /** Hide all Hoff UI */
    hide() {
      if (container) container.style.display = "none";
      chrome.storage.local.set({ hoff_hidden: true });
    },

    /** Show all Hoff UI */
    show() {
      if (container) container.style.display = "";
      chrome.storage.local.remove("hoff_hidden");
    },
  };
})();
