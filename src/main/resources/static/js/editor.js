// Wikilink-aware editor layer: tokenizes [[Title]] references in the raw
// markdown source, renders a colored overlay behind the (transparent) raw
// textarea, routes click/dblclick against the token list, and drives the
// [[-triggered entity autocomplete popup.
//
// Design: docs/design/autocomplete-and-entity-references.md, sections 2.1-2.7.
// Everything here works off the raw textarea value -- there is no DOM tree
// for the markdown itself, only the overlay <div>'s disposable innerHTML.

(function () {
  const WIKILINK_SOURCE = "\\[\\[([^\\[\\]\\n]+)\\]\\]";
  const AUTOCOMPLETE_DEBOUNCE_MS = 150;
  const AUTOCOMPLETE_LIMIT = 8;

  // Wired-up elements + callbacks, set by init(). editor.js only ever talks
  // to app.js through the callbacks passed here -- it never reaches into
  // app.js's `state` directly.
  let textareaEl = null;
  let overlayEl = null;
  let autocompleteEl = null;
  let worldId = null;
  let onNavigate = function () {};
  let onEntriesChanged = function () {};
  let onEscapeEdit = function () {};
  let listenersAttached = false;

  // Whether the entry is currently editable (app.js's edit-mode toggle,
  // read-only/view by default). Gates two behaviors: while editing, a click
  // on a [[reference]] must not navigate away -- it should just place the
  // caret, like clicking into any other text, so the user can fix a typo
  // inside the brackets -- and the hand-cursor hover treatment (which
  // signals "clicking this navigates") is suppressed for the same reason.
  let editingEnabled = false;

  // Map<lowercaseTitle, entryId> -- resolution index per 2.6. Rebuilt
  // wholesale on every init() call (app.js calls init() again whenever
  // state.entries changes), and updated incrementally in-place when
  // editor.js itself creates a stub entry (2.7).
  let titleIndex = new Map();

  // Token list for the text currently in the textarea, refreshed on every
  // input/render pass. Click/dblclick routing consults this instead of the
  // DOM, since the overlay's spans are not interactive (pointer-events: none).
  let currentTokens = [];

  // The overlay <span> elements rendered for currentTokens, same order/index
  // correspondence as currentTokens (only tokens produce these spans). Used
  // to hover-test the mouse position against real on-screen rects (see
  // onTextareaMouseMove) -- the overlay is pointer-events: none so it can
  // never receive hover itself, but its spans are pixel-aligned with the
  // textarea (scroll-synced, identical font metrics), so their
  // getClientRects() give an accurate hit box for cursor-swapping.
  let currentTokenElements = [];
  let hoveringWikilink = false;

  // Autocomplete popup state.
  let acOpen = false;
  let acMatchStart = -1;
  let acSuggestions = [];
  let acSelectedIndex = 0;
  let acDebounceTimer = null;
  let acAbortController = null;

  function init(config) {
    textareaEl = config.textarea;
    overlayEl = config.overlay;
    autocompleteEl = config.autocompleteEl;
    worldId = config.worldId || null;
    onNavigate = typeof config.onNavigate === "function" ? config.onNavigate : function () {};
    onEntriesChanged = typeof config.onEntriesChanged === "function" ? config.onEntriesChanged : function () {};
    onEscapeEdit = typeof config.onEscapeEdit === "function" ? config.onEscapeEdit : function () {};
    editingEnabled = config.editing === true;

    titleIndex = buildTitleIndex(config.entries || []);

    if (!listenersAttached) {
      attachListeners();
      listenersAttached = true;
    }

    // Clear any stale hover cursor from before this init (e.g. right after
    // toggling edit mode) -- the next mousemove re-evaluates it correctly.
    hoveringWikilink = false;
    if (textareaEl) {
      textareaEl.style.cursor = "";
    }

    closeAutocomplete();
    refreshOverlay();
  }

  function buildTitleIndex(entries) {
    const map = new Map();
    for (const entry of entries) {
      if (entry && entry.title) {
        map.set(entry.title.toLowerCase(), entry.id);
      }
    }
    return map;
  }

  // ---- Tokenizer -----------------------------------------------------

  function tokenize(value) {
    const tokens = [];
    const re = new RegExp(WIKILINK_SOURCE, "g");
    let match;
    while ((match = re.exec(value)) !== null) {
      const rawTitle = match[1];
      const start = match.index;
      const end = start + match[0].length;
      const entryId = titleIndex.get(rawTitle.toLowerCase());
      tokens.push({
        start: start,
        end: end,
        rawTitle: rawTitle,
        resolved: entryId !== undefined,
        entryId: entryId,
      });
    }
    return tokens;
  }

  function findTokenAtOffset(offset) {
    return currentTokens.find(function (token) {
      return offset > token.start && offset < token.end;
    });
  }

  // Point-based lookup: hit-tests viewport coordinates against the overlay
  // tokens' real on-screen rects (currentTokenElements and currentTokens are
  // parallel arrays -- same order, both rebuilt together in renderOverlay).
  // Used in view mode, where onTextareaMouseDown suppresses the native
  // mousedown action, so textareaEl.selectionStart never moves to the click
  // position and offset-based lookup can't be used there.
  function findTokenAtPoint(x, y) {
    for (let i = 0; i < currentTokenElements.length; i++) {
      const rects = currentTokenElements[i].getClientRects();
      for (const rect of rects) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return currentTokens[i];
        }
      }
    }
    return undefined;
  }

  // ---- Overlay renderer ------------------------------------------------

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Rebuilds the overlay's innerHTML from scratch. `caretOffset`, when a
  // number, gets a zero-width #caret-marker span inserted at that offset so
  // the autocomplete popup can position itself off the overlay (2.5) -- the
  // overlay already has identical font metrics to the textarea, so it
  // doubles as the "mirror" element instead of maintaining a second one.
  function renderOverlay(value, tokens, caretOffset) {
    const hasMarker = typeof caretOffset === "number";
    let html = "";
    let cursor = 0;

    function appendPlain(text, from) {
      if (hasMarker && caretOffset >= from && caretOffset <= from + text.length) {
        const localOffset = caretOffset - from;
        html +=
          escapeHtml(text.slice(0, localOffset)) +
          '<span id="caret-marker"></span>' +
          escapeHtml(text.slice(localOffset));
      } else {
        html += escapeHtml(text);
      }
    }

    for (const token of tokens) {
      appendPlain(value.slice(cursor, token.start), cursor);
      const cls = token.resolved ? "wikilink-resolved" : "wikilink-unresolved";
      html += '<span class="' + cls + '">' + escapeHtml(value.slice(token.start, token.end)) + "</span>";
      cursor = token.end;
    }
    appendPlain(value.slice(cursor), cursor);

    overlayEl.innerHTML = html;
    // Rebuilding innerHTML invalidates any previously-held span references --
    // re-query in the same order tokens were appended above.
    currentTokenElements = Array.prototype.slice.call(
      overlayEl.querySelectorAll(".wikilink-resolved, .wikilink-unresolved")
    );
  }

  function refreshOverlay() {
    const value = textareaEl.value;
    currentTokens = tokenize(value);
    renderOverlay(value, currentTokens, null);
  }

  function syncOverlayScroll() {
    overlayEl.scrollTop = textareaEl.scrollTop;
    overlayEl.scrollLeft = textareaEl.scrollLeft;
  }

  // ---- Input handling: retokenize + autocomplete trigger ---------------

  function onTextareaInput() {
    const value = textareaEl.value;
    currentTokens = tokenize(value);
    const caret = textareaEl.selectionStart;
    const trigger = detectTrigger(value, caret);

    renderOverlay(value, currentTokens, trigger ? caret : null);

    if (trigger) {
      openOrUpdateAutocomplete(trigger.matchStart, trigger.query);
    } else if (acOpen) {
      closeAutocomplete();
    }
  }

  // Looks backward from the caret to the start of the current line for an
  // unclosed [[ -- per 2.5.
  function detectTrigger(value, caret) {
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const beforeCaret = value.slice(lineStart, caret);
    const m = beforeCaret.match(/\[\[([^\[\]]*)$/);
    if (!m) {
      return null;
    }
    return { matchStart: lineStart + m.index, query: m[1] };
  }

  // ---- Mouse handling: view mode is look-don't-touch, edit mode is normal
  // text -----------------------------------------------------------------
  //
  // In view mode nothing on the text surface is meant to be typed into or
  // selected -- clicking either navigates a resolved reference or does
  // nothing, so onTextareaMouseDown suppresses the native mousedown action
  // there. That stops the browser from placing a caret or highlighting a
  // selection (even a stray one-character selection from a tiny mouse drag
  // between mousedown/mouseup), so clicking around view-mode text stays
  // visually inert except over an actual [[reference]]. It also means
  // textareaEl.selectionStart never moves to the click position in view
  // mode, so onTextareaClick/onTextareaDblClick use point-based lookup
  // (findTokenAtPoint) there instead of offset-based lookup. In edit mode
  // this is all a no-op -- normal caret placement, selection, and
  // selectionStart-based lookup are exactly what's wanted.

  function onTextareaMouseDown(event) {
    if (!editingEnabled) {
      event.preventDefault();
    }
  }

  function onTextareaClick(event) {
    if (editingEnabled) {
      // While editing, a click on a [[reference]] must not change the
      // current file -- just let the caret land where the user clicked,
      // same as clicking any other text.
      return;
    }
    const token = findTokenAtPoint(event.clientX, event.clientY);
    if (token && token.resolved) {
      onNavigate(token.entryId);
    }
    // click + unresolved -> no-op, per spec.
  }

  function onTextareaDblClick(event) {
    const token = editingEnabled
      ? findTokenAtOffset(textareaEl.selectionStart)
      : findTokenAtPoint(event.clientX, event.clientY);
    if (token && !token.resolved) {
      event.preventDefault(); // suppress native double-click word-selection
      createStubEntry(token);
    }
    // dblclick + resolved -> no distinct behavior, per spec.
  }

  // ---- Hover cursor: hand over [[...]] tokens, normal arrow elsewhere in
  // view mode --------------------------------------------------------------
  //
  // The overlay's .wikilink-* spans carry `cursor: pointer` in CSS, but the
  // overlay has pointer-events: none (the textarea on top owns all mouse
  // events), so that rule never actually applies visually -- it's inert.
  // The textarea itself has to swap its own cursor style, so on every
  // mousemove we hit-test the pointer's viewport coordinates against the
  // overlay tokens' real on-screen rects (accurate because the overlay is
  // pixel-aligned and scroll-synced with the textarea) and toggle
  // textareaEl.style.cursor directly. Off a token, clearing the inline style
  // falls back to editor.css's view-mode rule (cursor: default, the normal
  // arrow, since you can't type there) -- edit mode falls back to the
  // ordinary text-input I-beam instead.

  function onTextareaMouseMove(event) {
    // While editing, clicking a reference no longer navigates (see
    // onTextareaClick), so the hand cursor would be misleading -- it's just
    // text you can click into like anything else. Skip the hit-test
    // entirely and make sure any leftover pointer cursor is cleared.
    if (editingEnabled) {
      if (hoveringWikilink) {
        hoveringWikilink = false;
        textareaEl.style.cursor = "";
      }
      return;
    }
    const hovering = !!findTokenAtPoint(event.clientX, event.clientY);
    if (hovering !== hoveringWikilink) {
      hoveringWikilink = hovering;
      textareaEl.style.cursor = hovering ? "pointer" : "";
    }
  }

  function onTextareaMouseLeave() {
    if (hoveringWikilink) {
      hoveringWikilink = false;
      textareaEl.style.cursor = "";
    }
  }

  // ---- Stub creation -> flip the span in place (2.7) --------------------

  async function createStubEntry(token) {
    const key = token.rawTitle.toLowerCase();
    if (titleIndex.has(key)) {
      // Defensive re-check: became resolved by another update since the
      // last tokenize pass. Just refresh so the overlay reflects it.
      refreshOverlay();
      return;
    }
    try {
      const entry = await window.api.createEntry(worldId, {
        title: token.rawTitle,
        contentMarkdown: "",
      });
      titleIndex.set(entry.title.toLowerCase(), entry.id);
      refreshOverlay();
      onEntriesChanged(entry);
    } catch (err) {
      console.error('Failed to create stub entry for "' + token.rawTitle + '":', err);
    }
  }

  // ---- Autocomplete popup (2.5) -----------------------------------------

  function openOrUpdateAutocomplete(matchStart, query) {
    acOpen = true;
    acMatchStart = matchStart;
    positionAutocomplete();
    scheduleSearch(query);
  }

  function scheduleSearch(query) {
    clearTimeout(acDebounceTimer);
    acDebounceTimer = setTimeout(function () {
      fetchSuggestions(query);
    }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  async function fetchSuggestions(query) {
    if (!worldId) {
      return;
    }
    if (acAbortController) {
      acAbortController.abort();
    }
    const controller = new AbortController();
    acAbortController = controller;
    try {
      const results = await window.api.searchEntryTitles(worldId, query, AUTOCOMPLETE_LIMIT, controller.signal);
      if (controller.signal.aborted || !acOpen) {
        return;
      }
      acSuggestions = results || [];
      acSelectedIndex = 0;
      renderAutocompletePopup();
      positionAutocomplete();
    } catch (err) {
      if (err && err.name === "AbortError") {
        return;
      }
      acSuggestions = [];
      renderAutocompletePopup();
    }
  }

  function renderAutocompletePopup() {
    autocompleteEl.innerHTML = "";
    if (!acOpen || acSuggestions.length === 0) {
      autocompleteEl.hidden = true;
      return;
    }
    acSuggestions.forEach(function (suggestion, index) {
      const item = document.createElement("div");
      item.className = "wikilink-suggestion" + (index === acSelectedIndex ? " selected" : "");
      item.textContent = suggestion.title;
      // mousedown (not click) + preventDefault so the textarea never loses
      // focus/selection before the suggestion is accepted.
      item.addEventListener("mousedown", function (e) {
        e.preventDefault();
        acceptSuggestion(suggestion);
      });
      autocompleteEl.appendChild(item);
    });
    autocompleteEl.hidden = false;
  }

  function positionAutocomplete() {
    const marker = overlayEl.querySelector("#caret-marker");
    if (!marker) {
      return;
    }
    const rect = marker.getBoundingClientRect();
    autocompleteEl.style.left = rect.left + "px";
    autocompleteEl.style.top = rect.bottom + 4 + "px";
  }

  function acceptSuggestion(suggestion) {
    if (acMatchStart < 0) {
      return;
    }
    const value = textareaEl.value;
    const caret = textareaEl.selectionStart;
    const newValue = value.slice(0, acMatchStart) + "[[" + suggestion.title + "]]" + value.slice(caret);
    const newCaret = acMatchStart + 2 + suggestion.title.length + 2;

    closeAutocomplete();

    textareaEl.value = newValue;
    textareaEl.setSelectionRange(newCaret, newCaret);
    textareaEl.focus();
    // Dispatch a real input event rather than calling our own handler
    // directly -- app.js's own "input" listener (markDirty) keeps working
    // unmodified, and this handler's own input listener retokenizes/
    // re-renders the overlay as a side effect.
    textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function closeAutocomplete() {
    acOpen = false;
    acSuggestions = [];
    acSelectedIndex = 0;
    acMatchStart = -1;
    clearTimeout(acDebounceTimer);
    if (acAbortController) {
      acAbortController.abort();
      acAbortController = null;
    }
    if (autocompleteEl) {
      autocompleteEl.hidden = true;
      autocompleteEl.innerHTML = "";
    }
  }

  function onTextareaKeydown(event) {
    // Escape is handled first and independent of the autocomplete-only
    // guard below: with the popup open it just closes the popup (existing
    // behavior); with the popup closed and the entry editable, it exits
    // edit mode entirely via app.js's callback (state/DOM changes editor.js
    // doesn't own -- see the module doc comment). A layered escape, same as
    // most editors: first press dismisses the nearer thing.
    if (event.key === "Escape") {
      if (acOpen) {
        event.preventDefault();
        closeAutocomplete();
      } else if (editingEnabled) {
        event.preventDefault();
        onEscapeEdit();
      }
      return;
    }

    if (!acOpen) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (acSuggestions.length > 0) {
        acSelectedIndex = (acSelectedIndex + 1) % acSuggestions.length;
        renderAutocompletePopup();
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (acSuggestions.length > 0) {
        acSelectedIndex = (acSelectedIndex - 1 + acSuggestions.length) % acSuggestions.length;
        renderAutocompletePopup();
      }
    } else if (event.key === "Tab" || event.key === "Enter") {
      if (acSuggestions.length === 0) {
        return; // nothing to accept -- let Tab/Enter do their normal thing
      }
      event.preventDefault();
      acceptSuggestion(acSuggestions[acSelectedIndex]);
    }
  }

  function onDocumentClick(event) {
    if (!acOpen) {
      return;
    }
    if (autocompleteEl.contains(event.target)) {
      return;
    }
    closeAutocomplete();
  }

  // ---- Wiring -----------------------------------------------------------

  function attachListeners() {
    textareaEl.addEventListener("input", onTextareaInput);
    textareaEl.addEventListener("mousedown", onTextareaMouseDown);
    textareaEl.addEventListener("click", onTextareaClick);
    textareaEl.addEventListener("dblclick", onTextareaDblClick);
    textareaEl.addEventListener("keydown", onTextareaKeydown);
    textareaEl.addEventListener("blur", closeAutocomplete);
    textareaEl.addEventListener("scroll", syncOverlayScroll);
    textareaEl.addEventListener("mousemove", onTextareaMouseMove);
    textareaEl.addEventListener("mouseleave", onTextareaMouseLeave);
    document.addEventListener("click", onDocumentClick);
  }

  window.editor = {
    init: init,
  };
})();
