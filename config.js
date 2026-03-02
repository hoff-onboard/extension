// Hoff — Environment Configuration
// Injected before all other content scripts. Override via chrome.storage.sync.

(function () {
  "use strict";

  const DEFAULTS = {
    API_BASE: "http://localhost:8000",
    FRONTEND_BASE: "http://localhost:5173",
  };

  // Expose defaults immediately so other scripts can reference them synchronously.
  // Async override from storage is applied on top once ready.
  window.HoffConfig = Object.assign({}, DEFAULTS);

  // Allow per-user overrides via chrome.storage.sync (persists across devices).
  // Keys: hoff_api_base, hoff_frontend_base
  chrome.storage.sync.get(["hoff_api_base", "hoff_frontend_base"], (result) => {
    if (result.hoff_api_base) window.HoffConfig.API_BASE = result.hoff_api_base;
    if (result.hoff_frontend_base) window.HoffConfig.FRONTEND_BASE = result.hoff_frontend_base;
  });
})();
