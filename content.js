// Hoff — content script
// All tour logic lives here. driver.js IIFE is loaded before this script,
// exposing window.driver.js.driver as the constructor.

(function () {
  "use strict";

  /** Return the onboarding payload. Swap this to read from a message later. */
  function getPayload() {
    return HOFF_MOCK_PAYLOAD;
  }

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

  /** Inject a <style> tag into the page <head>. */
  function injectStyles(css) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  }

  /** Map payload steps to driver.js step format. */
  function mapSteps(steps) {
    return steps.map((s) => ({
      element: s.element,
      popover: {
        title: s.title,
        description: s.description,
        side: s.side || "bottom",
        align: "start",
      },
    }));
  }

  /** Start the branded tour. */
  function startTour(payload) {
    // Inject brand CSS
    injectStyles(generateBrandCSS(payload.brand));

    // Access driver constructor from the IIFE global
    const driverConstructor = window.driver.js.driver;

    const driverObj = driverConstructor({
      popoverClass: "hoff-theme",
      animate: true,
      showProgress: true,
      allowClose: true,
      overlayColor: payload.brand.background,
      overlayOpacity: 0.6,
      stagePadding: 8,
      stageRadius: 6,
      steps: mapSteps(payload.workflow.steps),
    });

    driverObj.drive();
  }

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "startTour") {
      const payload = getPayload();
      startTour(payload);
      sendResponse({ status: "started" });
    }
  });
})();
