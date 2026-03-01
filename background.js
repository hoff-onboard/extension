// Hoff — Background Service Worker
// Forwards extension icon click to content script as toggleUI message

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "toggleUI" });
  }
});

// Cookie extraction for authenticated browser-use sessions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getCookies" && message.url) {
    chrome.cookies.getAll({ url: message.url }, (cookies) => {
      const sameSiteMap = { unspecified: "Lax", lax: "Lax", strict: "Strict", no_restriction: "None" };
      const formatted = (cookies || []).map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expirationDate || -1,
        size: c.name.length + c.value.length,
        httpOnly: c.httpOnly,
        secure: c.secure,
        session: c.session,
        sameSite: sameSiteMap[c.sameSite] || "Lax",
        priority: "Medium",
        sameParty: false,
        sourceScheme: c.secure ? "Secure" : "NonSecure",
        sourcePort: c.secure ? 443 : 80,
      }));
      sendResponse(formatted);
    });
    return true; // keep message channel open for async response
  }
});
