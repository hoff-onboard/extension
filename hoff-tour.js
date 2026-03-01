// Hoff — Tour Logic (driver.js integration with glass theming)
// Exposes global HoffTour object

(function () {
  "use strict";

  const TOUR_STORAGE_KEY = "hoff_tour_state";
  let activeDriverObj = null;
  let isNavigating = false;
  let injectedStyle = null;
  let tourGeneration = 0; // Incremented on each start(), used to cancel stale async handlers

  /** Detect if page background is light or dark */
  function detectTheme() {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return "dark";
    const [, r, g, b] = match.map(Number);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "light" : "dark";
  }

  /** Generate liquid glass CSS for tour popovers */
  function generateGlassCSS() {
    const isDark = detectTheme() === "dark";
    const textColor = isDark ? "#fff" : "#111";
    const glassBg = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.08)";
    const glassBorder = isDark ? "rgba(255, 255, 255, 0.18)" : "rgba(0, 0, 0, 0.1)";
    const arrowBg = isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.1)";
    const btnBg = isDark ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)";
    const btnHoverBg = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.15)";
    const shadow = isDark ? "0 8px 32px rgba(0, 0, 0, 0.25)" : "0 8px 32px rgba(0, 0, 0, 0.1)";

    return `
      .driver-popover.hoff-theme {
        background-color: ${glassBg} !important;
        color: ${textColor};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        border-radius: 18px;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border: 1px solid ${glassBorder} !important;
        box-shadow: ${shadow} !important;
        animation: hoffFadeScale 0.25s ease-out;
      }

      .driver-popover.hoff-theme .driver-popover-title {
        color: ${textColor};
        font-size: 17px;
        font-weight: 600;
      }

      .driver-popover.hoff-theme .driver-popover-description {
        color: ${textColor};
        opacity: 0.85;
      }

      .driver-popover.hoff-theme .driver-popover-progress-text {
        color: ${textColor};
        opacity: 0.6;
      }

      .driver-popover.hoff-theme .driver-popover-close-btn {
        color: ${textColor};
        opacity: 0.5;
      }
      .driver-popover.hoff-theme .driver-popover-close-btn:hover {
        color: ${textColor};
        opacity: 1;
      }

      .driver-popover.hoff-theme .driver-popover-navigation-btns {
        gap: 6px;
      }

      .driver-popover.hoff-theme button:not(.driver-popover-close-btn) {
        background-color: ${btnBg};
        color: ${textColor};
        border: 1px solid ${glassBorder};
        border-radius: 14px;
        padding: 6px 14px;
        font-size: 13px;
        font-weight: 500;
        text-shadow: none;
        cursor: pointer;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        transition: background 0.2s ease, transform 0.15s ease;
      }
      .driver-popover.hoff-theme button:not(.driver-popover-close-btn):hover {
        background-color: ${btnHoverBg};
        transform: scale(1.03);
      }

      .driver-popover.hoff-theme .driver-popover-arrow-side-top.driver-popover-arrow {
        border-top-color: ${arrowBg};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-bottom.driver-popover-arrow {
        border-bottom-color: ${arrowBg};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-left.driver-popover-arrow {
        border-left-color: ${arrowBg};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-right.driver-popover-arrow {
        border-right-color: ${arrowBg};
      }
    `;
  }

  /** Inject a <style> tag into the page <head>. */
  function injectStyles(css) {
    if (injectedStyle) injectedStyle.remove();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    injectedStyle = style;
  }

  /** Save tour state to survive navigations. */
  function saveTourState(payload, stepIndex, lastUrl) {
    return chrome.storage.local.set({
      [TOUR_STORAGE_KEY]: { payload, stepIndex, lastUrl: lastUrl || window.location.href },
    });
  }

  /** Clear saved tour state. */
  function clearTourState() {
    chrome.storage.local.remove(TOUR_STORAGE_KEY);
  }

  /**
   * Find a DOM element for a step.
   * Uses CSS selector (step.element) when no text field is set.
   * Falls back to tag + textContent matching when step.text is present.
   */
  function findElement(step) {
    if (step.text) {
      return [...document.querySelectorAll(step.element)].find(
        (el) => el.textContent.trim().includes(step.text)
      ) || null;
    }
    return document.querySelector(step.element);
  }

  /** Check if element is inside an ephemeral container (dropdown, popover, menu) */
  function isInsideEphemeral(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const role = node.getAttribute("role");
      if (role === "listbox" || role === "menu" || role === "dialog" ||
          node.hasAttribute("data-radix-popper-content-wrapper") ||
          node.getAttribute("data-state") === "open") {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /** Reset an element corrupted by driver.js by detaching/reattaching it.
   *  This forces React to reconcile and reset Radix's internal state.
   *  For ephemeral elements (inside dropdowns), use pointer events instead.
   *  For simple elements, just click directly. */
  function resetAndClick(el) {
    // Elements inside dropdowns/popovers: can't detach, use pointer events
    if (isInsideEphemeral(el)) {
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return Promise.resolve();
    }
    // Elements with Radix state (triggers): detach/reattach to reset React state
    if (el.hasAttribute("aria-haspopup") || el.hasAttribute("data-state")) {
      return new Promise((resolve) => {
        const parent = el.parentElement;
        const next = el.nextSibling;
        parent.removeChild(el);
        requestAnimationFrame(() => {
          parent.insertBefore(el, next);
          setTimeout(() => {
            el.click();
            resolve();
          }, 100);
        });
      });
    }
    // Simple elements: plain click
    el.click();
    return Promise.resolve();
  }

  /** Wait for an element to appear in the DOM. */
  function waitForElement(step, timeout = 5000) {
    return new Promise((resolve) => {
      const el = findElement(step);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = findElement(step);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(findElement(step));
      }, timeout);
    });
  }

  /** Map payload steps to driver.js step format. */
  function mapSteps(payload, startIndex) {
    const rawSteps = payload.workflow.steps;

    return rawSteps.map((s, i) => {
      const step = {
        // Text-based steps: use a function so driver.js finds the right element
        element: s.text
          ? () => findElement(s)
          : s.element,
        popover: {
          title: s.title,
          description: s.description,
          side: s.side || "bottom",
          align: "start",
        },
      };

      // Disable "Previous" on the step we resumed at after a navigation
      if (i === startIndex && startIndex > 0) {
        step.popover.disableButtons = ["previous"];
      }

      // preClick: open dropdowns etc before highlighting
      if (s.preClick) {
        step.onHighlightStarted = () => {
          document.body.style.pointerEvents = "none";
          const target = document.querySelector(s.preClick);
          if (target) {
            target.style.pointerEvents = "auto";
            target.click();
          }
        };
      }

      // When highlighted, attach click-to-advance on the element
      step.onHighlighted = (el) => {
        // Re-enable pointer events if preClick was used
        if (s.preClick) {
          setTimeout(() => {
            document.body.style.pointerEvents = "";
            const target = document.querySelector(s.preClick);
            if (target) target.style.pointerEvents = "";
          }, 300);
        }

        // Attach click-to-advance (skip inputs)
        const highlightedEl = el || findElement(s);
        const isInput =
          highlightedEl &&
          (highlightedEl.tagName === "INPUT" ||
            highlightedEl.tagName === "TEXTAREA" ||
            highlightedEl.isContentEditable ||
            highlightedEl.getAttribute("role") === "textbox");

        if (highlightedEl && !isInput) {
          const gen = tourGeneration;
          const handler = async (e) => {
            highlightedEl.removeEventListener("click", handler, true);
            if (gen !== tourGeneration) return; // stale handler

            const isLastStep = i === rawSteps.length - 1;
            if (s.navigates) {
              e.preventDefault();
              e.stopPropagation();
              isNavigating = true;
              if (!isLastStep) {
                await saveTourState(payload, i + 1, null);
              } else {
                clearTourState();
              }
              if (activeDriverObj) activeDriverObj.destroy();
              if (highlightedEl.tagName === "A" && highlightedEl.href) {
                window.location.href = highlightedEl.href;
              } else {
                highlightedEl.click();
              }
            } else {
              // Let the user's click go through naturally (no preventDefault)
              isNavigating = true;
              if (activeDriverObj) activeDriverObj.destroy();

              if (isLastStep) {
                clearTourState();
                if (window.HoffTour.onComplete) window.HoffTour.onComplete();
              } else {
                const nextStep = rawSteps[i + 1];
                if (nextStep) {
                  const nextEl = await waitForElement(nextStep, 10000);
                  if (gen !== tourGeneration) return; // stale
                  if (nextEl) {
                    await new Promise((r) => setTimeout(r, 400));
                    isNavigating = false;
                    window.HoffTour.start(payload, i + 1);
                  }
                }
              }
            }
          };
          highlightedEl.addEventListener("click", handler, true);
        }
      };

      // Handle the "Next" button
      step.popover.onNextClick = async () => {
        const gen = tourGeneration;
        const isLastStep = i === rawSteps.length - 1;
        const target = findElement(s);

        if (s.navigates) {
          isNavigating = true;
          if (!isLastStep) {
            await saveTourState(payload, i + 1, null);
          } else {
            clearTourState();
          }
          if (activeDriverObj) activeDriverObj.destroy();
          if (target) {
            if (target.tagName === "A" && target.href) {
              window.location.href = target.href;
            } else {
              target.click();
            }
          }
        } else {
          isNavigating = true;
          if (activeDriverObj) activeDriverObj.destroy();

          // Re-find element after destroy (driver.js overlay is gone now)
          const freshTarget = findElement(s);
          const isInput =
            freshTarget &&
            (freshTarget.tagName === "INPUT" ||
              freshTarget.tagName === "TEXTAREA" ||
              freshTarget.isContentEditable ||
              freshTarget.getAttribute("role") === "textbox");

          if (isLastStep) {
            clearTourState();
            if (freshTarget && !isInput) await resetAndClick(freshTarget);
            if (window.HoffTour.onComplete) window.HoffTour.onComplete();
          } else {
            if (freshTarget && !isInput) {
              await resetAndClick(freshTarget);
            }
            const nextStep = rawSteps[i + 1];
            if (nextStep) {
              const nextEl = await waitForElement(nextStep, 10000);
              if (gen !== tourGeneration) return; // stale
              if (nextEl) {
                await new Promise((r) => setTimeout(r, 400));
                isNavigating = false;
                window.HoffTour.start(payload, i + 1);
              }
            }
          }
        }
      };

      return step;
    });
  }

  // --- Public API ---
  window.HoffTour = {
    onCollapse: null, // (payload, stepIndex, lastUrl) => {}
    onComplete: null, // () => {}

    /** Start or resume a branded tour. */
    start(payload, startIndex = 0) {
      tourGeneration++; // Cancel any stale async handlers from previous start()
      injectStyles(generateGlassCSS());

      const driverConstructor = window.driver.js.driver;
      const steps = mapSteps(payload, startIndex);

      const isDark = detectTheme() === "dark";
      const driverObj = driverConstructor({
        popoverClass: "hoff-theme",
        animate: true,
        showProgress: true,
        allowClose: true,
        overlayClickBehavior: "close",
        allowKeyboardControl: true,
        overlayColor: isDark ? "#000" : "#000",
        overlayOpacity: isDark ? 0.5 : 0.3,
        stagePadding: 8,
        stageRadius: 6,
        steps: steps,
        onDestroyStarted: () => {
          if (isNavigating) {
            isNavigating = false;
            driverObj.destroy();
            return;
          }
          // Overlay click or Escape — collapse
          const currentIndex = driverObj.getActiveIndex();
          const stepIndex = currentIndex != null ? currentIndex : startIndex;
          const currentUrl = window.location.href;
          saveTourState(payload, stepIndex, currentUrl);
          driverObj.destroy();
          activeDriverObj = null;
          if (window.HoffTour.onCollapse) {
            window.HoffTour.onCollapse(payload, stepIndex, currentUrl);
          }
        },
        onDestroyed: () => {
          activeDriverObj = null;
        },
      });

      activeDriverObj = driverObj;
      driverObj.drive(startIndex);

      // Fix Radix aria-hidden conflict: when driver.js takes focus,
      // Radix sets aria-hidden on dialogs. Remove it so elements stay accessible.
      requestAnimationFrame(() => {
        document.querySelectorAll('[role="dialog"][aria-hidden="true"]').forEach((dialog) => {
          dialog.removeAttribute("aria-hidden");
          dialog.removeAttribute("data-aria-hidden");
        });
      });
    },

    /** Check storage for an in-progress tour. Returns state or null. */
    async getStoredState() {
      return new Promise((resolve) => {
        chrome.storage.local.get(TOUR_STORAGE_KEY, (result) => {
          resolve(result[TOUR_STORAGE_KEY] || null);
        });
      });
    },

    clearState: clearTourState,
    findElement: findElement,
    waitForElement: waitForElement,
  };
})();
