const DEFAULT_STATE = { viewed: {}, applied: {} };

const DEFAULT_SETTINGS = {
  hideApplied: false,
  hideViewed: false,
  hideNew: false,
  appliedOpacity: 40,
  viewedOpacity: 75,
  newOpacity: 100,
  showBadges: true,
  showLegend: true
};

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["viewed", "applied", "settings"]);
  await chrome.storage.local.set({
    viewed: current.viewed || {},
    applied: current.applied || {},
    settings: { ...DEFAULT_SETTINGS, ...(current.settings || {}) }
  });
});

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  const payload = { type: "applySettings", settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } };
  await Promise.all(
    tabs.map((tab) => (tab.id ? chrome.tabs.sendMessage(tab.id, payload).catch(() => {}) : Promise.resolve()))
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    broadcastSettings(changes.settings.newValue);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "pushSettings") {
    broadcastSettings(message.settings);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "getState") {
    chrome.storage.local.get(["viewed", "applied", "settings"]).then((data) => {
      sendResponse({
        viewed: data.viewed || DEFAULT_STATE.viewed,
        applied: data.applied || DEFAULT_STATE.applied,
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) }
      });
    });
    return true;
  }

  if (message?.type === "markViewed" && message.jobId) {
    chrome.storage.local.get(["viewed"]).then(async (data) => {
      const viewed = data.viewed || {};
      if (!viewed[message.jobId]) {
        viewed[message.jobId] = Date.now();
        await chrome.storage.local.set({ viewed });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "markApplied" && message.jobId) {
    chrome.storage.local.get(["viewed", "applied"]).then(async (data) => {
      const viewed = data.viewed || {};
      const applied = data.applied || {};
      const now = Date.now();
      viewed[message.jobId] = viewed[message.jobId] || now;
      applied[message.jobId] = now;
      await chrome.storage.local.set({ viewed, applied });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "unmarkApplied" && message.jobId) {
    chrome.storage.local.get(["applied"]).then(async (data) => {
      const applied = data.applied || {};
      delete applied[message.jobId];
      await chrome.storage.local.set({ applied });
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});
