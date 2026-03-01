// Hoff — Tour Logic (driver.js integration with glass theming)
// Exposes global HoffTour object

(function () {
  "use strict";

  const TOUR_STORAGE_KEY = "hoff_tour_state";
  let activeDriverObj = null;
  let isNavigating = false;
  let injectedStyle = null;

  /** Convert hex color to rgba string */
  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /** Generate scoped CSS from a brand config with glass treatment */
  function generateBrandCSS(brand) {
    const bgRgba = hexToRgba(brand.background, 0.75);
    const bgRgbaArrow = hexToRgba(brand.background, 0.85);

    return `
      .driver-popover.hoff-theme {
        background-color: ${bgRgba} !important;
        color: ${brand.text};
        font-family: ${brand.fontFamily};
        border-radius: ${brand.borderRadius};
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
        animation: hoffFadeScale 0.25s ease-out;
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

      .driver-popover.hoff-theme .driver-popover-arrow-side-top.driver-popover-arrow {
        border-top-color: ${bgRgbaArrow};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-bottom.driver-popover-arrow {
        border-bottom-color: ${bgRgbaArrow};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-left.driver-popover-arrow {
        border-left-color: ${bgRgbaArrow};
      }
      .driver-popover.hoff-theme .driver-popover-arrow-side-right.driver-popover-arrow {
        border-right-color: ${bgRgbaArrow};
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

  /** Wait for an element to appear in the DOM. */
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
        const highlightedEl = el || document.querySelector(s.element);
        const isInput =
          highlightedEl &&
          (highlightedEl.tagName === "INPUT" ||
            highlightedEl.tagName === "TEXTAREA" ||
            highlightedEl.isContentEditable ||
            highlightedEl.getAttribute("role") === "textbox");

        if (highlightedEl && !isInput) {
          const handler = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            highlightedEl.removeEventListener("click", handler, true);

            const isLastStep = i === rawSteps.length - 1;
            if (s.navigates) {
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
              if (isLastStep) {
                isNavigating = true; // prevent collapse on final destroy
                if (activeDriverObj) activeDriverObj.destroy();
                clearTourState();
                if (window.HoffTour.onComplete) window.HoffTour.onComplete();
              } else {
                if (activeDriverObj) activeDriverObj.moveNext();
              }
            }
          };
          highlightedEl.addEventListener("click", handler, true);
        }
      };

      // For navigates steps, also handle the "Next" button
      if (s.navigates) {
        step.popover.onNextClick = async (el) => {
          const isLastStep = i === rawSteps.length - 1;
          isNavigating = true;
          if (!isLastStep) {
            await saveTourState(payload, i + 1, null);
          } else {
            clearTourState();
          }
          const target = el || document.querySelector(s.element);
          if (activeDriverObj) activeDriverObj.destroy();
          if (target) {
            if (target.tagName === "A" && target.href) {
              window.location.href = target.href;
            } else {
              target.click();
            }
          }
        };
      }

      return step;
    });
  }

  // --- Public API ---
  window.HoffTour = {
    onCollapse: null, // (payload, stepIndex, lastUrl) => {}
    onComplete: null, // () => {}

    /** Start or resume a branded tour. */
    start(payload, startIndex = 0) {
      injectStyles(generateBrandCSS(payload.brand));

      const driverConstructor = window.driver.js.driver;
      const steps = mapSteps(payload, startIndex);

      const driverObj = driverConstructor({
        popoverClass: "hoff-theme",
        animate: true,
        showProgress: true,
        allowClose: true,
        overlayClickBehavior: "close",
        allowKeyboardControl: true,
        overlayColor: payload.brand.background,
        overlayOpacity: 0.6,
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
    waitForElement: waitForElement,
  };
})();
