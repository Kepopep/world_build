// Top-bar world search: a debounced title/summary/content search box
// (GET /api/worlds/{worldId}/search) with a results dropdown, click-to-
// navigate. Distinct from the [[wikilink]] autocomplete editor.js owns
// (that's title-only, backs the in-editor `[[` popup); this is the general
// "Search in current world..." box from CLAUDE.md's top-bar breakdown.
//
// Persistent-element module, same init(config)-once-then-reattach pattern as
// editor.js (there's exactly one search box in the shell, not one per
// entry), not the render(container, config)-per-call pattern
// sidebar.js/tags.js/graph.js use for content that's rebuilt from scratch
// each time. Only ever talks back to app.js via the onNavigate callback
// passed to init() -- never reaches into app.js's `state` directly.

(function () {
  const DEBOUNCE_MS = 180;
  const LIMIT = 20;

  let inputEl = null;
  let resultsEl = null;
  let worldId = null;
  let onNavigate = function () {};
  let listenersAttached = false;

  let results = [];
  let selectedIndex = 0;
  let open = false;
  let debounceTimer = null;
  let abortController = null;

  // config: { inputEl, resultsEl, worldId, onNavigate(id) }
  function init(config) {
    inputEl = config.inputEl;
    resultsEl = config.resultsEl;
    worldId = config.worldId || null;
    onNavigate = typeof config.onNavigate === "function" ? config.onNavigate : function () {};

    closeResults();
    inputEl.disabled = !worldId;

    if (!listenersAttached) {
      attachListeners();
      listenersAttached = true;
    }
  }

  function attachListeners() {
    inputEl.addEventListener("input", onInput);
    inputEl.addEventListener("keydown", onKeydown);
    document.addEventListener("click", (e) => {
      if (!open) {
        return;
      }
      if (inputEl.contains(e.target) || resultsEl.contains(e.target)) {
        return;
      }
      closeResults();
    });
  }

  function onInput() {
    const q = inputEl.value.trim();
    if (!q || !worldId) {
      closeResults();
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  }

  async function runSearch(q) {
    if (abortController) {
      abortController.abort();
    }
    const controller = new AbortController();
    abortController = controller;
    try {
      const res = await window.api.searchWorld(worldId, q, LIMIT, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      results = res || [];
      selectedIndex = 0;
      open = true;
      renderResults();
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      results = [];
      open = true;
      renderResults();
    }
  }

  function renderResults() {
    resultsEl.innerHTML = "";
    if (!open) {
      resultsEl.hidden = true;
      return;
    }
    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-result-empty";
      empty.textContent = "No matching entries.";
      resultsEl.appendChild(empty);
      resultsEl.hidden = false;
      return;
    }
    results.forEach((entry, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-result-item" + (index === selectedIndex ? " selected" : "");

      const title = document.createElement("span");
      title.className = "search-result-title";
      title.textContent = entry.title || "Untitled";
      item.appendChild(title);

      if (entry.summary) {
        const snippet = document.createElement("span");
        snippet.className = "search-result-snippet";
        snippet.textContent = entry.summary;
        item.appendChild(snippet);
      }

      // mousedown (not click) + preventDefault, same reasoning as editor.js's
      // wikilink-suggestion items: fires before the input's blur, so
      // selection doesn't get cut off mid-click.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectResult(entry);
      });
      resultsEl.appendChild(item);
    });
    resultsEl.hidden = false;
  }

  function selectResult(entry) {
    closeResults();
    inputEl.value = "";
    onNavigate(entry.id);
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        closeResults();
      }
      return;
    }
    if (!open || results.length === 0) {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % results.length;
      renderResults();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      renderResults();
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectResult(results[selectedIndex]);
    }
  }

  function closeResults() {
    open = false;
    results = [];
    selectedIndex = 0;
    clearTimeout(debounceTimer);
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (resultsEl) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
    }
  }

  window.search = { init: init };
})();
