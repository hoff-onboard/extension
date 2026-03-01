// Hoff — Mock Backend
// Returns a random workflow from test-flows/ after a 3s delay

function hoffMockBackend(query) {
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        const indexUrl = chrome.runtime.getURL("test-flows/index.json");
        const index = await (await fetch(indexUrl)).json();
        const pick = index[Math.floor(Math.random() * index.length)];
        const payloadUrl = chrome.runtime.getURL(`test-flows/${pick}`);
        const payload = await (await fetch(payloadUrl)).json();
        resolve(payload);
      } catch (e) {
        console.warn("Hoff mock backend error:", e);
        resolve(null);
      }
    }, 3000);
  });
}
