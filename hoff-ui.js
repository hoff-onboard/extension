// Hoff — UI Components (Chat Input Bar + Query Pills)
// Exposes global HoffUI object

(function () {
  "use strict";

  const PILLS_STORAGE_KEY = "hoff_pills_" + window.location.hostname;
  let container = null; // Root element with data-hoff-theme
  let chatBar = null;
  let pillsBox = null;
  let pillsContainer = null;
  let floatingBtn = null;
  let pills = []; // { id, text, status, workflowPayload }
  let isMinimized = false;
  let tourActive = false;
  let selectMode = false;
  let selectedIds = new Set();
  let researchMode = false;

  /** Detect if page background is light or dark */
  function detectTheme() {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return "light"; // no background set → browser default is white
    const [, r, g, b] = match.map(Number);
    const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
    if (alpha < 0.1) return "light"; // transparent → browser default white
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

  const HOFF_LOGO_URL = HoffConfig.FRONTEND_BASE + "/?url=" + encodeURIComponent(window.location.hostname);

  /** Create the logo button element */
  function createLogoBtn() {
    const btn = document.createElement("button");
    btn.id = "hoff-logo-btn";
    btn.title = "Go to Hoff";
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/icon48.png");
    img.alt = "Hoff";
    btn.appendChild(img);
    btn.addEventListener("click", () => {
      window.open(HOFF_LOGO_URL, "_blank");
    });
    return btn;
  }

  /** Create the floating logo button (shown when UI is minimized) */
  function createFloatingBtn() {
    floatingBtn = document.createElement("button");
    floatingBtn.id = "hoff-floating-btn";
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/icon48.png");
    img.alt = "Hoff";
    floatingBtn.appendChild(img);
    floatingBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      restoreUI();
    });
    floatingBtn.style.display = "none";
    container.appendChild(floatingBtn);
  }

  /** Minimize UI to floating button */
  function minimizeUI() {
    if (isMinimized) return;
    isMinimized = true;
    chatBar.classList.add("hoff-minimized");
    pillsBox.classList.add("hoff-minimized");
    floatingBtn.style.display = "flex";
    chrome.storage.local.set({ hoff_minimized: true });
  }

  /** Restore UI from floating button */
  function restoreUI() {
    isMinimized = false;
    chatBar.classList.remove("hoff-minimized");
    pillsBox.classList.remove("hoff-minimized");
    floatingBtn.style.display = "none";
    chrome.storage.local.remove("hoff_minimized");
  }

  /** Set up click-outside listener */
  function setupClickOutside() {
    document.addEventListener("click", (e) => {
      if (tourActive || isMinimized) return;
      // Only minimize when in default input mode (not during loading or continue prompt)
      if (!chatBar.querySelector("input")) return;
      // Don't minimize if clicking inside any Hoff element
      if (container && container.contains(e.target)) return;
      // Don't minimize if clicking inside driver.js popover
      if (e.target.closest && e.target.closest(".driver-popover")) return;
      minimizeUI();
    }, true);
  }

  /** Create the chat input bar */
  function createChatBar() {
    chatBar = document.createElement("div");
    chatBar.id = "hoff-chat-bar";
    chatBar.className = "hoff-glass";
    setInputMode();
    container.appendChild(chatBar);
  }

  /** Create the planning-mode toggle button */
  function createResearchBtn() {
    const btn = document.createElement("button");
    btn.id = "hoff-research-btn";
    btn.title = "Plan & research the query before extracting the flow";
    btn.textContent = "P";
    if (researchMode) btn.classList.add("active");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      researchMode = !researchMode;
      btn.classList.toggle("active", researchMode);
    });
    return btn;
  }

  /** Set the chat bar to default input mode */
  function setInputMode() {
    chatBar.classList.remove("hoff-loading");
    chatBar.innerHTML = "";
    chatBar.appendChild(createLogoBtn());
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
    chatBar.appendChild(createResearchBtn());
  }

  /** Make the pills box draggable by its header */
  function makeDraggable() {
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const header = pillsBox.querySelector("#hoff-pills-header");
    if (!header) return;

    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      isDragging = true;
      const rect = pillsBox.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      pillsBox.classList.add("hoff-dragging");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;

      const maxLeft = window.innerWidth - pillsBox.offsetWidth;
      const maxTop = window.innerHeight - pillsBox.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      pillsBox.style.left = newLeft + "px";
      pillsBox.style.top = newTop + "px";
      pillsBox.style.right = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      pillsBox.classList.remove("hoff-dragging");
    });
  }

  /** Create the pills box (glass container) and inner scrollable list */
  function createPillsContainer() {
    pillsBox = document.createElement("div");
    pillsBox.id = "hoff-pills-box";
    pillsBox.className = "hoff-glass";

    const header = document.createElement("div");
    header.id = "hoff-pills-header";

    const headerTop = document.createElement("div");
    headerTop.className = "hoff-pills-header-top";

    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "hoff-pills-title";
    title.textContent = "Your flows";
    const subtitle = document.createElement("div");
    subtitle.className = "hoff-pills-subtitle";
    subtitle.appendChild(document.createTextNode("Workflows we've helped you navigate in "));
    const domainSpan = document.createElement("span");
    domainSpan.className = "hoff-domain-highlight";
    domainSpan.textContent = window.location.hostname;
    subtitle.appendChild(domainSpan);
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const selectBtn = document.createElement("button");
    selectBtn.id = "hoff-select-btn";
    selectBtn.title = "Select flows";
    selectBtn.innerHTML = "☰";
    selectBtn.addEventListener("click", () => toggleSelectMode());

    headerTop.appendChild(titleWrap);
    headerTop.appendChild(selectBtn);
    header.appendChild(headerTop);

    // Action bar (hidden by default)
    const deleteBar = document.createElement("div");
    deleteBar.id = "hoff-delete-bar";
    deleteBar.style.display = "none";

    const selectAllBtn = document.createElement("button");
    selectAllBtn.id = "hoff-select-all-btn";
    selectAllBtn.textContent = "Select All";
    selectAllBtn.addEventListener("click", () => selectAll());

    const deleteBtn = document.createElement("button");
    deleteBtn.id = "hoff-delete-btn";
    deleteBtn.textContent = "Delete All";
    deleteBtn.style.display = "none";
    deleteBtn.addEventListener("click", () => deleteSelected());

    const cancelBtn = document.createElement("button");
    cancelBtn.id = "hoff-cancel-select-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => toggleSelectMode());

    deleteBar.appendChild(selectAllBtn);
    deleteBar.appendChild(deleteBtn);
    deleteBar.appendChild(cancelBtn);
    header.appendChild(deleteBar);

    pillsBox.appendChild(header);

    pillsContainer = document.createElement("div");
    pillsContainer.id = "hoff-pills-container";
    pillsBox.appendChild(pillsContainer);
    container.appendChild(pillsBox);
  }

  /** Toggle select mode for deleting pills */
  function toggleSelectMode() {
    selectMode = !selectMode;
    selectedIds.clear();
    const deleteBar = document.getElementById("hoff-delete-bar");
    const selectBtn = document.getElementById("hoff-select-btn");
    if (selectMode) {
      deleteBar.style.display = "flex";
      selectBtn.classList.add("active");
    } else {
      deleteBar.style.display = "none";
      selectBtn.classList.remove("active");
    }
    updateDeleteBarButtons();
    renderAllPills();
  }

  /** Select all pills */
  function selectAll() {
    pills.forEach((p) => selectedIds.add(p.id));
    updateDeleteBarButtons();
    renderAllPills();
  }

  /** Update visibility of Select All vs Delete All buttons */
  function updateDeleteBarButtons() {
    const selectAllBtn = document.getElementById("hoff-select-all-btn");
    const deleteBtn = document.getElementById("hoff-delete-btn");
    const allSelected = pills.length > 0 && selectedIds.size === pills.length;
    selectAllBtn.style.display = allSelected ? "none" : "";
    deleteBtn.style.display = allSelected ? "" : "none";
  }

  /** Delete selected pills */
  function deleteSelected() {
    const domain = window.location.hostname;
    const toDelete = pills.filter((p) => selectedIds.has(p.id));
    const deletedNames = toDelete.map((p) => p.workflowPayload?.workflow?.name || p.text);

    // Soft-delete each workflow in the backend (fire-and-forget via background proxy)
    for (const name of deletedNames) {
      chrome.runtime.sendMessage({
        action: "proxyFetch",
        url: `${HoffConfig.API_BASE}/workflows/${encodeURIComponent(domain)}/${encodeURIComponent(name)}`,
        options: { method: "DELETE" },
      }, () => {});
    }

    // Track deleted names locally so they don't reappear on refresh before backend processes
    const deletedKey = "hoff_deleted_" + domain;
    chrome.storage.local.get(deletedKey, (result) => {
      const existing = result[deletedKey] || [];
      chrome.storage.local.set({ [deletedKey]: [...existing, ...deletedNames] });
    });

    pills = pills.filter((p) => !selectedIds.has(p.id));
    selectedIds.clear();
    savePills();
    toggleSelectMode();
    // Dismiss any active continue prompt and clear tour state
    // to avoid getting stuck on a deleted flow's continue prompt
    if (typeof HoffTour !== "undefined" && HoffTour.clearState) {
      HoffTour.clearState();
    }
    setInputMode();
  }

  /** Render a single pill DOM element */
  function renderPill(pill) {
    const el = document.createElement("div");
    el.className = `hoff-pill hoff-glass ${pill.status}`;
    el.dataset.pillId = pill.id;

    if (selectMode) {
      const circle = document.createElement("span");
      circle.className = "hoff-select-circle" + (selectedIds.has(pill.id) ? " selected" : "");
      circle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (selectedIds.has(pill.id)) {
          selectedIds.delete(pill.id);
        } else {
          selectedIds.add(pill.id);
        }
        updateDeleteBarButtons();
        renderAllPills();
      });
      el.appendChild(circle);
    }

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

      // Tooltip with workflow description on hover
      const desc = pill.workflowPayload?.workflow?.description;
      if (desc) {
        el.addEventListener("mouseenter", () => {
          let tooltip = document.getElementById("hoff-pill-tooltip");
          if (!tooltip) {
            tooltip = document.createElement("div");
            tooltip.id = "hoff-pill-tooltip";
            document.getElementById("hoff-pills-box").appendChild(tooltip);
          }
          tooltip.textContent = desc;
          tooltip.style.display = "block";
          const boxRect = document.getElementById("hoff-pills-box").getBoundingClientRect();
          const pillRect = el.getBoundingClientRect();
          tooltip.style.left = (pillRect.left - boxRect.left) + "px";
          tooltip.style.top = (pillRect.top - boxRect.top - tooltip.offsetHeight - 8) + "px";
          tooltip.style.width = pillRect.width + "px";
        });
        el.addEventListener("mouseleave", () => {
          const tooltip = document.getElementById("hoff-pill-tooltip");
          if (tooltip) tooltip.style.display = "none";
        });
      }
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
      makeDraggable();
      createFloatingBtn();
      setupClickOutside();

      // Restore saved pills
      const saved = await loadPills();
      pills = saved.map((p) => ({ ...p, _clickHandler: null }));
      renderAllPills();

      // Check if UI was hidden
      const { hoff_hidden } = await chrome.storage.local.get("hoff_hidden");
      if (hoff_hidden) container.style.display = "none";

      // Check if UI was minimized
      const { hoff_minimized } = await chrome.storage.local.get("hoff_minimized");
      if (hoff_minimized) {
        isMinimized = true;
        chatBar.classList.add("hoff-minimized");
        pillsBox.classList.add("hoff-minimized");
        floatingBtn.style.display = "flex";
      }

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
        chatBar.appendChild(createLogoBtn());
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
      chatBar.appendChild(createLogoBtn());
      const prompt = document.createElement("div");
      prompt.className = "hoff-continue-prompt";

      const label = document.createElement("span");
      label.textContent = "Continue flow?";

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

    /** Flash the chat bar red to indicate an error, then return to input */
    showError() {
      setInputMode();
      chatBar.classList.add("hoff-error");
      chatBar.addEventListener("animationend", () => {
        chatBar.classList.remove("hoff-error");
      }, { once: true });
    },

    /** Reset chat bar to default input mode */
    resetInput() {
      setInputMode();
    },

    /** Add a new query pill (loading state) */
    addPill(id, queryText) {
      const pill = { id, text: queryText, status: "loading", workflowPayload: null };
      pills.unshift(pill);
      savePills();
      const el = renderPill(pill);
      el.classList.add("hoff-new");
      pillsContainer.prepend(el);
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

    /** Get current research mode state */
    getResearchMode() {
      return researchMode;
    },

    /** Get all pills */
    getPills() {
      return pills;
    },

    /** Mark tour as active/inactive (prevents click-outside minimize) */
    setTourActive(active) {
      tourActive = active;
    },

    /** Collapse pills box (during active tour) */
    collapsePills() {
      if (pillsBox) pillsBox.classList.add("hoff-collapsed");
    },

    /** Expand pills box */
    expandPills() {
      if (pillsBox) pillsBox.classList.remove("hoff-collapsed");
    },

    /** Collapse chat bar (during active tour) */
    collapseChatBar() {
      if (chatBar) chatBar.classList.add("hoff-collapsed");
    },

    /** Expand chat bar */
    expandChatBar() {
      if (chatBar) chatBar.classList.remove("hoff-collapsed");
    },

    /** Hide all Hoff UI */
    hide() {
      if (container) container.style.display = "none";
      chrome.storage.local.set({ hoff_hidden: true });
    },

    /** Show all Hoff UI */
    show() {
      if (container) container.style.display = "";
      restoreUI();
      chrome.storage.local.remove("hoff_hidden");
    },
  };
})();
