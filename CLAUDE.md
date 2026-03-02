# CLAUDE.md — Hoff Extension

## What is Hoff?

Hoff (Hands-Off) is a Chrome extension that generates AI-powered guided onboarding tours matching a site's brand. Users describe a task in natural language, the backend generates a step-by-step workflow, and the extension plays it back as an interactive tour using driver.js.

**Core loop:** User prompt → Backend generates workflow → Extension plays guided tour

---

## Repository Structure

```
extension/
├── manifest.json           # MV3 extension config — permissions, content scripts, service worker
├── config.js               # Environment config (IIFE → window.HoffConfig) — API_BASE, FRONTEND_BASE
├── background.js           # Service worker — proxy fetch (PNA), cookie extraction, messaging
├── content.js              # Main orchestrator — job lifecycle, API calls, wiring UI ↔ Tour
├── hoff-ui.js              # Chat bar + pills UI component (IIFE → window.HoffUI)
├── hoff-tour.js            # Tour playback engine using driver.js (IIFE → window.HoffTour)
├── hoff-glass.css          # Glassmorphism styles — light/dark themes, animations
├── mock-payload.js         # Dev-only mock backend for offline testing
├── package.json            # Node deps (driver.js)
├── icons/                  # Extension icons (16, 48, 128px)
├── lib/
│   ├── driver.iife.js      # driver.js IIFE bundle (copied from node_modules)
│   └── driver.css          # driver.js base styles
└── test-flows/             # Dev-only sample workflow JSONs (do NOT ship to production)
```

### Content Script Injection Order

Defined in `manifest.json`, injected at `document_idle` on all sites:

1. `config.js` — Environment configuration (`window.HoffConfig`)
2. `lib/driver.iife.js` — Tour library
3. `hoff-glass.css` — Extension styles
4. `mock-payload.js` — Mock backend (dev-only, remove for production)
5. `hoff-ui.js` — UI component (reads `HoffConfig`)
6. `hoff-tour.js` — Tour engine
7. `content.js` — Orchestrator (reads `HoffConfig`, depends on all above)

**Order matters.** `config.js` must be first. `content.js` assumes `HoffConfig`, `HoffUI`, and `HoffTour` are already on `window`.

---

## Architecture

### Component Communication

```
Chrome Action (icon click)
  → background.js sends "toggleUI" message
    → content.js listener toggles HoffUI

User submits query (chat bar)
  → content.js orchestrates:
    1. getCookies()      → message to background.js → chrome.cookies API
    2. getOrigins()      → reads localStorage/sessionStorage from page
    3. startJob()        → bgFetch() through background.js → POST /jobs
    4. pollJobResult()   → EventSource SSE on /jobs/{id}/stream
    5. startWorkflow()   → HoffTour.start(payload, stepIndex)

Tour playback (HoffTour)
  → driver.js highlights elements
  → click handlers advance steps
  → navigation steps save state → page reload → auto-resume
```

### Global Objects

- `window.HoffConfig` — Environment configuration (`API_BASE`, `FRONTEND_BASE`)
- `window.HoffUI` — UI component API (init, setLoading, addPill, hide, show, etc.)
- `window.HoffTour` — Tour engine API (start, getStoredState, clearState, etc.)

### Storage Keys (chrome.storage.local)

| Key | Purpose |
|-----|---------|
| `hoff_tour_state` | In-progress tour (payload, stepIndex, lastUrl) |
| `hoff_pills_{domain}` | Cached workflow pills per domain |
| `hoff_deleted_{domain}` | Soft-deleted workflow names |
| `hoff_minimized` | Pills container minimized state |
| `hoff_hidden` | Full UI hidden state |

### Backend API (FastAPI, separate repo in same org)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/jobs` | Submit a new job (query, URL, cookies, origins) |
| GET | `/jobs/{id}/stream` | SSE stream — events: `workflow`, `done`, `error` |
| GET | `/workflows/{domain}` | Fetch saved workflows for a domain |
| DELETE | `/workflows/{domain}/{name}` | Soft-delete a saved workflow |

### Frontend (Vite app at localhost:5173)

Opened in a new tab with `?job={jobId}&source={url}` to show job progress.

---

## Development Setup

### Prerequisites

- Google Chrome (or Chromium-based browser)
- Node.js (for driver.js dependency)
- Backend API running at `localhost:8000` (FastAPI repo — same org)
- Frontend running at `localhost:5173` (optional, for job progress view)

### Loading the Extension

1. `npm install` (if `node_modules/` is missing)
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select this directory
5. The Hoff icon appears in the toolbar

### Development Cycle

1. Edit `.js` / `.css` files directly (no build step)
2. Go to `chrome://extensions` → click the refresh icon on Hoff
3. Reload the target page
4. Test the change

**Tip:** For content script changes, you must both refresh the extension AND reload the page. Background script changes only need the extension refresh.

---

## Code Conventions

### Module Pattern

All content script modules use IIFEs to avoid polluting the global scope:

