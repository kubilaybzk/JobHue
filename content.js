(() => {
  const CARD_SELECTOR = '[componentkey^="job-card-component-ref-"]';
  const APPLIED_LABELS = new Set(["başvuruldu", "applied", "application submitted", "başvuru gönderildi"]);
  const VIEWED_LABELS = new Set(["görüntülendi", "viewed"]);
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

  let state = { viewed: {}, applied: {} };
  let settings = { ...DEFAULT_SETTINGS };
  let paintTimer = 0;
  let painting = false;
  let stopped = false;
  let observer = null;

  init();

  function isInvalidated(error) {
    return /extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function alive() {
    if (stopped) return false;
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (error) {
      if (isInvalidated(error)) stop();
      return false;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(paintTimer);
    observer?.disconnect();
    observer = null;
    document.removeEventListener("click", onClick, true);
  }

  function send(message) {
    if (!alive()) return;
    try {
      const result = chrome.runtime.sendMessage(message);
      result?.catch?.((error) => {
        if (isInvalidated(error)) stop();
      });
    } catch (error) {
      if (isInvalidated(error)) stop();
    }
  }

  async function init() {
    if (!alive()) return;
    try {
      const payload = await chrome.runtime.sendMessage({ type: "getState" });
      state = {
        viewed: payload?.viewed || {},
        applied: payload?.applied || {}
      };
      settings = { ...DEFAULT_SETTINGS, ...(payload?.settings || {}) };
    } catch (error) {
      if (isInvalidated(error)) {
        stop();
        return;
      }
      state = { viewed: {}, applied: {} };
      settings = { ...DEFAULT_SETTINGS };
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (!alive() || area !== "local") return;
        if (changes.viewed) state.viewed = changes.viewed.newValue || {};
        if (changes.applied) state.applied = changes.applied.newValue || {};
        if (changes.settings) {
          applyIncomingSettings(changes.settings.newValue);
          return;
        }
        schedulePaint();
      });

      chrome.runtime.onMessage.addListener((message) => {
        if (!alive()) return;
        if (message?.type === "applySettings") applyIncomingSettings(message.settings);
      });
    } catch (error) {
      if (isInvalidated(error)) {
        stop();
        return;
      }
    }

    observeSpa();
    observeDom();
    document.addEventListener("click", onClick, true);
    applyCssVars();
    markCurrentJobViewed();
    detectDetailApplied();
    injectLegend();
    schedulePaint();
  }

  function applyIncomingSettings(next) {
    if (!alive()) return;
    settings = { ...DEFAULT_SETTINGS, ...(next || {}) };
    applyCssVars();
    injectLegend();
    paintCards();
  }

  function opacityFor(status) {
    const percent =
      status === "applied" ? settings.appliedOpacity : status === "viewed" ? settings.viewedOpacity : settings.newOpacity;
    return String((Number(percent) || 100) / 100);
  }

  function applyCssVars() {
    const applied = opacityFor("applied");
    const viewed = opacityFor("viewed");
    const fresh = opacityFor("new");
    document.documentElement.style.setProperty("--lit-new-opacity", fresh);
    document.documentElement.style.setProperty("--lit-viewed-opacity", viewed);
    document.documentElement.style.setProperty("--lit-applied-opacity", applied);

    let tag = document.getElementById("lit-live-css");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "lit-live-css";
      document.documentElement.appendChild(tag);
    }
    tag.textContent = `
      .lit-card--new { opacity: ${fresh} !important; }
      .lit-card--viewed { opacity: ${viewed} !important; }
      .lit-card--applied { opacity: ${applied} !important; }
    `;
  }

  function observeSpa() {
    const notify = () => {
      if (!alive()) return;
      markCurrentJobViewed();
      detectDetailApplied();
      injectLegend();
      schedulePaint();
    };
    window.addEventListener("popstate", notify);
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      if (original?.__litPatched) return;
      const patched = function patchedHistory() {
        const result = original.apply(this, arguments);
        notify();
        return result;
      };
      patched.__litPatched = true;
      history[method] = patched;
    });
  }

  function observeDom() {
    observer = new MutationObserver((mutations) => {
      if (!alive() || painting) return;
      const relevant = mutations.some((mutation) => {
        const node = mutation.target;
        if (!(node instanceof Element)) return mutation.addedNodes.length > 0;
        return !node.closest(".lit-card, .lit-badge, .lit-legend, .lit-hide");
      });
      if (!relevant) return;
      schedulePaint();
      detectDetailApplied();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function schedulePaint() {
    if (!alive()) return;
    window.clearTimeout(paintTimer);
    paintTimer = window.setTimeout(() => {
      if (alive()) paintCards();
    }, 60);
  }

  function getJobIdFromUrl() {
    const pathMatch = location.pathname.match(/\/jobs\/view\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    return new URLSearchParams(location.search).get("currentJobId");
  }

  function readAttr(el, name) {
    try {
      return el?.getAttribute?.(name) || "";
    } catch (_error) {
      return "";
    }
  }

  function getJobIdFromCard(card) {
    const key = readAttr(card, "componentkey");
    const fromKey = key.match(/job-card-component-ref-(\d+)/);
    if (fromKey) return fromKey[1];

    const nested = card.querySelector(CARD_SELECTOR);
    if (nested && nested !== card) return getJobIdFromCard(nested);

    const href = readAttr(card.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]'), "href");
    const fromHref = href.match(/\/jobs\/view\/(\d+)/) || href.match(/[?&]currentJobId=(\d+)/);
    return fromHref ? fromHref[1] : null;
  }

  function paragraphLabels(card) {
    return [...card.querySelectorAll("p")].map((p) => (p.textContent || "").trim().toLowerCase());
  }

  function nativeStatus(card) {
    const labels = paragraphLabels(card);
    if (labels.some((label) => APPLIED_LABELS.has(label))) return "applied";
    if (labels.some((label) => VIEWED_LABELS.has(label))) return "viewed";
    return null;
  }

  function statusOf(jobId, card) {
    const native = nativeStatus(card);
    if (native === "applied" || state.applied[jobId]) return "applied";
    if (native === "viewed" || state.viewed[jobId]) return "viewed";
    return "new";
  }

  function labelOf(status) {
    if (status === "applied") return "Başvuruldu";
    if (status === "viewed") return "Görüntülendi";
    return "Yeni";
  }

  function visualTarget(card) {
    let current = card;
    for (let i = 0; i < 5 && current.parentElement; i += 1) {
      const parent = current.parentElement;
      const style = readAttr(parent, "style");
      if (style.includes("background-color") || style.includes("border-color")) return parent;
      current = parent;
    }
    return card;
  }

  function shouldHide(status) {
    if (status === "applied") return Boolean(settings.hideApplied);
    if (status === "viewed") return Boolean(settings.hideViewed);
    return Boolean(settings.hideNew);
  }

  function setBlockHidden(target, hidden) {
    const wrap = target.closest('[data-display-contents="true"]') || target;
    wrap.classList.toggle("lit-hide", hidden);
    const next = wrap.nextElementSibling;
    if (next && next.tagName === "HR") next.classList.toggle("lit-hide", hidden);
  }

  function applyStatusClasses(el, status) {
    el.classList.add("lit-card");
    el.classList.toggle("lit-card--new", status === "new");
    el.classList.toggle("lit-card--viewed", status === "viewed");
    el.classList.toggle("lit-card--applied", status === "applied");
    el.dataset.litStatus = status;
    el.style.setProperty("opacity", opacityFor(status), "important");
  }

  function paintCards() {
    if (!alive() || !location.pathname.includes("/jobs")) return;
    painting = true;
    try {
      document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
        const jobId = getJobIdFromCard(card);
        if (!jobId) return;

        const status = statusOf(jobId, card);
        if (status === "applied" && !state.applied[jobId]) {
          send({ type: "markApplied", jobId });
        } else if (status === "viewed" && !state.viewed[jobId]) {
          send({ type: "markViewed", jobId });
        }

        const target = visualTarget(card);
        card.dataset.litStatus = status;
        applyStatusClasses(target, status);
        setBlockHidden(target, shouldHide(status));

        const badge = target.querySelector(":scope > .lit-badge");
        if (!settings.showBadges) {
          badge?.remove();
          return;
        }
        const nextBadge = badge || document.createElement("span");
        if (!badge) target.appendChild(nextBadge);
        nextBadge.className = `lit-badge lit-badge--${status}`;
        nextBadge.textContent = labelOf(status);
      });
    } catch (error) {
      if (isInvalidated(error)) stop();
    } finally {
      painting = false;
    }
  }

  function markCurrentJobViewed() {
    const jobId = getJobIdFromUrl();
    if (!jobId) return;
    send({ type: "markViewed", jobId });
  }

  function detectDetailApplied() {
    const jobId = getJobIdFromUrl();
    if (!jobId) return;
    const details = document.querySelector('[data-sdui-screen*="JobDetails"]');
    if (!details) return;
    const labels = paragraphLabels(details);
    if (labels.some((label) => APPLIED_LABELS.has(label))) {
      send({ type: "markApplied", jobId });
    }
  }

  function onClick(event) {
    if (!alive()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const card = target.closest(CARD_SELECTOR);
    if (card) {
      const jobId = getJobIdFromCard(card);
      if (jobId) send({ type: "markViewed", jobId });
    }

    const href = readAttr(target.closest("a"), "href");
    const fromHref = href.match(/\/jobs\/view\/(\d+)/) || href.match(/[?&]currentJobId=(\d+)/);
    if (fromHref) send({ type: "markViewed", jobId: fromHref[1] });
  }

  function injectLegend() {
    const existing = document.querySelector(".lit-legend");
    if (!location.pathname.includes("/jobs") || !settings.showLegend) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const legend = document.createElement("div");
    legend.className = "lit-legend";
    legend.innerHTML = `
      <strong>JobHue</strong>
      <span><i class="new"></i> Yeni</span>
      <span><i class="viewed"></i> Görüntülendi</span>
      <span><i class="applied"></i> Başvuruldu</span>
    `;
    document.body.appendChild(legend);
  }
})();
