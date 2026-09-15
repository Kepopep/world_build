// Shared hover-preview popup: a small card showing an entry's title + one-
// line summary, shown when the mouse hovers a link to an entry that already
// exists. One popup element (lazily created, appended to <body> so it can
// float above panel overflow/scroll containers), reused by every caller --
// currently editor.js (resolved [[wikilink]] spans in the rendered view-mode
// preview) and backlinks.js (the "Active" items in the Links panel). Same
// arm's-length shape as wikilink-parser.js: a tiny, dependency-free helper
// module other feature modules call into, not the other way around.
//
// Deliberately does NOT decide "does this link resolve?" itself -- callers
// only ever attach() elements that already resolve to a real Entry (an
// unresolved wikilink or an Inactive backlinks item never gets attached in
// the first place), which is what keeps this "only for links that already
// exist" per the feature's requirement, without this module needing its own
// copy of that resolution logic.

(function () {
  let popupEl = null;
  let showTimer = null;
  let hideTimer = null;
  let currentTarget = null;

  const SHOW_DELAY_MS = 350;
  const HIDE_DELAY_MS = 120;

  function ensurePopup() {
    if (!popupEl) {
      popupEl = document.createElement("div");
      popupEl.id = "link-preview-popup";
      popupEl.hidden = true;
      document.body.appendChild(popupEl);
    }
    return popupEl;
  }

  function clearTimers() {
    if (showTimer) {
      clearTimeout(showTimer);
      showTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function show(anchorEl, entry) {
    const popup = ensurePopup();
    popup.innerHTML = "";

    const title = document.createElement("div");
    title.className = "link-preview-title";
    title.textContent = entry.title || "Untitled";
    popup.appendChild(title);

    const summaryText = (entry.summary || "").trim();
    const summary = document.createElement("div");
    summary.className = "link-preview-summary";
    if (summaryText) {
      summary.textContent = summaryText;
    } else {
      summary.classList.add("link-preview-empty");
      summary.textContent = "No summary yet.";
    }
    popup.appendChild(summary);

    popup.hidden = false;
    position(anchorEl, popup);
  }

  // position: fixed, viewport-relative -- same reasoning as
  // #wikilink-autocomplete (editor.css), avoids scroll-offset math. Flips
  // above the anchor if it would overflow the bottom of the viewport, and
  // clamps horizontally so it never runs off the right edge.
  function position(anchorEl, popup) {
    const anchorRect = anchorEl.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;

    let top = anchorRect.bottom + margin;
    if (top + popupRect.height > window.innerHeight - margin) {
      top = anchorRect.top - popupRect.height - margin;
    }
    top = Math.max(margin, top);

    let left = anchorRect.left;
    const maxLeft = window.innerWidth - popupRect.width - margin;
    left = Math.max(margin, Math.min(left, maxLeft));

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  }

  function hide() {
    if (popupEl) {
      popupEl.hidden = true;
    }
    currentTarget = null;
  }

  // Wires hover-preview onto `el` for a single element that's already known
  // to resolve to `entry` (an Entry object, or a function returning one --
  // a function lets callers whose entry list can change between renders
  // hand back a fresh lookup instead of a possibly-stale snapshot). Safe to
  // call once per element per render pass; render passes that rebuild their
  // DOM wholesale (both callers do) naturally drop the old listeners with
  // the old elements, so there's nothing to unwire.
  function attach(el, entry) {
    el.addEventListener("mouseenter", () => {
      clearTimers();
      currentTarget = el;
      showTimer = setTimeout(() => {
        const resolved = typeof entry === "function" ? entry() : entry;
        if (resolved && currentTarget === el) {
          show(el, resolved);
        }
      }, SHOW_DELAY_MS);
    });

    el.addEventListener("mouseleave", () => {
      clearTimers();
      currentTarget = null;
      hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    });
  }

  window.linkPreview = { attach, hide };
})();
