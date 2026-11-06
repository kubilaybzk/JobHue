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

const fields = {
  hideApplied: document.getElementById("hideApplied"),
  hideViewed: document.getElementById("hideViewed"),
  hideNew: document.getElementById("hideNew"),
  appliedOpacity: document.getElementById("appliedOpacity"),
  viewedOpacity: document.getElementById("viewedOpacity"),
  newOpacity: document.getElementById("newOpacity"),
  showBadges: document.getElementById("showBadges"),
  showLegend: document.getElementById("showLegend")
};

function collectSettings() {
  return {
    hideApplied: fields.hideApplied.checked,
    hideViewed: fields.hideViewed.checked,
    hideNew: fields.hideNew.checked,
    appliedOpacity: Number(fields.appliedOpacity.value),
    viewedOpacity: Number(fields.viewedOpacity.value),
    newOpacity: Number(fields.newOpacity.value),
    showBadges: fields.showBadges.checked,
    showLegend: fields.showLegend.checked
  };
}

function fillSettings(settings) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  fields.hideApplied.checked = next.hideApplied;
  fields.hideViewed.checked = next.hideViewed;
  fields.hideNew.checked = next.hideNew;
  fields.appliedOpacity.value = String(next.appliedOpacity);
  fields.viewedOpacity.value = String(next.viewedOpacity);
  fields.newOpacity.value = String(next.newOpacity);
  fields.showBadges.checked = next.showBadges;
  fields.showLegend.checked = next.showLegend;
  document.getElementById("appliedOpacityValue").textContent = `${next.appliedOpacity}%`;
  document.getElementById("viewedOpacityValue").textContent = `${next.viewedOpacity}%`;
  document.getElementById("newOpacityValue").textContent = `${next.newOpacity}%`;
}

async function saveSettings() {
  const settings = collectSettings();
  document.getElementById("appliedOpacityValue").textContent = `${settings.appliedOpacity}%`;
  document.getElementById("viewedOpacityValue").textContent = `${settings.viewedOpacity}%`;
  document.getElementById("newOpacityValue").textContent = `${settings.newOpacity}%`;
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: "pushSettings", settings }).catch(() => {});
}

async function refreshCounts() {
  const { viewed = {}, applied = {} } = await chrome.storage.local.get(["viewed", "applied"]);
  document.getElementById("viewedCount").textContent = String(Object.keys(viewed).length);
  document.getElementById("appliedCount").textContent = String(Object.keys(applied).length);
}

async function init() {
  const data = await chrome.storage.local.get(["settings"]);
  fillSettings(data.settings || DEFAULT_SETTINGS);
  refreshCounts();
}

Object.values(fields).forEach((field) => {
  field.addEventListener("change", saveSettings);
  field.addEventListener("input", saveSettings);
});

document.getElementById("clearViewed").addEventListener("click", async () => {
  await chrome.storage.local.set({ viewed: {} });
  refreshCounts();
});

document.getElementById("clearApplied").addEventListener("click", async () => {
  await chrome.storage.local.set({ applied: {} });
  refreshCounts();
});

document.querySelectorAll(".about a").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: link.href });
  });
});

init();
