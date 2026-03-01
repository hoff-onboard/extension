// Hoff — Background Service Worker
// Forwards extension icon click to content script as toggleUI message

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "toggleUI" });
  }
});
