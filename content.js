// Hoff — content script
// All tour logic lives here. driver.js IIFE is loaded before this script,
// exposing window.driver.js.driver as the constructor.

(function () {
  "use strict";

  const STORAGE_KEY = "hoff_tour_state";

  /** Generate scoped CSS from a brand config object. */
  function generateBrandCSS(brand) {
    return `
      .driver-popover.hoff-theme {
        background-color: ${brand.background};
        color: ${brand.text};
        font-family: ${brand.fontFamily};
        border-radius: ${brand.borderRadius};
      }

      .driver-popover.hoff-theme .driver-popover-title {
        color: ${brand.text};
        font-size: 17px;
        font-weight: 600;
      }

      .driver-popover.hoff-theme .driver-popover-description {
        color: ${brand.text};
        opacity: 0.85;
      }

      .driver-popover.hoff-theme .driver-popover-progress-text {
        color: ${brand.text};
        opacity: 0.6;
      }

      .driver-popover.hoff-theme .driver-popover-close-btn {
        color: ${brand.text};
        opacity: 0.5;
      }
      .driver-popover.hoff-theme .driver-popover-close-btn:hover {
        color: ${brand.text};
        opacity: 1;
      }

      .driver-popover.hoff-theme .driver-popover-navigation-btns {
        gap: 6px;
      }

      .driver-popover.hoff-theme button:not(.driver-popover-close-btn) {
        background-color: ${brand.primary};
        color: #fff;
        border: none;
        border-radius: ${brand.borderRadius};
        padding: 6px 14px;
        font-size: 13px;
        font-weight: 500;
        text-shadow: none;
        cursor: pointer;
      }
      .driver-popover.hoff-theme button:not(.driver-popover-close-btn):hover {
        filter: brightness(1.15);
      }

      /* Arrow colors must match popover background on all four sides */
      .driver-popover.hoff-theme .driver-popover-arrow-side-top.driver-popover-arrow {
        border-top-color: ${brand.background};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-bottom.driver-popover-arrow {
        border-bottom-color: ${brand.background};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-left.driver-popover-arrow {
        border-left-color: ${brand.background};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-right.driver-popover-arrow {
        border-right-color: ${brand.background};
      }
    `;
  }

  let injectedStyle = null;

  /** Inject a <style> tag into the page <head>. */
  function injectStyles(css) {
    if (injectedStyle) injectedStyle.remove();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    injectedStyle = style;
    return style;
  }

  /** Save tour state so it survives page navigations. */
  function saveTourState(payload, stepIndex) {
    chrome.storage.local.set({
      [STORAGE_KEY]: { payload, stepIndex },
    });
  }

  /** Clear saved tour state. */
  function clearTourState() {
    chrome.storage.local.remove(STORAGE_KEY);
  }

  /** Wait for an element to appear in the DOM (for post-navigation). */
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeout);
    });
  }

  /** Map payload steps to driver.js step format. */
  function mapSteps(payload, startIndex) {
    const rawSteps = payload.workflow.steps;

    return rawSteps.map((s, i) => {
      const step = {
        element: s.element,
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

      // If this step needs an element clicked first (e.g. open a dropdown),
      // disable pointer events on the page so the user's cursor can't
      // accidentally trigger mouseleave/hover handlers that close menus.
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

      // If this step navigates to a new page, save state and click on "Next"
      if (s.navigates) {
        step.popover.onNextClick = (el) => {
          saveTourState(payload, i + 1);
          // Use the element driver.js already resolved, fall back to querySelector
          const target = el || document.querySelector(s.element);
          if (target) {
            // For links, navigate directly in case click() is blocked
            if (target.tagName === "A" && target.href) {
              window.location.href = target.href;
            } else {
              target.click();
            }
          }
        };
      } else if (s.preClick) {
        // Re-enable pointer events after driver.js has positioned the popover
        step.onHighlighted = () => {
          setTimeout(() => {
            document.body.style.pointerEvents = "";
            const target = document.querySelector(s.preClick);
            if (target) target.style.pointerEvents = "";
          }, 300);
        };
      }

      return step;
    });
  }

  /** Start the branded tour at a given step index. */
  function startTour(payload, startIndex = 0) {
    injectStyles(generateBrandCSS(payload.brand));

    const driverConstructor = window.driver.js.driver;
    const steps = mapSteps(payload, startIndex);

    const driverObj = driverConstructor({
      popoverClass: "hoff-theme",
      animate: true,
      showProgress: true,
      allowClose: true,
      overlayColor: payload.brand.background,
      overlayOpacity: 0.6,
      stagePadding: 8,
      stageRadius: 6,
      steps: steps,
      onDestroyStarted: () => {
        clearTourState();
        driverObj.destroy();
      },
    });

    driverObj.drive(startIndex);
  }

  // On page load, check if we need to resume a tour after navigation
  chrome.storage.local.get(STORAGE_KEY, async (result) => {
    const state = result[STORAGE_KEY];
    if (!state) return;

    const { payload, stepIndex } = state;
    const targetStep = payload.workflow.steps[stepIndex];
    if (!targetStep) {
      clearTourState();
      return;
    }

    // Wait for the target element to appear in the DOM
    await waitForElement(targetStep.element);
    startTour(payload, stepIndex);
  });

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "startTour" && message.payload) {
      clearTourState();
      startTour(message.payload);
      sendResponse({ status: "started" });
    }
  });
})();