```javascript
(function () {
  "use strict";
  // module code
  window.HoffModuleName = { /* public API */ };
})();
```

Follow this pattern for any new content script file.

### Naming

- **DOM elements:** `hoff-` prefix for IDs and classes (`hoff-chat-bar`, `hoff-pill`, `hoff-root`)
- **Storage keys:** `hoff_` prefix with underscores (`hoff_tour_state`, `hoff_pills_*`)
- **CSS animations:** `hoff` prefix camelCase (`hoffFadeScale`, `hoffBreathing`, `hoffShimmer`)
- **Functions:** camelCase (`startJob`, `pollJobResult`, `detectTheme`)
- **Constants:** camelCase or UPPER_SNAKE for true constants

### CSS Approach

- Glassmorphism: `backdrop-filter: blur()` with semi-transparent backgrounds
- Theme support via `[data-hoff-theme="light"]` and `[data-hoff-theme="dark"]` selectors
- Theme auto-detected from page background luminance
- All styles scoped under `hoff-` prefixed selectors to avoid conflicts with host pages
- Animations defined as `@keyframes` in `hoff-glass.css`

### Communication Patterns

- **Content ↔ Background:** `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`
- **Background → Content:** `chrome.tabs.sendMessage(tabId, ...)`
- **Content → Backend:** Route through `bgFetch()` in background.js (required for Private Network Access in MV3)
- **Backend → Content:** Server-Sent Events (EventSource) for streaming results

### No Build System

This extension ships raw JS/CSS — no transpilation, bundling, or minification. Keep it that way until complexity demands otherwise. When a build system becomes necessary, prefer a minimal setup (e.g., esbuild) over heavy frameworks.

---

## Chrome Extension Best Practices

### Manifest V3 Compliance

- Use service workers (not background pages). The service worker can be terminated at any time — do not store state in variables, use `chrome.storage` instead.
- All network requests from content scripts to local/private networks must go through the background service worker (`bgFetch` pattern) due to Private Network Access (PNA) restrictions.
- Use `chrome.action.onClicked` (not `browserAction`).

### Permission Minimization

- Request only the permissions you need. Current permissions (`activeTab`, `storage`, `cookies`, `<all_urls>`) are all actively used.
- If adding new features, prefer optional permissions (`chrome.permissions.request`) over adding to the manifest.
- Before Web Store submission, audit whether `<all_urls>` can be narrowed or made optional.

### Content Script Isolation

- All content scripts run in the page's context. Prefix everything with `hoff-` to avoid collisions.
- Never assume a global variable name is available — another extension or the page itself may define it.
- Use `document.querySelector('[id="hoff-root"]')` patterns if paranoid about conflicts.
- Clean up event listeners, observers, and DOM nodes when the extension is disabled or unloaded.

### Service Worker Lifecycle

- Service workers are ephemeral. They shut down after ~30 seconds of inactivity.
- Never rely on in-memory state in `background.js` — persist to `chrome.storage`.
- Use `chrome.alarms` for periodic tasks, not `setInterval`.

### Performance

- Content scripts run on every matched page. Keep initialization fast.
- Lazy-load heavy operations (only start tour logic when a user triggers it).
- Use `MutationObserver` judiciously — disconnect when no longer needed.
- Avoid injecting large DOM trees on page load.

### Web Store Readiness

