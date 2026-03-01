// Hoff — Mock Backend
// Returns a random workflow from test-flows/ after a 3s delay

function hoffMockBackend(query) {
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        const payloadUrl = chrome.runtime.getURL("test-flows/bu3.json");
        const payload = await (await fetch(payloadUrl)).json();
        resolve(payload);
      } catch (e) {
        console.warn("Hoff mock backend error:", e);
        resolve(null);
      }
    }, 3000);
  });
}