- Provide a clear privacy policy (required for `cookies` and `<all_urls>` permissions).
- The `test-flows/` directory and `mock-payload.js` must be excluded from the production build.
- All user data handling must be disclosed in the store listing.
- Extension must function gracefully when the backend is unreachable (show clear errors, don't break the page).

---

## Security Guidelines

### Cookie & Session Data

- Cookies are collected via `chrome.cookies.getAll` and sent to the backend. This is the most sensitive operation in the extension.
- Never log, expose, or persist raw cookie data beyond what's needed for the current job request.
- The backend must handle cookie data over HTTPS in production — never transmit session data over plain HTTP outside of local development.
- Validate that the backend endpoint is the expected host before sending sensitive data.

### Storage Security

- `chrome.storage.local` is scoped to the extension and not accessible by web pages, but it is NOT encrypted.
- Never store raw credentials, tokens, or full cookie dumps in storage.
- Tour state and pill data are acceptable for storage — they contain workflow metadata, not secrets.

### Content Script Security

- Never use `eval()`, `innerHTML` with unsanitized content, or `document.write()`.
- Sanitize any data received from the backend before injecting it into the DOM (workflow titles, descriptions, element selectors).
- Be cautious with CSS selectors from the backend — a malicious selector could theoretically target sensitive page elements.
- Use `textContent` instead of `innerHTML` when inserting user-facing or backend-provided text.

### Network Security

- In production, all API communication must be over HTTPS.
- Validate SSE event data before processing (malformed events should be dropped, not crash the extension).
- Set appropriate timeouts on all network requests to prevent hanging.

### Permission Scope

- The `<all_urls>` host permission grants access to all websites. For the Web Store, justify this clearly (the extension needs to run tours on any site the user visits).
- Consider switching to `activeTab` + user-triggered permission grants if the Web Store review pushes back.

---

## Environment Configuration

All environment-specific URLs are centralized in `config.js` via `window.HoffConfig`:

```javascript
window.HoffConfig = {
  API_BASE: "http://localhost:8000",     // Backend API
  FRONTEND_BASE: "http://localhost:5173", // Hoff frontend app
};
```

### How It Works

- **Defaults** are set synchronously in `config.js` so all other scripts can read them immediately.
- **Per-user overrides** are loaded from `chrome.storage.sync` (keys: `hoff_api_base`, `hoff_frontend_base`), which persists across devices.
- All modules (`content.js`, `hoff-ui.js`) reference `HoffConfig.API_BASE` and `HoffConfig.FRONTEND_BASE` — never hardcoded URLs.

### Changing the Backend URL

For local development with a different port or for production deployment, set the override in Chrome DevTools (extension context):

```javascript
chrome.storage.sync.set({ hoff_api_base: "https://api.hoff.app" });
```

For production, update the defaults in `config.js` directly.

---

## Testing Strategy

### Current: Manual Testing

1. Load extension unpacked in Chrome
2. Navigate to a target site
3. Click the Hoff icon → chat bar appears
4. Submit a query → verify job creation, SSE polling, tour playback
5. Test edge cases: page navigation mid-tour, element not found, backend down

### Future: Automated Testing

**Unit tests** (priority):
- Tour step mapping logic (`mapSteps` in hoff-tour.js)
- Element matching / fuzzy text matching
- Theme detection
- Storage read/write helpers

**Integration tests** (next):
- Use Puppeteer or Playwright with `--load-extension` flag
- Verify content script injection
- Test UI state transitions (input → loading → tour → complete)
- Test cross-page tour resumption

**E2E tests** (later):
- Full flow against a test backend
- Multi-page tour scenarios
- Error handling (backend down, element missing, timeout)

### Test File Conventions

When tests are added:
- Place test files in a `tests/` directory at the repo root
- Name test files `*.test.js` or `*.spec.js`
- Test utilities go in `tests/helpers/`

---

## Workflow Data Schema

Reference for backend integration and tour generation:

```json
{
  "url": "https://example.com",
  "brand": {
    "primary": "#hex",
    "background": "#hex",
    "text": "#hex",
    "fontFamily": "CSS font-family string",
    "borderRadius": "CSS border-radius value"
  },
  "workflow": {
    "name": "Workflow name",
    "description": "Short description",
    "steps": [
      {
        "element": "CSS selector",
        "text": "Optional text content for fuzzy matching",
        "title": "Step title",
        "description": "Step instruction shown to user",
        "side": "top | bottom | left | right | over",
        "navigates": false,
        "dynamic": false,
        "preClick": "Optional CSS selector to click before highlighting"
      }
    ]
  }
}
```

### Step Properties

| Property | Type | Description |
|----------|------|-------------|
| `element` | string | CSS selector targeting the step's element |
| `text` | string? | Fallback text content for fuzzy element matching |
| `title` | string | Popover heading |
| `description` | string | Popover body — instruction for the user |
| `side` | string | Popover placement relative to element |
| `navigates` | bool | If true, clicking advances to a new page and saves tour state |
| `dynamic` | bool | If true, uses MutationObserver to wait for element to appear |
| `preClick` | string? | Selector to click before highlighting (opens menus/dropdowns) |

---

## Common Pitfalls

- **Stale content scripts:** After editing, you must refresh the extension AND reload the page. Just reloading the page is not enough.
- **PNA blocking:** Fetch calls from content scripts to `localhost` are blocked by Private Network Access. Always route through `bgFetch()` in the background service worker.
- **Service worker termination:** Don't store state in background.js variables. The worker can die at any time.
- **driver.js + Radix conflicts:** Radix UI components (aria-hidden, data-state) conflict with driver.js overlays. See `resetAndClick()` in hoff-tour.js for the workaround pattern.
- **Injection order:** `config.js` must be first (all modules depend on `HoffConfig`). `content.js` must be last (depends on `HoffUI` and `HoffTour`). If you add a new module, place it between them in manifest.json.
- **Tour generation counter:** `content.js` uses `tourGeneration` to prevent stale async callbacks from triggering tours from old requests. Always check the generation before acting on async results.

---

## Future Considerations

- **Multi-browser support:** Planned for Firefox, Safari, and Edge. Use `chrome.*` APIs with a polyfill layer (e.g., webextension-polyfill) when the time comes. Avoid Chrome-only APIs where standards-based alternatives exist.
- **Web Store publication:** Requires privacy policy, justified permissions, and removal of dev-only assets (test-flows, mock-payload).
- **Open source:** Add LICENSE, CONTRIBUTING.md, and issue templates when ready. Ensure no secrets, internal URLs, or proprietary backend details are in the repo.
- **Build system:** When added, keep it minimal (esbuild preferred). Generate separate dev/production builds to exclude test-flows and mock-payload from production.
